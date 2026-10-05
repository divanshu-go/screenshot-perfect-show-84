-- CanaryGrid canonical database schema.
-- This migration is the sole source of truth for local and hosted Supabase.

create extension if not exists pgcrypto with schema extensions;

create type public.workspace_role as enum ('owner', 'admin', 'engineer', 'viewer');
create type public.criticality as enum ('low', 'medium', 'high', 'critical');
create type public.release_status as enum ('discovered', 'planning', 'running', 'passed', 'failed', 'waived', 'error');
create type public.run_status as enum ('queued', 'running', 'passed', 'failed', 'error', 'cancelled');
create type public.run_trigger as enum ('manual', 'pull_request', 'rerun');
create type public.cluster_status as enum ('open', 'acknowledged', 'resolved', 'ignored');
create type public.http_method as enum ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD');
create type public.assertion_type as enum (
  'http_status',
  'json_path_equals',
  'json_path_exists',
  'json_path_type',
  'header_exists',
  'max_latency_ms'
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function private.reject_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id then
    raise exception 'Record identity cannot be changed';
  end if;
  if to_jsonb(new) ? 'workspace_id'
    and to_jsonb(new)->>'workspace_id' is distinct from to_jsonb(old)->>'workspace_id' then
    raise exception 'Workspace identity cannot be changed';
  end if;
  if to_jsonb(new) ? 'created_by'
    and to_jsonb(new)->>'created_by' is distinct from to_jsonb(old)->>'created_by' then
    raise exception 'Record creator cannot be changed';
  end if;
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  plan text not null default 'design_partner' check (plan in ('design_partner', 'standard')),
  retention_days integer not null default 30 check (retention_days between 7 and 365),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null,
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id),
  unique (workspace_id, id)
);
create index workspace_members_user_id_idx on public.workspace_members(user_id);

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  role public.workspace_role not null check (role <> 'owner'),
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);
create index workspace_invitations_workspace_id_idx on public.workspace_invitations(workspace_id);

create table public.workspace_allowed_hosts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  hostname text not null check (
    hostname = lower(hostname)
    and hostname !~ '[/:\s]'
    and char_length(hostname) between 1 and 253
  ),
  created_at timestamptz not null default now(),
  unique (workspace_id, hostname),
  unique (workspace_id, id)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  correlation_id uuid,
  created_at timestamptz not null default now()
);
create index audit_logs_workspace_created_idx on public.audit_logs(workspace_id, created_at desc);

create table public.github_installations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  installation_id bigint not null unique,
  github_account_id bigint,
  github_account_login text,
  repository_id bigint,
  repository_owner text,
  repository_name text,
  repository_full_name text,
  default_branch text not null default 'main',
  status text not null default 'active' check (status in ('active', 'suspended', 'removed')),
  installed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create index github_installations_workspace_id_idx on public.github_installations(workspace_id);

create table public.capabilities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  description text,
  criticality public.criticality not null default 'medium',
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name),
  unique (workspace_id, id)
);
create index capabilities_workspace_id_idx on public.capabilities(workspace_id);

create table public.capability_path_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  capability_id uuid not null,
  glob_pattern text not null check (char_length(glob_pattern) between 1 and 300),
  created_at timestamptz not null default now(),
  unique (capability_id, glob_pattern),
  foreign key (workspace_id, capability_id)
    references public.capabilities(workspace_id, id) on delete cascade
);
create index capability_path_rules_workspace_idx on public.capability_path_rules(workspace_id);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  provider_key text not null check (provider_key ~ '^[a-z0-9_-]{2,40}$'),
  environment text not null default 'sandbox',
  base_url text not null check (base_url ~ '^https://'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name),
  unique (workspace_id, id)
);
create index integrations_workspace_id_idx on public.integrations(workspace_id);

create table public.tenant_archetypes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  description text,
  region text not null default 'us',
  auth_mode text not null default 'password',
  permission_profile text not null default 'standard',
  active boolean not null default true,
  archived_at timestamptz,
  risk_weight integer not null default 50 check (risk_weight between 1 and 100),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name),
  unique (workspace_id, id),
  check (not active or archived_at is null)
);
create index tenant_archetypes_workspace_id_idx on public.tenant_archetypes(workspace_id);

