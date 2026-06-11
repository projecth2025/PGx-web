/**
 * Error reporting utility.
 * Replace with your own error tracking service (Sentry, LogRocket, etc.)
 */

export interface ErrorContext {
  boundary?: string;
  [key: string]: unknown;
}

/**
 * Report an error for tracking and monitoring.
 * Currently logs to console. Replace with your preferred error tracking service.
 * 
 * Example with Sentry:
 * import * as Sentry from "@sentry/react";
 * 
 * export function reportError(error: unknown, context: ErrorContext = {}) {
 *   Sentry.captureException(error, { contexts: { custom: context } });
 * }
 */
export function reportError(error: unknown, context: ErrorContext = {}) {
  const errorData = {
    timestamp: new Date().toISOString(),
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    context,
    url: typeof window !== "undefined" ? window.location.href : undefined,
  };

  // Log to console in development
  if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
    console.error("[Error Report]", errorData);
  }

  // TODO: Send to your error tracking service
  // Example: await fetch('/api/errors', { method: 'POST', body: JSON.stringify(errorData) })
}

/**
 * Alias for backwards compatibility
 */
export function reportLovableError(error: unknown, context: Record<string, unknown> = {}) {
  reportError(error, context as ErrorContext);
}
