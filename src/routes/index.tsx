import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/app/brand-logo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CanaryGrid — Tenant compatibility release gate" },
      {
        name: "description",
        content:
          "Know which customer configurations a pull request could break. Safe API journeys against canary accounts, with evidence and documented waivers.",
      },
      { property: "og:title", content: "CanaryGrid — Tenant compatibility release gate" },
      {
        property: "og:description",
        content: "Know which customer configurations a pull request could break before you ship.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const rows = [
  ["EU · SAML · Salesforce · restricted", "passed"],
  ["US · OAuth · HubSpot · admin", "passed"],
  ["EU · SAML · HubSpot · flag:bulk_v2", "failed"],
  ["APAC · password · Salesforce · read-only", "passed"],
] as const;

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <BrandLogo />
          <Button asChild size="sm" variant="outline">
            <Link to="/auth">Sign in</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 sm:px-8">
        <section className="grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-[1fr_0.9fr] lg:gap-16">
          <div>
            <p className="mb-5 text-sm font-medium text-primary">
              Release safety for multi-tenant SaaS
            </p>
            <h1 className="max-w-2xl text-4xl font-semibold leading-[1.08] tracking-[-0.04em] sm:text-5xl">
              Know what breaks before it ships.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
              CanaryGrid tests each release against representative tenant configurations and returns
              evidence-backed pass, fail, or waiver decisions.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button asChild className="group">
                <Link to="/auth">
                  Open the control plane
                  <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="rounded-xl bg-muted/50 p-3 sm:p-5">
            <div className="w-full overflow-hidden rounded-lg border border-sidebar-border bg-card">
              <header className="flex items-center justify-between gap-4 border-b px-4 py-3">
                <div>
                  <p className="text-xs text-muted-foreground">Release gate · attempt 03</p>
                  <p className="mt-0.5 text-sm font-medium">acme/api · PR #1284</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/35 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning-foreground">
                  <span className="size-1.5 rounded-full bg-current" />
                  Blocked
                </span>
              </header>
              <div className="grid grid-cols-3 border-b">
                {[
                  ["04", "cohorts"],
                  ["03", "passed"],
                  ["01", "failed"],
                ].map(([value, label]) => (
                  <div key={label} className="border-r px-4 py-3 last:border-r-0">
                    <p className="text-xl font-semibold tabular-nums">{value}</p>
                    <p className="mt-0.5 text-xs capitalize text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
              <ul className="divide-y">
                {rows.map(([name, status], index) => (
                  <li
                    key={name}
                    className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent/25"
                  >
                    <span
                      className={
                        status === "passed"
                          ? "flex size-6 shrink-0 items-center justify-center rounded-full border border-success/30 bg-success/10 text-success"
                          : "flex size-6 shrink-0 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive"
                      }
                    >
                      {status === "passed" ? (
                        <Check className="size-3" />
                      ) : (
                        <X className="size-3" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs">{name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {(index + 1) * 384}ms
                    </span>
                  </li>
                ))}
              </ul>
              <footer className="flex items-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5 text-primary" />
                Evidence sanitized. No customer credentials persisted.
              </footer>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