create table public.archetype_capabilities (
  workspace_id uuid not null,
  archetype_id uuid not null,
  capability_id uuid not null,
  primary key (archetype_id, capability_id),
  foreign key (workspace_id, archetype_id)
    references public.tenant_archetypes(workspace_id, id) on delete cascade,
  foreign key (workspace_id, capability_id)
    references public.capabilities(workspace_id, id) on delete cascade
);

create table public.archetype_integrations (
  workspace_id uuid not null,
  archetype_id uuid not null,
  integration_id uuid not null,
  primary key (archetype_id, integration_id),
  foreign key (workspace_id, archetype_id)
    references public.tenant_archetypes(workspace_id, id) on delete cascade,
  foreign key (workspace_id, integration_id)
    references public.integrations(workspace_id, id) on delete cascade
);

create table public.credential_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid not null,
  archetype_id uuid,
  name text not null check (char_length(name) between 2 and 120),
  encrypted_payload text not null,
  encryption_version integer not null default 1 check (encryption_version > 0),
  health_status text not null default 'unknown'
    check (health_status in ('unknown', 'healthy', 'unhealthy', 'checking')),
  last_checked_at timestamptz,
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name),
  unique (workspace_id, id),
  foreign key (workspace_id, integration_id)
    references public.integrations(workspace_id, id) on delete restrict,
  foreign key (workspace_id, archetype_id)
    references public.tenant_archetypes(workspace_id, id) on delete set null (archetype_id)
);
create index credential_records_workspace_id_idx on public.credential_records(workspace_id);

create table public.journeys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  description text,
  integration_id uuid,
  active boolean not null default true,
  timeout_ms integer not null default 10000 check (timeout_ms between 500 and 60000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name),
  unique (workspace_id, id),
  foreign key (workspace_id, integration_id)
    references public.integrations(workspace_id, id) on delete set null (integration_id)
);
create index journeys_workspace_id_idx on public.journeys(workspace_id);

create table public.journey_capabilities (
  workspace_id uuid not null,
  journey_id uuid not null,
  capability_id uuid not null,
  primary key (journey_id, capability_id),
  foreign key (workspace_id, journey_id)
    references public.journeys(workspace_id, id) on delete cascade,
  foreign key (workspace_id, capability_id)
    references public.capabilities(workspace_id, id) on delete cascade
);

create table public.journey_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  journey_id uuid not null,
  position integer not null check (position >= 0),
  name text not null check (char_length(name) between 1 and 120),
  method public.http_method not null default 'GET',
  path_template text not null check (path_template ~ '^/' and char_length(path_template) <= 500),
  request_headers jsonb not null default '{}'::jsonb,
  request_body jsonb,
  extraction_rules jsonb not null default '[]'::jsonb,
  continue_on_failure boolean not null default false,
  is_cleanup boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (journey_id, is_cleanup, position),
  unique (workspace_id, id),
  foreign key (workspace_id, journey_id)
    references public.journeys(workspace_id, id) on delete cascade
);
create index journey_steps_journey_id_idx on public.journey_steps(journey_id);

create table public.journey_assertions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  journey_step_id uuid not null,
  assertion_type public.assertion_type not null,
  target text,
  operator text not null default 'eq',
  expected_value jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, journey_step_id)
    references public.journey_steps(workspace_id, id) on delete cascade
);
create index journey_assertions_step_id_idx on public.journey_assertions(journey_step_id);

create table public.releases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  github_installation_id uuid,
  repository_full_name text not null,
  pull_request_number integer check (pull_request_number > 0),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{7,40}$'),
  ref text,
  title text,
  author_login text,
  status public.release_status not null default 'discovered',
  check_run_id bigint,
  discovered_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, repository_full_name, commit_sha),
  unique (workspace_id, id),
  foreign key (workspace_id, github_installation_id)
    references public.github_installations(workspace_id, id) on delete set null (github_installation_id)
);
create index releases_workspace_created_idx on public.releases(workspace_id, created_at desc);

