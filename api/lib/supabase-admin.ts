/**
 * Simplified Supabase admin client for Vercel Serverless Functions.
 * Uses service role key for admin operations without auth tokens.
 */
import WebSocketImpl from "ws";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Polyfill globalThis.WebSocket for Node.js < 22.
// This runs BEFORE the createClient() call below because ES module
// imports are resolved in dependency order: ws loads first, then
// @supabase/supabase-js loads, then this module body executes.
// The Supabase Realtime check happens in the RealtimeClient constructor
// (called by createClient), not at module import time.
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as any).WebSocket = WebSocketImpl;
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  const missing = [
    ...(!supabaseUrl ? ["SUPABASE_URL"] : []),
    ...(!supabaseServiceRoleKey ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
  ];
  throw new Error(
    `Missing server environment variables: ${missing.join(", ")}.`
  );
}

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
      transport: WebSocketImpl,
    },
  }
);
