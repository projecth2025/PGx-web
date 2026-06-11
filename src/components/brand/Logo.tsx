import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  variant?: "light" | "dark";
  showWordmark?: boolean;
}

/** GenomeLab brand mark — a clinical double-helix glyph. */
export function Logo({ className, variant = "dark", showWordmark = true }: LogoProps) {
  const markColor = variant === "light" ? "text-sidebar-primary" : "text-primary";
  const textColor = variant === "light" ? "text-sidebar-foreground" : "text-foreground";

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-sm border",
          variant === "light"
            ? "border-sidebar-border bg-sidebar-accent"
            : "border-border bg-primary/8",
          markColor,
        )}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M7 3c0 4 10 6 10 9s-10 5-10 9" />
          <path d="M17 3c0 4-10 6-10 9s10 5 10 9" />
          <path d="M8.5 6h7M8.5 18h7M7.5 9.5h9M7.5 14.5h9" strokeWidth="1.2" />
        </svg>
      </span>
      {showWordmark ? (
        <div className="leading-none">
          <span className={cn("text-base font-semibold tracking-tight", textColor)}>
            Genome<span className={markColor}>Lab</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