create table public.release_changed_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  release_id uuid not null,
  path text not null,
  additions integer not null default 0 check (additions >= 0),
  deletions integer not null default 0 check (deletions >= 0),
  status text,
  unique (release_id, path),
  foreign key (workspace_id, release_id)
    references public.releases(workspace_id, id) on delete cascade
);

create table public.release_capabilities (
  workspace_id uuid not null,
  release_id uuid not null,
  capability_id uuid not null,
  reason text,
  primary key (release_id, capability_id),
  foreign key (workspace_id, release_id)
    references public.releases(workspace_id, id) on delete cascade,
  foreign key (workspace_id, capability_id)
    references public.capabilities(workspace_id, id) on delete restrict
);

create table public.release_archetype_selections (
  workspace_id uuid not null,
  release_id uuid not null,
  archetype_id uuid not null,
  archetype_name text not null,
  selection_reason text,
  coverage_score numeric check (coverage_score between 0 and 1),
  primary key (release_id, archetype_id),
  foreign key (workspace_id, release_id)
    references public.releases(workspace_id, id) on delete cascade,
  foreign key (workspace_id, archetype_id)
    references public.tenant_archetypes(workspace_id, id) on delete restrict
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  release_id uuid,
  journey_id uuid,
  archetype_id uuid,
  journey_name text not null,
  archetype_name text not null,
  triggered_by uuid references auth.users(id) on delete set null,
  trigger_type public.run_trigger not null default 'manual',
  status public.run_status not null default 'queued',
  idempotency_key text,
  correlation_id uuid not null default gen_random_uuid(),
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, release_id)
    references public.releases(workspace_id, id) on delete set null (release_id),
  foreign key (workspace_id, journey_id)
    references public.journeys(workspace_id, id) on delete set null (journey_id),
  foreign key (workspace_id, archetype_id)
    references public.tenant_archetypes(workspace_id, id) on delete set null (archetype_id)
);
create index runs_workspace_created_idx on public.runs(workspace_id, created_at desc);
create index runs_release_id_idx on public.runs(release_id);

create table public.run_step_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  run_id uuid not null,
  journey_step_id uuid,
  step_name text not null,
  position integer not null check (position >= 0),
  status text not null check (status in ('queued', 'running', 'passed', 'failed', 'error', 'skipped')),
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  request_summary jsonb,
  response_summary jsonb,
  error_code text,
  error_message text,
  fingerprint text,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, run_id)
    references public.runs(workspace_id, id) on delete cascade,
  foreign key (workspace_id, journey_step_id)
    references public.journey_steps(workspace_id, id) on delete set null (journey_step_id)
);
create index run_step_results_run_id_idx on public.run_step_results(run_id);

create table public.assertion_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  run_step_result_id uuid not null,
  journey_assertion_id uuid,
  passed boolean not null,
  actual_value jsonb,
  message text,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, run_step_result_id)
    references public.run_step_results(workspace_id, id) on delete cascade,
  foreign key (workspace_id, journey_assertion_id)
    references public.journey_assertions(workspace_id, id) on delete set null (journey_assertion_id)
);

create table public.failure_clusters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  release_id uuid,
  fingerprint text not null,
  title text not null,
  summary text,
  suspected_cause text,
  status public.cluster_status not null default 'open',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, fingerprint),
  unique (workspace_id, id),
  foreign key (workspace_id, release_id)
    references public.releases(workspace_id, id) on delete set null (release_id)
);
create index failure_clusters_workspace_id_idx on public.failure_clusters(workspace_id);

create table public.failure_cluster_runs (
  workspace_id uuid not null,
  failure_cluster_id uuid not null,
  run_id uuid not null,
  primary key (failure_cluster_id, run_id),
  foreign key (workspace_id, failure_cluster_id)
    references public.failure_clusters(workspace_id, id) on delete cascade,
  foreign key (workspace_id, run_id)
    references public.runs(workspace_id, id) on delete cascade
);

