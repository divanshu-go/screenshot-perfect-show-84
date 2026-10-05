# Database environments

CanaryGrid uses PostgreSQL in every environment. Local development runs the
Supabase stack. Production uses hosted Supabase. The application uses the same
Supabase client and row-level security in both places.

## Responsibilities

- `supabase/migrations` owns the versioned schema.
- `supabase-js` owns browser authentication and RLS-scoped data access.
- PostgreSQL row-level security remains the authorization boundary.
- `DATABASE_URL` is server tooling only and must never use a `VITE_` prefix.

Browser code uses the generated Supabase client so database credentials never
enter the bundle.

## Local setup

Requirements: Docker and Bun.

```sh
bun run db:start
bun run db:status
```

Copy `.env.example` to `.env`. Use the API URL and publishable key printed by
`db:status`.

Apply migrations and the local seed:

```sh
bun run db:reset
bun run db:types
```

Run the app with `bun run dev`. Use `bun run db:stop` when finished.

## Hosted Supabase

Create a Supabase project, then configure:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `DATABASE_URL` with the migration-safe PostgreSQL connection string

Run `bun run db:push` from a trusted local shell or CI environment. Do not run
`supabase/seed.sql` on a hosted project. Never expose `DATABASE_URL`, the
service-role key, or database passwords to Vite.
