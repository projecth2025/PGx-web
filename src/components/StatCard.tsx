import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  accent?: "primary" | "success" | "destructive" | "muted";
  hint?: string;
}

const ACCENTS: Record<string, string> = {
  primary: "text-primary bg-primary/10",
  success: "text-success bg-success/12",
  destructive: "text-destructive bg-destructive/10",
  muted: "text-muted-foreground bg-muted",
};

export function StatCard({ label, value, icon: Icon, accent = "primary", hint }: StatCardProps) {
  return (
    <div className="rounded-md border border-border bg-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{value}</p>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-sm", ACCENTS[accent])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