create table public.waivers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  release_id uuid not null,
  failure_cluster_id uuid,
  scope text not null check (char_length(scope) between 2 and 200),
  reason text not null check (char_length(reason) between 10 and 2000),
  expires_at timestamptz,
  approved_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, release_id)
    references public.releases(workspace_id, id) on delete cascade,
  foreign key (workspace_id, failure_cluster_id)
    references public.failure_clusters(workspace_id, id) on delete restrict
);
create index waivers_release_id_idx on public.waivers(release_id);

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('github')),
  delivery_id text not null,
  event_name text not null,
  installation_id bigint,
  status text not null check (status in ('processing', 'completed', 'ignored', 'failed')),
  error_code text,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (provider, delivery_id)
);

create table public.request_idempotency (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  unique (workspace_id, actor_user_id, operation, idempotency_key)
);

create function private.is_workspace_member(_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = _workspace_id
      and member.user_id = auth.uid()
      and member.accepted_at is not null
      and member.accepted_at <= now()
  );
$$;

create function private.has_workspace_role(
  _workspace_id uuid,
  _roles public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = _workspace_id
      and member.user_id = auth.uid()
      and member.accepted_at is not null
      and member.accepted_at <= now()
      and member.role = any(_roles)
  );
$$;

create function private.can_admin(_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_workspace_role(
    _workspace_id,
    array['owner', 'admin']::public.workspace_role[]
  );
$$;

create function private.can_edit(_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_workspace_role(
    _workspace_id,
    array['owner', 'admin', 'engineer']::public.workspace_role[]
  );
$$;

create function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb := to_jsonb(coalesce(new, old));
  workspace uuid;
  record_id uuid;
begin
  workspace := nullif(row_data->>'workspace_id', '')::uuid;
  record_id := nullif(row_data->>'id', '')::uuid;
  if workspace is null and tg_table_name = 'workspaces' then
    workspace := record_id;
  end if;
  if workspace is null then
    return coalesce(new, old);
  end if;

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    workspace,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    record_id,
    jsonb_strip_nulls(jsonb_build_object(
      'name', row_data->>'name',
      'role', row_data->>'role',
      'status', row_data->>'status'
    ))
  );
  return coalesce(new, old);
end;
$$;

create function private.validate_waiver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_release_status public.release_status;
begin
  select status
  into current_release_status
  from public.releases
  where workspace_id = new.workspace_id and id = new.release_id
  for update;

  if current_release_status is distinct from 'failed'::public.release_status then
    raise exception 'Only failed releases can be waived';
  end if;
  if new.expires_at is not null and new.expires_at <= now() then
    raise exception 'Waiver expiry must be in the future';
  end if;
  if new.failure_cluster_id is not null and not exists (
    select 1
    from public.failure_clusters cluster
    where cluster.id = new.failure_cluster_id
      and cluster.workspace_id = new.workspace_id
      and cluster.release_id = new.release_id
      and cluster.status in ('open', 'acknowledged')
  ) then
    raise exception 'Waiver cluster must be an active failure for this release';
  end if;
  return new;
end;
$$;

create function private.enforce_archetype_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*)
    from public.tenant_archetypes archetype
    where archetype.workspace_id = new.workspace_id
      and archetype.archived_at is null
  ) >= 20 then
    raise exception 'A workspace can have at most 20 active tenant archetypes';
  end if;
  return new;
end;
$$;

create function public.create_workspace(_name text, _slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if char_length(trim(_name)) not between 2 and 80 then
    raise exception 'Workspace name must be between 2 and 80 characters';
  end if;
  if _slug !~ '^[a-z0-9][a-z0-9-]{1,48}$' then
    raise exception 'Workspace slug is invalid';
  end if;

  insert into public.workspaces (name, slug, created_by)
  values (trim(_name), _slug, auth.uid())
  returning id into workspace_id;

  insert into public.workspace_members (
    workspace_id,
    user_id,
    role,
    accepted_at
  )
  values (workspace_id, auth.uid(), 'owner', now());

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    workspace_id,
    auth.uid(),
    'insert',
    'workspaces',
    workspace_id,
    jsonb_build_object('name', trim(_name))
  );
  return workspace_id;
