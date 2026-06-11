/**
 * Client-side auth helper for API calls.
 * Provides a function to get the current Supabase auth token for use in fetch headers.
 */
import { supabase } from "./client";

/**
 * Get the current session's access token for authenticating API requests.
 * Returns null if no active session exists.
 */
export async function getAuthToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Build authorization headers with the current Supabase token.
 * Use this when making authenticated API calls from the client.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
