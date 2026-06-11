/**
 * Vercel Serverless Function: POST /api/check-batch-results
 *
 * Triggers S3 result discovery for a batch and returns current status.
 * The frontend polls this endpoint to get live updates on processing progress.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./lib/supabase-admin";
import { discoverAndPersistResults } from "../src/services/result-discovery.service";

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

function readJsonBody(req: VercelRequest): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString()));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
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

  // ---- Parse body ----
  let payload: { batchId?: string };
  try {
    payload = await readJsonBody(req);
  } catch {
    return jsonResponse(res, { error: "Invalid JSON" }, 400);
  }

  const batchId = payload?.batchId;
  if (!batchId) return jsonResponse(res, { error: "Missing batchId" }, 400);

  // ---- Verify batch belongs to user ----
  const { data: batch, error: batchErr } = await supabaseAdmin
    .from("upload_batches")
    .select("id, status")
    .eq("id", batchId)
    .eq("user_id", userId)
    .maybeSingle();

  if (batchErr || !batch) {
    return jsonResponse(res, { error: "Batch not found or access denied" }, 404);
  }

  // If batch is already terminal, just return current state without S3 call
  if (batch.status === "completed" || batch.status === "failed" || batch.status === "partial") {
    const { data: files } = await supabaseAdmin
      .from("uploaded_files")
      .select("id, file_name, status")
      .eq("batch_id", batchId);

    const { data: results } = await supabaseAdmin
      .from("generated_results")
      .select("file_id, result_file_name")
      .in("file_id", (files ?? []).map((f: { id: string }) => f.id));

    const resultMap = new Map(
      (results ?? []).map((r: { file_id: string; result_file_name: string }) => [r.file_id, r.result_file_name]),
    );

    let completed = 0;
    let failed = 0;
    const reports = (files ?? []).map((f: { id: string; file_name: string; status: string }) => {
      if (f.status === "completed") completed++;
      else if (f.status === "failed") failed++;
      return {
        fileName: f.file_name,
        reportFile: resultMap.get(f.id) ?? null,
        status: f.status,
      };
    });

    return jsonResponse(res, {
      totalFiles: reports.length,
      completedFiles: completed,
      pendingFiles: reports.length - completed - failed,
      failedFiles: failed,
      reports,
      allCompleted: true,
    });
  }

  // ---- Run discovery ----
  try {
    const result = await discoverAndPersistResults(supabaseAdmin, userId, batchId);
    return jsonResponse(res, result);
  } catch (e) {
    console.error(`[check-batch-results] Error for batch ${batchId}:`, e);
    return jsonResponse(res, { error: `Discovery failed: ${(e as Error).message}` }, 500);
  }
}
