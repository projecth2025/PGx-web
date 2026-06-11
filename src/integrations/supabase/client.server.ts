import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  const missing = [
    ...(!supabaseUrl ? ["SUPABASE_URL"] : []),
    ...(!supabaseServiceRoleKey ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
  ];
  throw new Error(
    `Missing server environment variables: ${missing.join(", ")}. Ensure these are set in your .env.local or hosting environment.`
  );
}

/**
 * Server-side Supabase admin client with service role key.
 * This bypasses RLS and should only be used for privileged server operations.
 * IMPORTANT: Never expose this client to the browser.
 */
export const supabaseAdmin: SupabaseClient = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      // @ts-expect-error ws types mismatch with browser WebSocket interface
      transport: WebSocket,
    },
  }
);
