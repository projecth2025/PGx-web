import { useState } from "react";
import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserCheck } from "lucide-react";

export const Route = createFileRoute("/complete-profile")({
  ssr: false,
  beforeLoad: async () => {
    // Must be authenticated to access this page
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth" });
    }
    // If profile already exists with full_name, skip to app
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profile?.full_name) {
      throw redirect({ to: "/upload" });
    }
    return { user: data.user };
  },
  component: CompleteProfilePage,
});

function CompleteProfilePage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [org, setOrg] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error("Full Name is required.");
      return;
    }

    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      toast.error("Session expired. Please sign in again.");
      navigate({ to: "/auth", replace: true });
      return;
    }

    // Upsert profile — use upsert to handle both new and existing rows
    const { error } = await supabase.from("profiles").upsert(
      {
        id: user.id,
        full_name: fullName.trim(),
        organization_name: org.trim(),
      },
      { onConflict: "id" },
    );

    setLoading(false);

    if (error) {
      toast.error(`Failed to save profile: ${error.message}`);
      return;
    }

    toast.success("Profile complete! Welcome aboard.");
    navigate({ to: "/upload", replace: true });
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <Logo variant="light" />
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Complete your profile
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-sidebar-foreground/70">
            We need a few details to set up your workspace and associate your
            reports with your institution.
          </p>
          <div className="mt-8 flex items-center gap-3 text-sidebar-foreground/80">
            <UserCheck className="h-5 w-5 text-sidebar-primary" />
            <span className="text-sm">One-time setup — takes 10 seconds</span>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-background px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Complete your profile
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tell us who you are so we can personalize your experience.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Dr. Jane Doe"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org">
                Organization / Laboratory{" "}
                <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="org"
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                placeholder="City Hospital Genomics Lab"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !fullName.trim()}
            >
              {loading ? "Saving…" : "Complete Setup"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
