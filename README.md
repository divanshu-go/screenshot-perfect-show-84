# CanaryGrid

Tenant compatibility release gate for multi-tenant SaaS.

CanaryGrid runs API journeys against representative tenant configurations and records pass, fail, and waiver evidence before a release ships.

## Local development

Requirements: Bun, Docker, and the Supabase CLI.

```sh
bun install
cp .env.example .env
bun run db:start
bun run db:status
bun run dev
```

Copy the local API URL and publishable key from `bun run db:status` into `.env`. Sign-in uses a magic link. On this machine the message stays in the local mail viewer at http://127.0.0.1:54324.

## Database

Schema changes live in `supabase/migrations`. Reset the local database with `bun run db:reset`. Generate TypeScript types with `bun run db:types`.

Hosted Supabase and the GitHub App are documented in `MANUAL_SETUP.md`.
