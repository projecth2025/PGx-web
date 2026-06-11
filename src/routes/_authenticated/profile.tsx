import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  User,
  Building2,
  Mail,
  CalendarDays,
  BadgeCheck,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { applyTheme, getPreferredTheme, getStoredTheme, type Theme } from "@/lib/theme";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [org, setOrg] = useState("");
  const [saving, setSaving] = useState(false);
  const [theme, setTheme] = useState<Theme>(getPreferredTheme());

  const handleLogout = async () => {
    await signOut();
    toast.success("Signed out");
    navigate({ to: "/auth" });
  };

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
    setOrg(profile?.organization_name ?? "");
  }, [profile]);

  useEffect(() => {
    const currentTheme = getStoredTheme() ?? getPreferredTheme();
    setTheme(currentTheme);
  }, []);

  const handleThemeToggle = (checked: boolean) => {
    const nextTheme: Theme = checked ? "dark" : "light";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName, organization_name: org })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refreshProfile();
    toast.success("Profile updated");
  };

  return (
    <div className="space-y-8">
      <PageHeader title="Profile" description="Your account and organization details." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Identity card */}
        <div className="rounded-md border border-border bg-card p-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-sm bg-primary text-xl font-semibold text-primary-foreground">
            {(profile?.full_name || user?.email || "U").slice(0, 2).toUpperCase()}
          </div>
          <h2 className="mt-4 text-lg font-semibold text-foreground">
            {profile?.full_name || "Lab User"}
          </h2>
          <p className="text-sm text-muted-foreground">{profile?.organization_name || "—"}</p>

          <dl className="mt-6 space-y-4 text-sm">
            <Row icon={Mail} label="Email" value={user?.email ?? "—"} />
            <Row
              icon={BadgeCheck}
              label="Role"
              value={(profile?.role ?? "lab_staff").replace(/_/g, " ")}
            />
            <Row
              icon={CalendarDays}
              label="Member since"
              value={formatDate(profile?.created_at)}
            />
          </dl>
        </div>

        {/* Edit form */}
        <div className="lg:col-span-2">
          <div className="rounded-md border border-border bg-card p-6">
            <h2 className="text-sm font-semibold text-foreground">Account Details</h2>
            <form onSubmit={handleSave} className="mt-6 max-w-lg space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">
                  <User className="mr-1 inline h-3.5 w-3.5" /> Full name
                </Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Dr. Jane Doe"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org">
                  <Building2 className="mr-1 inline h-3.5 w-3.5" /> Organization / Laboratory
                </Label>
                <Input
                  id="org"
                  value={org}
                  onChange={(e) => setOrg(e.target.value)}
                  placeholder="City Hospital Genomics Lab"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">
                  <Mail className="mr-1 inline h-3.5 w-3.5" /> Email address
                </Label>
                <Input id="email" value={user?.email ?? ""} disabled />
                <p className="text-xs text-muted-foreground">
                  Email is managed by your authentication account and cannot be changed here.
                </p>
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </form>
          </div>

          <div className="mt-6 rounded-md border border-border bg-card p-6">
            <h2 className="text-sm font-semibold text-foreground">Appearance</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enable dark mode for a lower-light interface and saved preference.
            </p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sun className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-foreground">Light</span>
              </div>
              <Switch checked={theme === "dark"} onCheckedChange={handleThemeToggle} />
              <div className="flex items-center gap-2">
                <Moon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-foreground">Dark</span>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-md border border-border bg-card p-6">
            <h2 className="text-sm font-semibold text-foreground">Session</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign out of your account on this device.
            </p>
            <Button variant="outline" onClick={handleLogout} className="mt-4">
              <LogOut className="mr-1.5 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
        <dd className="truncate font-medium capitalize text-foreground">{value}</dd>
      </div>
    </div>
  );
}
