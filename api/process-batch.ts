/**
 * Vercel Serverless Function: POST /api/process-batch
 *
 * Accepts a ZIP file upload with metadata, creates a batch in Supabase,
 * archives the ZIP to S3, and triggers the external processing API.
 *
 * NOTE: Background S3 polling is intentionally omitted — Vercel functions
 * terminate after the response. The frontend polls /api/check-batch-results
 * which runs the discovery service on each call.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Busboy from "busboy";
import { supabaseAdmin } from "./lib/supabase-admin.js";
import { validateZip } from "../src/services/validation.service.js";
import { uploadToS3 } from "../src/lib/s3.server.js";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(res: VercelResponse, data: unknown, status = 200) {
  res.status(status).setHeader("Content-Type", "application/json");
  for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);
  return res.json(data);
}

function getExtension(name: string): string {
  if (name.toLowerCase().endsWith(".vcf.gz")) return "vcf.gz";
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

async function failBatch(
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ---- CORS preflight ----
  if (req.method === "OPTIONS") {
    for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return jsonResponse(res, { error: "Method not allowed" }, 405);
  }

  // ---- Auth ----
  const authHeader = req.headers["authorization"];
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) return jsonResponse(res, { error: "Missing authorization" }, 401);

  const { data: userData, error: userErr } =
    await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData.user) {
    return jsonResponse(res, { error: "Invalid or expired session" }, 401);
  }
  const userId = userData.user.id;

  // ---- Parse multipart form data using busboy ----
  const fields: Record<string, string> = {};
  const fileBuffers: Map<string, { data: Buffer; filename: string; mimeType: string }> = new Map();

  try {
    await new Promise<void>((resolve, reject) => {
      const busboy = Busboy({ headers: req.headers });

      busboy.on("file", (fieldname, stream, info) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on("end", () => {
          fileBuffers.set(fieldname, {
            data: Buffer.concat(chunks),
            filename: info.filename,
            mimeType: info.mimeType,
          });
        });
        stream.on("error", reject);
      });

      busboy.on("field", (key, value) => {
        fields[key] = value;
      });

      busboy.on("finish", resolve);
      busboy.on("error", reject);

      req.pipe(busboy);
    });
  } catch {
    return jsonResponse(res, { error: "Invalid form data" }, 400);
  }

  const zipInfo = fileBuffers.get("file");
  if (!zipInfo) {
    return jsonResponse(res, { error: "Missing zip file" }, 400);
  }

  const folderName = fields["folder_name"] ?? "";
  const originalZipName = fields["original_zip_name"] ?? "";
  const forceAssembly = (fields["force_assembly"] ?? "").trim();

  let filesMeta: { name: string; size: number }[];
  try {
    filesMeta = JSON.parse(fields["files_meta"] ?? "[]");
  } catch {
    return jsonResponse(res, { error: "Invalid files metadata" }, 400);
  }

  if (!folderName || !originalZipName || filesMeta.length === 0) {
    return jsonResponse(res, { error: "Missing required metadata (folder_name, original_zip_name, files_meta)" }, 400);
  }

  if (!forceAssembly || !["hg19", "hg38"].includes(forceAssembly)) {
    return jsonResponse(res, { error: "Invalid or missing genome assembly. Must be hg19 or hg38." }, 400);
  }

  // ---- Read and validate ZIP ----
  const zipBuffer = zipInfo.data.buffer.slice(
    zipInfo.data.byteOffset,
    zipInfo.data.byteOffset + zipInfo.data.byteLength,
  ) as ArrayBuffer;

  let vcfFileNames: string[];
  try {
    const validation = await validateZip(zipBuffer);
    vcfFileNames = validation.fileNames;
  } catch (e) {
    const offending = (e as any).offending as string[] | undefined;
    return jsonResponse(res, {
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
      zip_storage_path: "pending",
      assembly: forceAssembly,
    })
    .select("id")
    .single();

  if (batchErr || !batch) {
    return jsonResponse(res, { error: batchErr?.message ?? "Failed to create batch" }, 500);
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
    return jsonResponse(res, { error: filesErr?.message ?? "Failed to register files" }, 500);
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
    await failBatch(batchId, insertedFiles, "Processing API not configured");
    await log("error", "processing", "PROCESSING_API_URL is not configured.");
    return jsonResponse(res, { error: "Processing API not configured" }, 500);
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
      body: apiForm as any,
    });

    if (!apiRes.ok) {
      const text = await apiRes.text().catch(() => "");
      throw new Error(`API responded ${apiRes.status}: ${text.slice(0, 500)}`);
    }

    await log("info", "processing", "Processing pipeline triggered successfully.");
  } catch (e) {
    await failBatch(batchId, insertedFiles, (e as Error).message);
    await log("error", "processing", `Processing API failed: ${(e as Error).message}`);
    return jsonResponse(res, {
      batchId,
      status: "failed",
      total: vcfFileNames.length,
      processed: 0,
      failed: vcfFileNames.length,
    });
  }

  // ---- Return immediately ----
  // NOTE: Background S3 polling is handled by the frontend via /api/check-batch-results.
  // Vercel serverless functions terminate after response, so no background work here.
  return jsonResponse(res, {
    batchId,
    status: "processing",
    total: vcfFileNames.length,
    processed: 0,
    failed: 0,
  });
}
