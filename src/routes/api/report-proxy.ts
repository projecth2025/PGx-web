import { createAPIFileRoute } from "@/lib/api-route";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

export const APIRoute = createAPIFileRoute("/api/report-proxy")({
  POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.replace(/^Bearer\s+/i, "");
        if (!token) return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
        if (userErr || !userData.user) return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } });

        let payload: any;
        try {
          payload = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
        }

        const resultId = payload?.resultId;
        if (!resultId) return new Response(JSON.stringify({ error: "Missing resultId" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });

        const { data: result, error } = await supabaseAdmin.from("generated_results").select("result_storage_path").eq("id", resultId).maybeSingle();
        if (error || !result) return new Response(JSON.stringify({ error: "Result not found" }), { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } });

        const { getSignedUrl } = await import("@/lib/s3.server");
        const signed = await getSignedUrl(result.result_storage_path, "read");

        const res = await fetch(signed.url);
        if (!res.ok) return new Response(JSON.stringify({ error: "Failed to retrieve report" }), { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } });
        const html = await res.text();

        const headers = new Headers({
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none';",
          ...corsHeaders,
        });

        return new Response(html, { status: 200, headers });
      },
});
