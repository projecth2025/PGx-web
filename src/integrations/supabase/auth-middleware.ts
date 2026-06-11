/**
 * Server-side auth validation helper.
 * Validates Supabase JWT tokens for use in API route handlers.
 * NOTE: This is NOT TanStack Start middleware — auth is handled directly in API routes.
 */

/**
 * Validates a Bearer token and returns the user ID.
 * Throws if the token is invalid or expired.
 */
export async function validateAuthToken(token: string): Promise<string> {
  const { supabaseAdmin } = await import("./client.server");

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    throw new Error("Unauthorized: Invalid or expired token");
  }

  if (!user.id) {
    throw new Error("Unauthorized: No user ID found in token");
  }

  return user.id;
}
