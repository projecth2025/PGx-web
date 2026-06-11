import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

function initials(name: string | null | undefined, email: string | null | undefined) {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }
  return (email ?? "U").slice(0, 2).toUpperCase();
}

export function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const { profile, user } = useAuth();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onMenuClick}
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="hidden sm:block">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {profile?.organization_name || "Laboratory Workspace"}
          </p>
          <p className="text-sm font-semibold text-foreground">Genomic Report Console</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium leading-tight text-foreground">
            {profile?.full_name || "Lab User"}
          </p>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-primary text-sm font-semibold text-primary-foreground">
          {initials(profile?.full_name, user?.email)}
        </div>
      </div>
    </header>
  );
}