end;
$$;

create function public.archive_archetype(_archetype_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace uuid;
begin
  select workspace_id into workspace
  from public.tenant_archetypes
  where id = _archetype_id;

  if workspace is null or not private.can_admin(workspace) then
    raise exception 'Not authorized';
  end if;

  update public.tenant_archetypes
  set active = false, archived_at = now(), updated_at = now()
  where id = _archetype_id;
end;
$$;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create trigger profiles_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();
create trigger workspaces_updated_at
before update on public.workspaces
for each row execute function private.set_updated_at();
create trigger github_installations_updated_at
before update on public.github_installations
for each row execute function private.set_updated_at();
create trigger capabilities_updated_at
before update on public.capabilities
for each row execute function private.set_updated_at();
create trigger integrations_updated_at
before update on public.integrations
for each row execute function private.set_updated_at();
create trigger tenant_archetypes_updated_at
before update on public.tenant_archetypes
for each row execute function private.set_updated_at();
create trigger credential_records_updated_at
before update on public.credential_records
for each row execute function private.set_updated_at();
create trigger journeys_updated_at
before update on public.journeys
for each row execute function private.set_updated_at();
create trigger journey_steps_updated_at
before update on public.journey_steps
for each row execute function private.set_updated_at();
create trigger releases_updated_at
before update on public.releases
for each row execute function private.set_updated_at();
create trigger failure_clusters_updated_at
before update on public.failure_clusters
for each row execute function private.set_updated_at();

create trigger workspace_members_identity_immutable
before update on public.workspace_members
for each row execute function private.reject_identity_change();
create trigger workspace_invitations_identity_immutable
before update on public.workspace_invitations
for each row execute function private.reject_identity_change();
create trigger workspaces_identity_immutable
before update on public.workspaces
for each row execute function private.reject_identity_change();
create trigger capabilities_identity_immutable
before update on public.capabilities
for each row execute function private.reject_identity_change();
create trigger capability_path_rules_identity_immutable
before update on public.capability_path_rules
for each row execute function private.reject_identity_change();
create trigger integrations_identity_immutable
before update on public.integrations
for each row execute function private.reject_identity_change();
create trigger tenant_archetypes_identity_immutable
before update on public.tenant_archetypes
for each row execute function private.reject_identity_change();
create trigger journeys_identity_immutable
before update on public.journeys
for each row execute function private.reject_identity_change();
create trigger journey_steps_identity_immutable
before update on public.journey_steps
for each row execute function private.reject_identity_change();

create trigger tenant_archetypes_limit
before insert on public.tenant_archetypes
for each row execute function private.enforce_archetype_limit();
create trigger waivers_validate
before insert on public.waivers
for each row execute function private.validate_waiver();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workspaces',
    'workspace_members',
    'workspace_invitations',
    'workspace_allowed_hosts',
    'github_installations',
    'capabilities',
    'capability_path_rules',
    'integrations',
    'tenant_archetypes',
    'credential_records',
    'journeys',
    'journey_steps',
    'waivers'
  ]
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row()',
      table_name || '_audit',
      table_name
    );
  end loop;
end;
$$;

grant usage on schema private to authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.has_workspace_role(uuid, public.workspace_role[]) to authenticated;
grant execute on function private.can_admin(uuid) to authenticated;
grant execute on function private.can_edit(uuid) to authenticated;
revoke all on all functions in schema private from public, anon;

revoke all on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;
revoke all on function public.archive_archetype(uuid) from public, anon;
grant execute on function public.archive_archetype(uuid) to authenticated;

