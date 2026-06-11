import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  FileText,
  Download,
  AlertCircle,
  FolderOpen,
  ScrollText,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatDateTime, shortId } from "@/lib/format";
import type { GeneratedResult, UploadBatch, UploadedFile } from "@/types/app";

export const Route = createFileRoute("/_authenticated/history/$batchId")({
  component: BatchDetailPage,
});

interface FileWithResults extends UploadedFile {
  generated_results: GeneratedResult[];
}

interface LogRow {
  id: string;
  log_level: string;
  step_name: string | null;
  message: string;
  created_at: string;
}

async function fetchBatchDetail(batchId: string) {
  const [batchRes, filesRes, logsRes] = await Promise.all([
    supabase.from("upload_batches").select("*").eq("id", batchId).maybeSingle(),
    supabase
      .from("uploaded_files")
      .select("*, generated_results(*)")
      .eq("batch_id", batchId)
      .order("file_name", { ascending: true }),
    supabase
      .from("processing_logs")
      .select("id, log_level, step_name, message, created_at")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true }),
  ]);

  if (batchRes.error) throw new Error(batchRes.error.message);
  if (filesRes.error) throw new Error(filesRes.error.message);

  return {
    batch: batchRes.data as UploadBatch | null,
    files: (filesRes.data as FileWithResults[]) ?? [],
    logs: (logsRes.data as LogRow[]) ?? [],
  };
}

function BatchDetailPage() {
  const { batchId } = useParams({ from: "/_authenticated/history/$batchId" });
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["batch", batchId],
    queryFn: () => fetchBatchDetail(batchId),
    refetchInterval: (q) =>
      q.state.data?.batch?.status === "processing" ? 5000 : false,
  });

  // Trigger server-side discovery polling when batch is processing
  useEffect(() => {
    if (data?.batch?.status !== "processing") return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const triggerDiscovery = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token || cancelled) return;

        const res = await fetch("/api/check-batch-results", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ batchId }),
        });

        if (!cancelled && res.ok) {
          const result = await res.json();
          console.log("[discovery poll]", result);
          // Refresh the batch detail query with fresh DB state
          queryClient.invalidateQueries({ queryKey: ["batch", batchId] });
        }
      } catch {
        // Silent retry — next tick will attempt again
      }
    };

    // Trigger discovery IMMEDIATELY (no delay) for already-processing batches
    triggerDiscovery();

    // Then poll every 5 seconds
    intervalId = setInterval(triggerDiscovery, 5000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [data?.batch?.status, batchId, queryClient]);

  const handleDownload = async (resultId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Session expired. Please sign in again.");

      const res = await fetch("/api/report-proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ resultId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to download" }));
        throw new Error(body.error ?? `Download failed (${res.status})`);
      }

      const html = await res.text();
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-28 rounded-md" />
        <Skeleton className="h-64 rounded-md" />
      </div>
    );
  }

  const batch = data?.batch;
  if (!batch) {
    return (
      <div className="space-y-6">
        <Link
          to="/history"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to history
        </Link>
        <div className="rounded-md border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">
            This batch could not be found or you do not have access to it.
          </p>
        </div>
      </div>
    );
  }

  const files = data?.files ?? [];
  const logs = data?.logs ?? [];

  return (
    <div className="space-y-8">
      <Link
        to="/history"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to history
      </Link>

      {/* Batch summary */}
      <div className="rounded-md border border-border bg-card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-sm bg-primary/10 text-primary">
              <FolderOpen className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                {batch.folder_name}
              </h1>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                Batch {shortId(batch.id)}
              </p>
            </div>
          </div>
          <StatusBadge status={batch.status} />
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
          <Detail label="Total files" value={String(batch.total_files)} />
          <Detail label="Completed" value={String(batch.processed_files)} />
          <Detail label="Failed" value={String(batch.failed_files)} />
          <Detail label="Assembly" value={batch.assembly ?? "\u2014"} />
          <Detail label="Upload size" value={formatBytes(batch.upload_size_bytes)} />
          <Detail label="Uploaded" value={formatDateTime(batch.created_at)} />
          <Detail label="Processing started" value={formatDateTime(batch.processing_started_at)} />
          <Detail label="Completed at" value={formatDateTime(batch.processing_completed_at)} />
          <Detail label="Archive" value={batch.original_zip_name ?? "\u2014"} />
        </dl>
      </div>

      {/* Files + results */}
      <div className="rounded-md border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Files &amp; Generated Reports</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">File</th>
                <th className="px-5 py-3 font-medium">Size</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Result</th>
                <th className="px-5 py-3 font-medium text-right">Report</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => {
                const result = f.generated_results?.[0];
                return (
                  <tr key={f.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="font-mono text-xs text-foreground">{f.file_name}</span>
                      </div>
                      {f.status === "failed" && f.error_message ? (
                        <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                          <AlertCircle className="h-3 w-3" />
                          {f.error_message}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-muted-foreground">
                      {formatBytes(f.file_size_bytes)}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={f.status} />
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                      {result ? result.result_file_name : "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {result ? (
                        <Button variant="outline" size="sm" onClick={() => handleDownload(result.id)}>
                          <Download className="mr-1.5 h-4 w-4" />
                          Download
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Unavailable</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Processing logs */}
      {logs.length > 0 ? (
        <div className="rounded-md border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-5 py-4">
            <ScrollText className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Processing Log</h2>
          </div>
          <ul className="divide-y divide-border">
            {logs.map((l) => (
              <li key={l.id} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    l.log_level === "error"
                      ? "bg-destructive"
                      : l.log_level === "warn"
                        ? "bg-warning"
                        : "bg-primary"
                  }`}
                />
                <span className="w-36 shrink-0 font-mono text-xs text-muted-foreground">
                  {formatDateTime(l.created_at)}
                </span>
                <span className="w-20 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                  {l.step_name}
                </span>
                <span className="text-foreground">{l.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium text-foreground">{value}</dd>
    </div>
  );
}
