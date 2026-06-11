import { createAPIFileRoute } from "@/lib/api-route";
import { z } from "zod";

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

const fileMetaSchema = z.object({
  name: z.string().min(1).max(512),
  size: z.number().int().min(0).max(50_000_000_000),
});

const metaSchema = z.object({
  folder_name: z.string().min(1).max(512),
  original_zip_name: z.string().min(1).max(512),
  files: z.array(fileMetaSchema).min(1).max(5000),
});

function getExtension(name: string): string {
  if (name.toLowerCase().endsWith(".vcf.gz")) return "vcf.gz";
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

export const APIRoute = createAPIFileRoute("/api/batches/process")({
  POST: async ({ request }) => {
        // ---- Auth ----
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.replace(/^Bearer\s+/i, "");
        if (!token) return json({ error: "Missing authorization" }, 401);

        const [{ supabaseAdmin }, { uploadToS3 }] = await Promise.all([
          import("@/integrations/supabase/client.server"),
          import("@/lib/s3.server"),
        ]);

        const { data: userData, error: userErr } =
          await supabaseAdmin.auth.getUser(token);
        if (userErr || !userData.user) {
          return json({ error: "Invalid or expired session" }, 401);
        }
        const userId = userData.user.id;

        // ---- Parse input ----
        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return json({ error: "Invalid form data" }, 400);
        }

        const zip = form.get("file");
        if (zip == null || typeof zip === "string" || typeof (zip as Blob).arrayBuffer !== "function") {
          return json({ error: "Missing zip file" }, 400);
        }

        let meta: z.infer<typeof metaSchema>;
        try {
          meta = metaSchema.parse({
            folder_name: form.get("folder_name"),
            original_zip_name: form.get("original_zip_name"),
            files: JSON.parse(String(form.get("files_meta") ?? "[]")),
          });
        } catch (e) {
          return json(
            { error: `Invalid metadata: ${(e as Error).message}` },
            400,
          );
        }

        const forceAssembly = String(form.get("force_assembly") ?? "").trim();
        if (!forceAssembly || !["hg19", "hg38"].includes(forceAssembly)) {
          return json({ error: "Invalid or missing genome assembly. Must be hg19 or hg38." }, 400);
        }

        const zipBuffer = await zip.arrayBuffer();
        const sizeBytes = zipBuffer.byteLength;

        // ---- Create batch ----
        const { data: batch, error: batchErr } = await supabaseAdmin
          .from("upload_batches")
          .insert({
            user_id: userId,
            folder_name: meta.folder_name,
            original_zip_name: meta.original_zip_name,
            total_files: meta.files.length,
            status: "processing",
            upload_size_bytes: sizeBytes,
            processing_started_at: new Date().toISOString(),
            zip_storage_path: "pending",
            assembly: forceAssembly,
          })
          .select("id")
          .single();

        if (batchErr || !batch) {
          return json({ error: batchErr?.message ?? "Failed to create batch" }, 500);
        }
        const batchId = batch.id as string;
        const zipPath = `uploads/${userId}/${batchId}/input.zip`;

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

        // ---- Create file rows ----
        const fileRows = meta.files.map((f) => ({
          batch_id: batchId,
          file_name: f.name,
          file_extension: getExtension(f.name),
          file_size_bytes: f.size,
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
            .update({ status: "failed", processing_completed_at: new Date().toISOString() })
            .eq("id", batchId);
          return json({ error: filesErr?.message ?? "Failed to register files" }, 500);
        }

        await supabaseAdmin
          .from("upload_batches")
          .update({ zip_storage_path: zipPath })
          .eq("id", batchId);
        await log("info", "upload", `Batch created with ${meta.files.length} file(s).`);

        // ---- Archive zip to S3 ----
        try {
          await uploadToS3(zipPath, zipBuffer);
          await log("info", "storage", "Input archive stored in S3.", undefined, {
            path: zipPath,
          });
        } catch (e) {
          await log("warn", "storage", `S3 archive failed: ${(e as Error).message}`);
        }

        // ---- Call processing API (multipart/form-data) ----
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
            meta.original_zip_name,
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
            total: meta.files.length,
            processed: 0,
            failed: meta.files.length,
          });
        }

        // ---- Start background S3 polling ----
        startPolling(supabaseAdmin, userId, batchId, insertedFiles, log).catch(
          (err: unknown) => {
            console.error(`[batch ${batchId}] Polling error:`, err);
          },
        );

        // ---- Return immediately ----
        return json({
          batchId,
          status: "processing",
          total: meta.files.length,
          processed: 0,
          failed: 0,
        });
      },
});

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

// ---------------------------------------------------------------------------
// Background S3 polling — uses the discovery service to find *.report.html
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

  await delay(15_000);

  const POLL_INTERVAL = 5_000;
  const TIMEOUT = 30 * 60 * 1000;
  const start = Date.now();

  while (Date.now() - start < TIMEOUT) {
    try {
      const result = await discoverAndPersistResults(supabaseAdmin, userId, batchId);
      await log(
        "info",
        "polling",
        `Poll cycle: ${result.completedFiles}/${result.totalFiles} completed, ${result.pendingFiles} pending.`,
      );
      if (result.allCompleted) {
        await log("info", "polling", "All reports processed. Polling complete.");
        return;
      }
    } catch (err: unknown) {
      await log("warn", "polling", `Discovery cycle error: ${(err as Error).message}. Retrying...`);
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