-- Supabase's public-schema defaults are intentionally broad. Start from no
-- browser privileges and grant only the operations listed below.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, update, delete on public.workspaces to authenticated;
grant select, update, delete on public.workspace_members to authenticated;
grant select, delete on public.workspace_invitations to authenticated;
grant select on public.audit_logs to authenticated;

grant select, insert, update, delete on
  public.workspace_allowed_hosts,
  public.capabilities,
  public.capability_path_rules,
  public.integrations,
  public.tenant_archetypes,
  public.archetype_capabilities,
  public.archetype_integrations,
  public.journeys,
  public.journey_capabilities,
  public.journey_steps,
  public.journey_assertions
to authenticated;

grant select on
  public.github_installations,
  public.releases,
  public.release_changed_files,
  public.release_capabilities,
  public.release_archetype_selections,
  public.runs,
  public.run_step_results,
  public.assertion_results,
  public.failure_clusters,
  public.failure_cluster_runs
to authenticated;

grant select (
  id,
  workspace_id,
  integration_id,
  archetype_id,
  name,
  encryption_version,
  health_status,
  last_checked_at,
  expires_at,
  created_by,
  created_at,
  updated_at
) on public.credential_records to authenticated;
grant select, insert on public.waivers to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.workspace_allowed_hosts enable row level security;
alter table public.audit_logs enable row level security;
alter table public.github_installations enable row level security;
alter table public.capabilities enable row level security;
alter table public.capability_path_rules enable row level security;
alter table public.integrations enable row level security;
alter table public.tenant_archetypes enable row level security;
alter table public.archetype_capabilities enable row level security;
alter table public.archetype_integrations enable row level security;
alter table public.credential_records enable row level security;
alter table public.journeys enable row level security;
alter table public.journey_capabilities enable row level security;
alter table public.journey_steps enable row level security;
alter table public.journey_assertions enable row level security;
alter table public.releases enable row level security;
alter table public.release_changed_files enable row level security;
alter table public.release_capabilities enable row level security;
alter table public.release_archetype_selections enable row level security;
alter table public.runs enable row level security;
alter table public.run_step_results enable row level security;
alter table public.assertion_results enable row level security;
alter table public.failure_clusters enable row level security;
alter table public.failure_cluster_runs enable row level security;
alter table public.waivers enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.request_idempotency enable row level security;

create policy "users read own profile"
on public.profiles for select to authenticated
using (id = auth.uid());
create policy "users insert own profile"
on public.profiles for insert to authenticated
with check (id = auth.uid());
create policy "users update own profile"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "accepted members read workspace"
on public.workspaces for select to authenticated
using (private.is_workspace_member(id));
create policy "admins update workspace"
on public.workspaces for update to authenticated
using (private.can_admin(id))
with check (private.can_admin(id));
create policy "owners delete workspace"
on public.workspaces for delete to authenticated
using (private.has_workspace_role(id, array['owner']::public.workspace_role[]));

create policy "accepted members read members"
on public.workspace_members for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "owners and admins update non-owner members"
on public.workspace_members for update to authenticated
using (
  private.can_admin(workspace_id)
  and user_id <> auth.uid()
  and role <> 'owner'
)
with check (
  private.can_admin(workspace_id)
  and role <> 'owner'
  and accepted_at is not null
);
create policy "owners and admins remove non-owner members"
on public.workspace_members for delete to authenticated
using (
  private.can_admin(workspace_id)
  and user_id <> auth.uid()
  and role <> 'owner'
);

create policy "admins read invitations"
on public.workspace_invitations for select to authenticated
using (private.can_admin(workspace_id));
create policy "admins revoke invitations"
on public.workspace_invitations for delete to authenticated
using (private.can_admin(workspace_id));

create policy "members read allowed hosts"
on public.workspace_allowed_hosts for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "admins manage allowed hosts"
on public.workspace_allowed_hosts for all to authenticated
using (private.can_admin(workspace_id))
with check (private.can_admin(workspace_id));

create policy "members read audit"
on public.audit_logs for select to authenticated
using (private.is_workspace_member(workspace_id));

create policy "members read github installations"
on public.github_installations for select to authenticated
using (private.is_workspace_member(workspace_id));

