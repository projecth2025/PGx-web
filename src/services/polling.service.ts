import { objectExists } from "@/services/s3.service";

export interface PollOptions {
  initialDelayMs?: number;
  intervalMs?: number;
  timeoutMs?: number;
}

export async function pollForReports(
  paths: string[],
  opts: PollOptions = {},
  onFound?: (path: string) => Promise<void> | void,
): Promise<string[]> {
  const initial = opts.initialDelayMs ?? 15000;
  const interval = opts.intervalMs ?? 5000;
  const timeout = opts.timeoutMs ?? 30 * 60 * 1000; // 30 minutes

  await new Promise((r) => setTimeout(r, initial));

  const start = Date.now();
  const found = new Set<string>();

  while (Date.now() - start < timeout) {
    for (const p of paths) {
      if (found.has(p)) continue;
      try {
        const exists = await objectExists(p);
        if (exists) {
          found.add(p);
          if (onFound) await onFound(p);
        }
      } catch {
        // ignore transient errors
      }
    }

    if (found.size === paths.length) break;

    await new Promise((r) => setTimeout(r, interval));
  }

  return Array.from(found);
}
