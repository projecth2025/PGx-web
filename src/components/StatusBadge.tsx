import { cn } from "@/lib/utils";
import type { BatchStatus, FileStatus } from "@/types/app";

type Status = BatchStatus | FileStatus | string;

const STYLES: Record<string, string> = {
  completed: "bg-success/12 text-success border-success/30",
  processing: "bg-primary/10 text-primary border-primary/30",
  pending: "bg-muted text-muted-foreground border-border",
  partial: "bg-warning/15 text-warning-foreground border-warning/40",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
};

const LABELS: Record<string, string> = {
  completed: "Completed",
  processing: "Processing",
  pending: "Pending",
  partial: "Partial",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: Status }) {
  const key = status.toLowerCase();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-medium",
        STYLES[key] ?? STYLES.pending,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {LABELS[key] ?? status}
    </span>
  );
}
