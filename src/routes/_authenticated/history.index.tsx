import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { History as HistoryIcon, FolderUp, Upload, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { UploadBatch } from "@/types/app";

export const Route = createFileRoute("/_authenticated/history/")({
  component: HistoryPage,
});

async function fetchBatches(): Promise<UploadBatch[]> {
  const { data, error } = await supabase
    .from("upload_batches")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as UploadBatch[]) ?? [];
}

function HistoryPage() {
  const queryClient = useQueryClient();

  const { data: batches, isLoading } = useQuery({
    queryKey: ["batches"],
    queryFn: fetchBatches,
    refetchInterval: (q) => {
      // Refetch every 5s if any batch is still processing
      const hasProcessing = q.state.data?.some((b: UploadBatch) => b.status === "processing");
      return hasProcessing ? 5000 : false;
    },
  });

  // Trigger discovery for any processing batches
  useEffect(() => {
    const processingBatches = (batches ?? []).filter((b) => b.status === "processing");
    if (processingBatches.length === 0) return;

    let cancelled = false;

    const triggerDiscovery = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token || cancelled) return;

        for (const batch of processingBatches) {
          if (cancelled) break;
          await fetch("/api/check-batch-results", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ batchId: batch.id }),
          });
        }

        if (!cancelled) {
          queryClient.invalidateQueries({ queryKey: ["batches"] });
        }
      } catch {
        // Silent retry
      }
    };

    triggerDiscovery();
    const intervalId = setInterval(triggerDiscovery, 10_000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [batches, queryClient]);

  const list = batches ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Upload History"
        description="All uploaded folders and their processing outcomes."
        actions={
          <Button asChild>
            <Link to="/upload">
              <Upload className="mr-1.5 h-4 w-4" />
              New Upload
            </Link>
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-md" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={FolderUp}
          title="No upload history"
          description="Once you upload and process a folder, it will appear here for review and download."
          action={
            <Button asChild>
              <Link to="/upload">
                <Upload className="mr-1.5 h-4 w-4" />
                Upload Files
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Folder</th>
                  <th className="px-5 py-3 font-medium">Assembly</th>
                  <th className="px-5 py-3 font-medium">Total</th>
                  <th className="px-5 py-3 font-medium">Completed</th>
                  <th className="px-5 py-3 font-medium">Failed</th>
                  <th className="px-5 py-3 font-medium">Size</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Uploaded</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-5 py-3">
                      <Link
                        to="/history/$batchId"
                        params={{ batchId: b.id }}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {b.folder_name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{b.assembly ?? "\u2014"}</td>
                    <td className="px-5 py-3 tabular-nums text-muted-foreground">{b.total_files}</td>
                    <td className="px-5 py-3 tabular-nums text-success">{b.processed_files}</td>
                    <td className="px-5 py-3 tabular-nums text-destructive">{b.failed_files}</td>
                    <td className="px-5 py-3 tabular-nums text-muted-foreground">
                      {formatBytes(b.upload_size_bytes)}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDateTime(b.created_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        to="/history/$batchId"
                        params={{ batchId: b.id }}
                        className="inline-flex items-center text-muted-foreground hover:text-primary"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
