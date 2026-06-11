/**
 * Vercel Serverless Function: POST /api/report-proxy
 *
 * Fetches a genomic report HTML file from S3 via signed URL and returns
 * it to the frontend with appropriate CSP headers for safe rendering.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./lib/supabase-admin";
import { getSignedUrl } from "../src/lib/s3.server";

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
    return jsonResponse(res, { error: "Invalid session" }, 401);
  }

  // ---- Parse body ----
  let payload: any;
  try {
    payload = await readJsonBody(req);
  } catch {
    return jsonResponse(res, { error: "Invalid JSON" }, 400);
  }

  const resultId = payload?.resultId;
  if (!resultId) return jsonResponse(res, { error: "Missing resultId" }, 400);

  // ---- Fetch result record ----
  const { data: result, error } = await supabaseAdmin
    .from("generated_results")
    .select("result_storage_path")
    .eq("id", resultId)
    .maybeSingle();

  if (error || !result) {
    return jsonResponse(res, { error: "Result not found" }, 404);
  }

  // ---- Get signed URL and fetch HTML ----
  const signed = await getSignedUrl(result.result_storage_path, "read");

  const fetchRes = await fetch(signed.url);
  if (!fetchRes.ok) {
    return jsonResponse(res, { error: "Failed to retrieve report" }, 502);
  }
  const html = await fetchRes.text();

  // ---- Return HTML with CSP headers ----
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none';"
  );
  for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);

  return res.status(200).send(html);
}
