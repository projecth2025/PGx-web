import { useEffect, useState, useRef } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ShieldCheck, Lock, Server, Loader2, Mail } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("login");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  // Login fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Signup fields
  const [fullName, setFullName] = useState("");
  const [org, setOrg] = useState("");
  const [suEmail, setSuEmail] = useState("");

  // Signup step: "info" | "verify" | "password"
  const [signupStep, setSignupStep] = useState<"info" | "verify" | "password">("info");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupConfirm, setSetupConfirm] = useState("");
  const passwordHandled = useRef(false);

  const passwordsMismatch = setupConfirm.length > 0 && setupPassword !== setupConfirm;

  // Check for existing session or OAuth callback
  useEffect(() => {
    const checkSession = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", session.user.id)
          .maybeSingle();
        if (profile?.full_name) {
          navigate({ to: "/upload", replace: true });
        } else {
          navigate({ to: "/complete-profile", replace: true });
        }
        return;
      }
      setCheckingSession(false);
    };
    checkSession();

    // Listen for auth state changes (OAuth callback + email verification)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session) {
        // Don't redirect if we're in the signup verification flow
        if (signupStep === "verify") return;
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", session.user.id)
          .maybeSingle();
        if (profile?.full_name) {
          navigate({ to: "/upload", replace: true });
        } else {
          navigate({ to: "/complete-profile", replace: true });
        }
        return;
      }

      // Email verification detected
      if (event === "USER_UPDATED" && session?.user?.email_confirmed_at && !passwordHandled.current) {
        passwordHandled.current = true;
        setSignupStep("password");
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate, signupStep]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Signed in");
    navigate({ to: "/upload", replace: true });
  };

  // Step 1 → Step 2: Create user + send verification email
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Generate a secure random temp password (user will set real one after verification)
    const tempPassword = crypto.randomUUID() + "-T!";

    const { error } = await supabase.auth.signUp({
      email: suEmail,
      password: tempPassword,
      options: {
        emailRedirectTo: `${window.location.origin}/auth`,
        data: { full_name: fullName, organization_name: org || "" },
      },
    });

    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    // Store signup info for the password-setup step
    try {
      sessionStorage.setItem("pgx_signup", JSON.stringify({ fullName, org, email: suEmail }));
    } catch { /* ignore */ }

    setSignupStep("verify");
  };

  // Step 3 → Step 4: User sets their real password after email verification
  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (setupPassword.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (setupPassword !== setupConfirm) {
      toast.error("Passwords do not match.");
      return;
    }
    setLoading(true);

    // Update the user's password
    const { error: updateErr } = await supabase.auth.updateUser({ password: setupPassword });
    if (updateErr) {
      toast.error(updateErr.message);
      setLoading(false);
      return;
    }

    // Retrieve signup info and save profile
    let signupInfo = { fullName: "", org: "" };
    try {
      const stored = sessionStorage.getItem("pgx_signup");
      if (stored) {
        signupInfo = JSON.parse(stored);
        sessionStorage.removeItem("pgx_signup");
      }
    } catch { /* ignore */ }

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").upsert(
        {
          id: user.id,
          full_name: signupInfo.fullName || user.user_metadata?.full_name || "",
          organization_name: signupInfo.org || user.user_metadata?.organization_name || "",
        },
        { onConflict: "id" },
      );
    }

    setLoading(false);
    toast.success("Account created successfully!");
    navigate({ to: "/upload", replace: true });
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth` },
    });
    setLoading(false);
    if (error) toast.error(error.message);
  };

  // Show loading state while checking session (OAuth callback handling)
  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Completing sign in...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <Logo variant="light" />
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Secure genomic report processing for laboratories and hospitals
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-sidebar-foreground/70">
            Upload VCF batches, process them through validated pipelines, and manage
            generated clinical reports — all within a controlled, access-restricted
            environment.
          </p>
          <ul className="mt-8 space-y-3 text-sm">
            <li className="flex items-center gap-3 text-sidebar-foreground/80">
              <ShieldCheck className="h-4 w-4 text-sidebar-primary" />
              Row-level access control on all records
            </li>
            <li className="flex items-center gap-3 text-sidebar-foreground/80">
              <Lock className="h-4 w-4 text-sidebar-primary" />
              Encrypted credentials and signed file access
            </li>
            <li className="flex items-center gap-3 text-sidebar-foreground/80">
              <Server className="h-4 w-4 text-sidebar-primary" />
              Server-side processing with full audit logs
            </li>
          </ul>
        </div>
        <p className="text-xs text-sidebar-foreground/40">
          For authorized clinical and research personnel only.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-background px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>

          {signupStep === "password" ? (
            /* ── Step 3: Password Setup (after email verification) ── */
            <>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Complete Account Setup
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Your email is verified. Set your password to finish creating your account.
              </p>
              <form onSubmit={handleSetPassword} className="mt-8 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="setupPassword">Set Password</Label>
                  <Input
                    id="setupPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="setupConfirm">Confirm Password</Label>
                  <Input
                    id="setupConfirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={setupConfirm}
                    onChange={(e) => setSetupConfirm(e.target.value)}
                    placeholder="Re-enter your password"
                    aria-invalid={passwordsMismatch}
                  />
                  {passwordsMismatch ? (
                    <p className="text-xs font-medium text-destructive">Passwords do not match.</p>
                  ) : null}
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading || passwordsMismatch || !setupPassword || !setupConfirm}
                >
                  {loading ? "Creating account…" : "Create Account"}
                </Button>
              </form>
            </>
          ) : (
            /* ── Steps 1 & 2: Login/Signup tabs ── */
            <>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Access your workspace
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in with your institutional account to continue.
              </p>

              <Tabs value={tab} onValueChange={setTab} className="mt-8">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="login">Sign In</TabsTrigger>
                  <TabsTrigger value="signup">Create Account</TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="mt-6">
                  <GoogleButton onClick={handleGoogleAuth} disabled={loading} />
                  <OrSeparator />
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email address</Label>
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@institution.org"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="password">Password</Label>
                        <Link
                          to="/forgot-password"
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Forgot password?
                        </Link>
                      </div>
                      <Input
                        id="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? "Signing in…" : "Sign In"}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="signup" className="mt-6">
                  <GoogleButton onClick={handleGoogleAuth} disabled={loading} />
                  <OrSeparator />
                  <form onSubmit={handleSignup} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="fullName">Full name</Label>
                      <Input
                        id="fullName"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Dr. Jane Doe"
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
                    <div className="space-y-1.5">
                      <Label htmlFor="suEmail">Email address</Label>
                      <Input
                        id="suEmail"
                        type="email"
                        autoComplete="email"
                        required
                        value={suEmail}
                        onChange={(e) => setSuEmail(e.target.value)}
                        placeholder="name@institution.org"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={loading || !fullName || !suEmail}
                    >
                      {loading ? "Sending verification…" : "Create Account"}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </div>

      {/* ── Email Verification Modal ── */}
      {signupStep === "verify" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="mx-4 w-full max-w-md rounded-lg border border-border bg-card p-8 shadow-xl">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Mail className="h-7 w-7 text-primary" />
              </div>
              <h2 className="mt-5 text-xl font-semibold text-foreground">
                Check Your Email
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                We have sent a confirmation email to{" "}
                <span className="font-medium text-foreground">{suEmail}</span>.
                Please open your inbox and click the verification link to continue
                creating your account.
              </p>
              <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Waiting for verification…
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Shared Google OAuth button ─────────────────────────────────────── */
function GoogleButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={disabled}
      onClick={onClick}
    >
      <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
      Continue with Google
    </Button>
  );
}

/* ── "or" divider ───────────────────────────────────────────────────── */
function OrSeparator() {
  return (
    <div className="my-5 flex items-center gap-3">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        or
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
