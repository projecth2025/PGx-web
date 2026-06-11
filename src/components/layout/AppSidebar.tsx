import { Link } from "@tanstack/react-router";
import { Upload, History, HelpCircle, Info, User } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/upload", label: "Upload Files", icon: Upload },
  { to: "/history", label: "History", icon: History },
  { to: "/how-it-works", label: "How It Works", icon: HelpCircle },
  { to: "/about", label: "About Us", icon: Info },
  { to: "/profile", label: "Profile", icon: User },
] as const;

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center border-b border-sidebar-border px-5">
        <Logo variant="light" />
      </div>

      <nav className="flex-1 space-y-1 px-3 py-5">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          Navigation
        </p>
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className="group flex items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            activeProps={{
              className: cn(
                "flex items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium",
                "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary",
              ),
            }}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <p className="px-3 text-[11px] text-sidebar-foreground/40">
          GenomeLab • Genomic Processing
        </p>
      </div>
    </div>
  );
}
