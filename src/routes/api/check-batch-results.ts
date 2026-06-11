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

export const APIRoute = createAPIFileRoute("/api/check-batch-results")({
  POST: async ({ request }) => {
    // ---- Auth ----
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: userData, error: userErr } =
      await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData.user) {
      return json({ error: "Invalid or expired session" }, 401);
    }
    const userId = userData.user.id;

    // ---- Parse body ----
    let payload: { batchId?: string };
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const batchId = payload?.batchId;
    if (!batchId) return json({ error: "Missing batchId" }, 400);

    // ---- Verify batch belongs to user ----
    const { data: batch, error: batchErr } = await supabaseAdmin
      .from("upload_batches")
      .select("id, status")
      .eq("id", batchId)
      .eq("user_id", userId)
      .maybeSingle();

    if (batchErr || !batch) {
      return json({ error: "Batch not found or access denied" }, 404);
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

      return json({
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
      const { discoverAndPersistResults } = await import(
        "@/services/result-discovery.service"
      );
      const result = await discoverAndPersistResults(supabaseAdmin, userId, batchId);
      return json(result);
    } catch (e) {
      console.error(`[check-batch-results] Error for batch ${batchId}:`, e);
      return json(
        { error: `Discovery failed: ${(e as Error).message}` },
        500,
      );
    }
  },
});
