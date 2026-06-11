import { createAPIFileRoute } from "@/lib/api-route";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export const APIRoute = createAPIFileRoute("/api/process-batch")({
  POST: async ({ request }) => {
    // ---- Auth ----
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);

    const [{ supabaseAdmin }, { validateZip }, { uploadToS3 }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/services/validation.service"),
      import("@/lib/s3.server"),
    ]);

    const { data: userData, error: userErr } =
      await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData.user) {
      return json({ error: "Invalid or expired session" }, 401);
    }
    const userId = userData.user.id;

    // ---- Parse form data ----
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "Invalid form data" }, 400);
    }

    const zip = form.get("file");
    if (
      zip == null ||
      typeof zip === "string" ||
      typeof (zip as Blob).arrayBuffer !== "function"
    ) {
      return json({ error: "Missing zip file" }, 400);
    }

    const folderName = String(form.get("folder_name") ?? "");
    const originalZipName = String(form.get("original_zip_name") ?? "");
    const forceAssembly = String(form.get("force_assembly") ?? "").trim();

    let filesMeta: { name: string; size: number }[];
    try {
      filesMeta = JSON.parse(String(form.get("files_meta") ?? "[]"));
    } catch {
      return json({ error: "Invalid files metadata" }, 400);
    }

    if (!folderName || !originalZipName || filesMeta.length === 0) {
      return json({ error: "Missing required metadata (folder_name, original_zip_name, files_meta)" }, 400);
    }

    if (!forceAssembly || !["hg19", "hg38"].includes(forceAssembly)) {
      return json({ error: "Invalid or missing genome assembly. Must be hg19 or hg38." }, 400);
    }

    // ---- Read and validate ZIP ----
    const zipBuffer = await (zip as Blob).arrayBuffer();

    let vcfFileNames: string[];
    try {
      const validation = await validateZip(zipBuffer);
      vcfFileNames = validation.fileNames;
    } catch (e) {
      const offending = (e as any).offending as string[] | undefined;
      return json({
        error: (e as Error).message,
        ...(offending ? { invalid_files: offending } : {}),
      }, 400);
    }

    // ---- Create batch record ----
    const { data: batch, error: batchErr } = await supabaseAdmin
      .from("upload_batches")
      .insert({
        user_id: userId,
        folder_name: folderName,
        original_zip_name: originalZipName,
        total_files: vcfFileNames.length,
        status: "processing",
        upload_size_bytes: zipBuffer.byteLength,
        processing_started_at: new Date().toISOString(),
        zip_storage_path: "pending", // placeholder, updated after we know batchId
        assembly: forceAssembly,
      })
      .select("id")
      .single();

    if (batchErr || !batch) {
      return json({ error: batchErr?.message ?? "Failed to create batch" }, 500);
    }
    const batchId = batch.id as string;

    // Helper: write processing log
    const log = (
      level: string,
      step: string,
      message: string,
      fileId?: string,
      extra?: Record<string, unknown>,
    ) =>
      supabaseAdmin.from("processing_logs").insert({
        batch_id: batchId,
        file_id: fileId ?? null,
        log_level: level,
        step_name: step,
        message,
        extra_data: (extra ?? {}) as never,
      });

    // ---- Create uploaded_files rows ----
    function getExtension(name: string): string {
      if (name.toLowerCase().endsWith(".vcf.gz")) return "vcf.gz";
      const idx = name.lastIndexOf(".");
      return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
    }

    const zipPath = `uploads/${userId}/${batchId}/input.zip`;
    const fileRows = vcfFileNames.map((name) => ({
      batch_id: batchId,
      file_name: name,
      file_extension: getExtension(name),
      file_size_bytes:
        filesMeta.find((f) => f.name === name)?.size ?? 0,
      s3_input_path: zipPath,
      status: "processing" as const,
      processing_step: "queued",
      processing_started_at: new Date().toISOString(),
    }));

    const { data: insertedFiles, error: filesErr } = await supabaseAdmin
      .from("uploaded_files")
      .insert(fileRows)
      .select("id, file_name");

    if (filesErr || !insertedFiles) {
      await supabaseAdmin
        .from("upload_batches")
        .update({
          status: "failed",
          processing_completed_at: new Date().toISOString(),
        })
        .eq("id", batchId);
      return json({ error: filesErr?.message ?? "Failed to register files" }, 500);
    }

    await supabaseAdmin
      .from("upload_batches")
      .update({ zip_storage_path: zipPath })
      .eq("id", batchId);
    await log("info", "upload", `Batch created with ${vcfFileNames.length} file(s).`);

    // ---- Archive ZIP to S3 ----
    try {
      await uploadToS3(zipPath, zipBuffer);
      await log("info", "storage", "Input archive stored in S3.", undefined, {
        path: zipPath,
      });
    } catch (e) {
      await log("warn", "storage", `S3 archive failed: ${(e as Error).message}`);
    }

    // ---- Call AWS Processing API (multipart/form-data) ----
    const apiUrl = process.env.PROCESSING_API_URL;
    if (!apiUrl) {
      await failBatch(supabaseAdmin, batchId, insertedFiles, "Processing API not configured");
      await log("error", "processing", "PROCESSING_API_URL is not configured.");
      return json({ error: "Processing API not configured" }, 500);
    }

    try {
      const apiForm = new FormData();
      apiForm.append("user_id", userId);
      apiForm.append("batch_id", batchId);
      apiForm.append("force_assembly", forceAssembly);
      apiForm.append(
        "file",
        new Blob([zipBuffer], { type: "application/zip" }),
        originalZipName,
      );

      const apiRes = await fetch(apiUrl, {
        method: "POST",
        body: apiForm,
      });

      if (!apiRes.ok) {
        const text = await apiRes.text().catch(() => "");
        throw new Error(`API responded ${apiRes.status}: ${text.slice(0, 500)}`);
      }

      await log("info", "processing", "Processing pipeline triggered successfully.");
    } catch (e) {
      await failBatch(supabaseAdmin, batchId, insertedFiles, (e as Error).message);
      await log("error", "processing", `Processing API failed: ${(e as Error).message}`);
      return json({
        batchId,
        status: "failed",
        total: vcfFileNames.length,
        processed: 0,
        failed: vcfFileNames.length,
      });
    }

    // ---- Start background S3 polling ----
    // Polling runs asynchronously; it updates the DB as reports appear.
    // The frontend polls the DB (via batch detail page refetchInterval) for live status.
    startPolling(supabaseAdmin, userId, batchId, insertedFiles, log).catch(
      (err) => {
        console.error(`[batch ${batchId}] Polling error:`, err);
      },
    );

    // ---- Return immediately ----
    return json({
      batchId,
      status: "processing",
      total: vcfFileNames.length,
      processed: 0,
      failed: 0,
    });
  },
});

