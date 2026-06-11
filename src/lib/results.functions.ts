/**
 * Server-side result download URL helper.
 * This module is imported dynamically by API routes, not by client code.
 */

/**
 * Generates a short-lived signed S3 download URL for a generated result.
 */
export async function getResultDownloadUrl(resultId: string): Promise<{
  url: string;
  fileName: string;
  expiresIn: number;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: result, error } = await supabaseAdmin
    .from("generated_results")
    .select("id, result_storage_path, result_file_name")
    .eq("id", resultId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!result) throw new Error("Result not found or access denied");

  const { getSignedUrl } = await import("@/lib/s3.server");
  const signed = await getSignedUrl(result.result_storage_path, "read");

  return {
    url: signed.url,
    fileName: result.result_file_name,
    expiresIn: signed.expires_in,
  };
}
