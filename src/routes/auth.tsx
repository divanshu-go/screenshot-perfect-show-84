import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — CanaryGrid" },
      { name: "description", content: "Sign in to your CanaryGrid workspace." },
      { property: "og:title", content: "Sign in — CanaryGrid" },
      { property: "og:description", content: "Sign in to your CanaryGrid workspace." },
    ],
  }),
  component: AuthPage,
});

const emailSchema = z.string().trim().email("Enter a valid work email").max(255);

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash.includes("error_code=otp_expired")) setError("That sign-in link has expired. Request a new one below.");
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/overview", replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) navigate({ to: "/overview", replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Invalid input");
    setState("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data,
      options: { emailRedirectTo: `${window.location.origin}/auth` },
    });
    if (error) {
      setState("idle");
      setError(/rate/i.test(error.message) ? "Too many requests. Wait a minute and try again." : error.message);
    } else setState("sent");
  }

  async function google() {
    setError(null);
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: `${window.location.origin}/auth` });
    if (r.error) setError("Google sign-in didn't complete. Try again.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <span className="flex items-center gap-2 font-semibold">
          <span className="grid h-6 w-6 place-items-center rounded bg-primary font-mono text-xs text-primary-foreground">cg</span>
          CanaryGrid
        </span>
        <h1 className="mt-8 text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">We'll email you a one-time sign-in link.</p>

        {state === "sent" ? (
          <div className="mt-6 rounded-md border bg-card p-4 text-sm">
            Check <span className="font-medium">{email}</span> for a sign-in link. It expires in one hour.
            <Button variant="link" className="h-auto p-0 pl-1" onClick={() => setState("idle")}>Use another email</Button>
          </div>
        ) : (
          <form onSubmit={sendLink} className="mt-6 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </div>
            <Button type="submit" className="w-full" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Email me a link"}
            </Button>
          </form>
        )}
        {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}

        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
        </div>
        <Button variant="outline" className="w-full" onClick={google}>Continue with Google</Button>
      </div>
    </div>
  );
}
