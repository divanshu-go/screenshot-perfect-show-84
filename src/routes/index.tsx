import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CanaryGrid — Tenant compatibility release gate" },
      { name: "description", content: "Know which customer configurations a pull request could break. Safe API journeys against canary accounts, with evidence and documented waivers." },
      { property: "og:title", content: "CanaryGrid — Tenant compatibility release gate" },
      { property: "og:description", content: "Know which customer configurations a pull request could break before you ship." },
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
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2 font-semibold">
          <span className="grid h-6 w-6 place-items-center rounded bg-primary font-mono text-xs text-primary-foreground">cg</span>
          CanaryGrid
        </span>
        <Button asChild size="sm" variant="outline"><Link to="/auth">Sign in</Link></Button>
      </header>
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-16">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Release gate for B2B SaaS</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Which customer configurations could this release break?
        </h1>
        <p className="mt-5 max-w-2xl text-muted-foreground">
          CanaryGrid models your representative tenants, runs safe API journeys against customer-owned canary accounts,
          and returns pass, fail, or a documented waiver on every pull request.
        </p>
        <div className="mt-8 flex gap-3">
          <Button asChild><Link to="/auth">Create a workspace</Link></Button>
        </div>

        <div className="mt-16 overflow-hidden rounded-md border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3 text-sm">
            <span className="font-mono text-xs text-muted-foreground">acme/api · PR #1284 · 3f9a2c1</span>
            <span className="rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 font-mono text-[11px] uppercase text-destructive">blocked</span>
          </div>
          <ul className="divide-y">
            {rows.map(([name, s]) => (
              <li key={name} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="font-mono text-xs">{name}</span>
                <span className={s === "passed" ? "font-mono text-[11px] uppercase text-success" : "font-mono text-[11px] uppercase text-destructive"}>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