create policy "members read capabilities"
on public.capabilities for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "admins create capabilities"
on public.capabilities for insert to authenticated
with check (private.can_admin(workspace_id) and created_by = auth.uid());
create policy "admins update capabilities"
on public.capabilities for update to authenticated
using (private.can_admin(workspace_id))
with check (private.can_admin(workspace_id));
create policy "admins delete capabilities"
on public.capabilities for delete to authenticated
using (private.can_admin(workspace_id));

create policy "members read capability path rules"
on public.capability_path_rules for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "admins manage capability path rules"
on public.capability_path_rules for all to authenticated
using (private.can_admin(workspace_id))
with check (private.can_admin(workspace_id));

create policy "members read integrations"
on public.integrations for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "admins create integrations"
on public.integrations for insert to authenticated
with check (private.can_admin(workspace_id));
create policy "admins update integrations"
on public.integrations for update to authenticated
using (private.can_admin(workspace_id))
with check (private.can_admin(workspace_id));
create policy "admins delete integrations"
on public.integrations for delete to authenticated
using (private.can_admin(workspace_id));

create policy "members read archetypes"
on public.tenant_archetypes for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "admins create archetypes"
on public.tenant_archetypes for insert to authenticated
with check (private.can_admin(workspace_id) and created_by = auth.uid());
create policy "admins update archetypes"
on public.tenant_archetypes for update to authenticated
using (private.can_admin(workspace_id))
with check (private.can_admin(workspace_id));

create policy "members read archetype capabilities"
on public.archetype_capabilities for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "admins manage archetype capabilities"
on public.archetype_capabilities for all to authenticated
using (private.can_admin(workspace_id))
with check (private.can_admin(workspace_id));

create policy "members read archetype integrations"
on public.archetype_integrations for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "admins manage archetype integrations"
on public.archetype_integrations for all to authenticated
using (private.can_admin(workspace_id))
with check (private.can_admin(workspace_id));

create policy "members read credential metadata"
on public.credential_records for select to authenticated
using (private.is_workspace_member(workspace_id));

create policy "members read journeys"
on public.journeys for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "editors create journeys"
on public.journeys for insert to authenticated
with check (private.can_edit(workspace_id) and created_by = auth.uid());
create policy "editors update journeys"
on public.journeys for update to authenticated
using (private.can_edit(workspace_id))
with check (private.can_edit(workspace_id));
create policy "admins delete journeys"
on public.journeys for delete to authenticated
using (private.can_admin(workspace_id));

create policy "members read journey capabilities"
on public.journey_capabilities for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "editors manage journey capabilities"
on public.journey_capabilities for all to authenticated
using (private.can_edit(workspace_id))
with check (private.can_edit(workspace_id));

create policy "members read journey steps"
on public.journey_steps for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "editors manage journey steps"
on public.journey_steps for all to authenticated
using (private.can_edit(workspace_id))
with check (private.can_edit(workspace_id));

create policy "members read journey assertions"
on public.journey_assertions for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "editors manage journey assertions"
on public.journey_assertions for all to authenticated
using (private.can_edit(workspace_id))
with check (private.can_edit(workspace_id));

create policy "members read releases"
on public.releases for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "members read changed files"
on public.release_changed_files for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "members read release capabilities"
on public.release_capabilities for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "members read release archetypes"
on public.release_archetype_selections for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "members read runs"
on public.runs for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "members read run steps"
on public.run_step_results for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "members read assertion results"
on public.assertion_results for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "members read failure clusters"
on public.failure_clusters for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "members read failure cluster runs"
on public.failure_cluster_runs for select to authenticated
using (private.is_workspace_member(workspace_id));

create policy "members read waivers"
on public.waivers for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "admins create waivers"
on public.waivers for insert to authenticated
with check (
  private.can_admin(workspace_id)
  and approved_by = auth.uid()
);

alter publication supabase_realtime add table
  public.releases,
  public.runs,
  public.run_step_results,
  public.failure_clusters;