// ---------------------------------------------------------------------------
// Background S3 polling — uses the discovery service to find *.report.html
// files and update the DB as they appear.  Runs asynchronously; the frontend
// also polls /api/check-batch-results for live updates.
// ---------------------------------------------------------------------------

async function startPolling(
  supabaseAdmin: any,
  userId: string,
  batchId: string,
  files: { id: string; file_name: string }[],
  log: (level: string, step: string, message: string, fileId?: string) => any,
) {
  const { discoverAndPersistResults } = await import(
    "@/services/result-discovery.service"
  );

  // Initial 15-second wait before first check
  await delay(15_000);

  const POLL_INTERVAL = 5_000;
  const TIMEOUT = 30 * 60 * 1000; // 30 minutes
  const start = Date.now();

  while (Date.now() - start < TIMEOUT) {
    try {
      const result = await discoverAndPersistResults(
        supabaseAdmin,
        userId,
        batchId,
      );

      await log(
        "info",
        "polling",
        `Poll cycle: ${result.completedFiles}/${result.totalFiles} completed, ${result.pendingFiles} pending.`,
      );

      if (result.allCompleted) {
        await log("info", "polling", "All reports processed. Polling complete.");
        return;
      }
    } catch (err) {
      // Ignore transient errors, will retry next interval
      await log(
        "warn",
        "polling",
        `Discovery cycle error: ${(err as Error).message}. Retrying...`,
      );
    }

    await delay(POLL_INTERVAL);
  }

  // Timeout: mark remaining files as failed
  const { data: pendingFiles } = await supabaseAdmin
    .from("uploaded_files")
    .select("id, file_name")
    .eq("batch_id", batchId)
    .eq("status", "processing");

  for (const f of pendingFiles ?? []) {
    await supabaseAdmin
      .from("uploaded_files")
      .update({
        status: "failed",
        processing_step: "failed",
        processing_completed_at: new Date().toISOString(),
        error_message: "Report was not generated within the expected time.",
      })
      .eq("id", f.id);
    await log("error", "result", `No report for ${f.file_name} (timeout).`, f.id);
  }

  // Final batch status update
  const { data: allFiles } = await supabaseAdmin
    .from("uploaded_files")
    .select("status")
    .eq("batch_id", batchId);

  const completedCount = (allFiles ?? []).filter((f: { status: string }) => f.status === "completed").length;
  const failedCount = (allFiles ?? []).filter((f: { status: string }) => f.status === "failed").length;
  const batchStatus =
    failedCount === 0 ? "completed" : completedCount === 0 ? "failed" : "partial";

  await supabaseAdmin
    .from("upload_batches")
    .update({
      processed_files: completedCount,
      failed_files: failedCount,
      status: batchStatus,
      processing_completed_at: new Date().toISOString(),
    })
    .eq("id", batchId);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function failBatch(
  supabaseAdmin: any,
  batchId: string,
  files: { id: string }[],
  message: string,
) {
  await supabaseAdmin
    .from("uploaded_files")
    .update({
      status: "failed",
      processing_step: "failed",
      processing_completed_at: new Date().toISOString(),
      error_message: message,
    })
    .eq("batch_id", batchId);
  await supabaseAdmin
    .from("upload_batches")
    .update({
      status: "failed",
      failed_files: files.length,
      processing_completed_at: new Date().toISOString(),
    })
    .eq("id", batchId);
}
