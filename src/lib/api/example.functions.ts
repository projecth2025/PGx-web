/**
 * Example server-side helper functions.
 * These are plain async functions that run server-side when imported dynamically.
 */

import { getServerConfig } from "../config.server";

/**
 * Returns a greeting message with the current server mode.
 */
export function getGreeting(name: string): { greeting: string; mode: string } {
  const config = getServerConfig();
  return {
    greeting: `Hello, ${name}!`,
    mode: config.nodeEnv ?? "unknown",
  };
}
