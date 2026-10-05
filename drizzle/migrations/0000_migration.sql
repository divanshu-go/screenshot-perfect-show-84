
-- ============ ENUMS ============
create type public.workspace_role as enum ('owner','admin','engineer','viewer');
create type public.criticality as enum ('low','medium','high','critical');
create type public.release_status as enum ('discovered','planning','running','passed','failed','waived','error');
create type public.run_status as enum ('queued','running','passed','failed','error','cancelled');
create type public.run_trigger as enum ('manual','pull_request','rerun');
create type public.cluster_status as enum ('open','acknowledged','resolved','ignored');
create type public.http_method as enum ('GET','POST','PUT','PATCH','DELETE','HEAD');
create type public.assertion_type as enum ('http_status','json_path_equals','json_path_exists','json_path_type','header_exists','max_latency_ms');

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select to authenticated using (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid());
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ============ WORKSPACES ============
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  plan text not null default 'design_partner',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  role public.workspace_role not null,
  invited_by uuid,
  accepted_at timestamptz default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index on public.workspace_members(user_id);

create or replace function public.is_workspace_member(_ws uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members where workspace_id = _ws and user_id = auth.uid())
$$;
create or replace function public.has_workspace_role(_ws uuid, _roles public.workspace_role[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members where workspace_id = _ws and user_id = auth.uid() and role = any(_roles))
$$;
create or replace function public.is_workspace_owner(_ws uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.has_workspace_role(_ws, array['owner']::public.workspace_role[])
$$;
create or replace function public.can_edit(_ws uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.has_workspace_role(_ws, array['owner','admin','engineer']::public.workspace_role[])
$$;
create or replace function public.can_admin(_ws uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.has_workspace_role(_ws, array['owner','admin']::public.workspace_role[])
$$;

grant select, update, delete on public.workspaces to authenticated;
grant all on public.workspaces to service_role;
alter table public.workspaces enable row level security;
create policy "members read workspace" on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy "admins update workspace" on public.workspaces for update to authenticated using (public.can_admin(id));
create policy "owners delete workspace" on public.workspaces for delete to authenticated using (public.is_workspace_owner(id));
create trigger workspaces_updated before update on public.workspaces for each row execute function public.set_updated_at();

grant select, update, delete on public.workspace_members to authenticated;
grant all on public.workspace_members to service_role;
alter table public.workspace_members enable row level security;
create policy "members read members" on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "owners update members" on public.workspace_members for update to authenticated using (public.is_workspace_owner(workspace_id) and user_id <> auth.uid()) with check (role <> 'owner');
create policy "owners remove members" on public.workspace_members for delete to authenticated using (public.is_workspace_owner(workspace_id) and user_id <> auth.uid());

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role public.workspace_role not null check (role <> 'owner'),
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  invited_by uuid not null,
  created_at timestamptz not null default now()
);
create index on public.workspace_invitations(workspace_id);
grant select, delete on public.workspace_invitations to authenticated;
grant all on public.workspace_invitations to service_role;
alter table public.workspace_invitations enable row level security;
create policy "owners read invites" on public.workspace_invitations for select to authenticated using (public.is_workspace_owner(workspace_id));
create policy "owners revoke invites" on public.workspace_invitations for delete to authenticated using (public.is_workspace_owner(workspace_id));

-- ============ AUDIT ============
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_logs(workspace_id, created_at desc);
grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;
create policy "members read audit" on public.audit_logs for select to authenticated using (public.is_workspace_member(workspace_id));

create or replace function public.audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb; ws uuid; label text;
begin
  r := to_jsonb(coalesce(new, old));
  ws := (r->>'workspace_id')::uuid;
  if ws is null then return coalesce(new, old); end if;
  label := coalesce(r->>'name', r->>'title', r->>'reason');
  insert into public.audit_logs (workspace_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (ws, auth.uid(), lower(tg_op), tg_table_name, (r->>'id')::uuid, jsonb_build_object('label', label));
  return coalesce(new, old);
end $$;

-- create workspace RPC
create or replace function public.create_workspace(_name text, _slug text) returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.workspaces (name, slug, created_by) values (_name, _slug, auth.uid()) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role, accepted_at) values (ws, auth.uid(), 'owner', now());
  insert into public.audit_logs (workspace_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (ws, auth.uid(), 'insert', 'workspaces', ws, jsonb_build_object('label', _name));
  return ws;
end $$;
revoke all on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;

-- ============ GITHUB ============
create table public.github_installations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  installation_id bigint not null,
  github_account_id bigint,
  github_account_login text,
  repository_id bigint,
  repository_owner text,
  repository_name text,
  repository_full_name text,
  default_branch text default 'main',
  status text not null default 'active',
  installed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.github_installations(workspace_id);
grant select on public.github_installations to authenticated;
grant all on public.github_installations to service_role;
alter table public.github_installations enable row level security;
create policy "members read gh" on public.github_installations for select to authenticated using (public.is_workspace_member(workspace_id));

-- ============ CAPABILITIES / INTEGRATIONS / ARCHETYPES ============
create table public.capabilities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  description text,
  criticality public.criticality not null default 'medium',
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create table public.capability_path_rules (
  id uuid primary key default gen_random_uuid(),
  capability_id uuid not null references public.capabilities(id) on delete cascade,
  glob_pattern text not null check (char_length(glob_pattern) between 1 and 300),
  created_at timestamptz not null default now(),
  unique (capability_id, glob_pattern)
);
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  provider_key text not null check (provider_key ~ '^[a-z0-9_-]{2,40}$'),
  environment text not null default 'sandbox',
  base_url text not null check (base_url ~ '^https://'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.tenant_archetypes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  description text,
  region text not null default 'us',
  auth_mode text not null default 'password',
  permission_profile text not null default 'standard',
  active boolean not null default true,
  risk_weight integer not null default 50 check (risk_weight between 1 and 100),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create table public.archetype_capabilities (
  archetype_id uuid not null references public.tenant_archetypes(id) on delete cascade,
  capability_id uuid not null references public.capabilities(id) on delete cascade,
  primary key (archetype_id, capability_id)
);
create table public.archetype_integrations (
  archetype_id uuid not null references public.tenant_archetypes(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  primary key (archetype_id, integration_id)
);
create index on public.capabilities(workspace_id);
create index on public.capability_path_rules(capability_id);
create index on public.integrations(workspace_id);
create index on public.tenant_archetypes(workspace_id);
create index on public.archetype_capabilities(capability_id);
create index on public.archetype_integrations(integration_id);

-- 20 archetype limit
create or replace function public.enforce_archetype_limit() returns trigger language plpgsql set search_path = public as $$
begin
  if (select count(*) from public.tenant_archetypes where workspace_id = new.workspace_id) >= 20 then
    raise exception 'A workspace can have at most 20 tenant archetypes';
  end if;
  return new;
end $$;
create trigger archetype_limit before insert on public.tenant_archetypes for each row execute function public.enforce_archetype_limit();

-- ============ CREDENTIALS (metadata only to browser) ============
create table public.credential_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  archetype_id uuid references public.tenant_archetypes(id) on delete set null,
  name text not null,
  encrypted_payload text not null,
  encryption_version integer not null default 1,
  health_status text not null default 'unknown',
  last_checked_at timestamptz,
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.credential_records(workspace_id);
grant select (id, workspace_id, integration_id, archetype_id, name, encryption_version, health_status, last_checked_at, expires_at, created_by, created_at, updated_at) on public.credential_records to authenticated;
grant all on public.credential_records to service_role;
alter table public.credential_records enable row level security;
create policy "members read credential metadata" on public.credential_records for select to authenticated using (public.is_workspace_member(workspace_id));

-- ============ JOURNEYS ============
create table public.journeys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  description text,
  integration_id uuid references public.integrations(id) on delete set null,
  active boolean not null default true,
  timeout_ms integer not null default 10000 check (timeout_ms between 500 and 60000),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.journey_capabilities (
  journey_id uuid not null references public.journeys(id) on delete cascade,
  capability_id uuid not null references public.capabilities(id) on delete cascade,
  primary key (journey_id, capability_id)
);
create table public.journey_steps (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys(id) on delete cascade,
  position integer not null check (position >= 0),
  name text not null,
  method public.http_method not null default 'GET',
  path_template text not null check (path_template ~ '^/' and char_length(path_template) <= 500),
  request_headers jsonb not null default '{}'::jsonb,
  request_body jsonb,
  extraction_rules jsonb not null default '{}'::jsonb,
  continue_on_failure boolean not null default false,
  is_cleanup boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (journey_id, is_cleanup, position)
);
create table public.journey_assertions (
  id uuid primary key default gen_random_uuid(),
  journey_step_id uuid not null references public.journey_steps(id) on delete cascade,
  assertion_type public.assertion_type not null,
  target text,
  operator text not null default 'eq',
  expected_value jsonb,
  created_at timestamptz not null default now()
);
create index on public.journeys(workspace_id);
create index on public.journey_capabilities(capability_id);
create index on public.journey_steps(journey_id);
create index on public.journey_assertions(journey_step_id);

-- ============ RELEASES / RUNS ============
create table public.releases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  github_installation_id uuid references public.github_installations(id) on delete set null,
  repository_full_name text not null,
  pull_request_number integer,
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{7,40}$'),
  ref text,
  title text,
  author_login text,
  status public.release_status not null default 'discovered',
  discovered_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, repository_full_name, commit_sha)
);
create table public.release_changed_files (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.releases(id) on delete cascade,
  path text not null, additions integer not null default 0, deletions integer not null default 0, status text
);
create table public.release_capabilities (
  release_id uuid not null references public.releases(id) on delete cascade,
  capability_id uuid not null references public.capabilities(id) on delete cascade,
  reason text, primary key (release_id, capability_id)
);
create table public.release_archetype_selections (
  release_id uuid not null references public.releases(id) on delete cascade,
  archetype_id uuid not null references public.tenant_archetypes(id) on delete cascade,
  selection_reason text, coverage_score numeric, primary key (release_id, archetype_id)
);
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  release_id uuid references public.releases(id) on delete cascade,
  journey_id uuid not null references public.journeys(id) on delete cascade,
  archetype_id uuid not null references public.tenant_archetypes(id) on delete cascade,
  triggered_by uuid,
  trigger_type public.run_trigger not null default 'manual',
  status public.run_status not null default 'queued',
  started_at timestamptz, completed_at timestamptz, duration_ms integer,
  created_at timestamptz not null default now()
);
create table public.run_step_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  journey_step_id uuid references public.journey_steps(id) on delete set null,
  position integer not null, status text not null,
  started_at timestamptz, completed_at timestamptz, duration_ms integer,
  request_summary jsonb, response_summary jsonb,
  error_code text, error_message text, fingerprint text,
  created_at timestamptz not null default now()
);
create table public.assertion_results (
  id uuid primary key default gen_random_uuid(),
  run_step_result_id uuid not null references public.run_step_results(id) on delete cascade,
  journey_assertion_id uuid references public.journey_assertions(id) on delete set null,
  passed boolean not null, actual_value jsonb, message text,
  created_at timestamptz not null default now()
);
create table public.failure_clusters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  release_id uuid references public.releases(id) on delete set null,
  fingerprint text not null, title text not null, summary text, suspected_cause text,
  status public.cluster_status not null default 'open',
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.failure_cluster_runs (
  failure_cluster_id uuid not null references public.failure_clusters(id) on delete cascade,
  run_id uuid not null references public.runs(id) on delete cascade,
  primary key (failure_cluster_id, run_id)
);
create table public.waivers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  release_id uuid not null references public.releases(id) on delete cascade,
  failure_cluster_id uuid references public.failure_clusters(id) on delete set null,
  scope text not null check (char_length(scope) between 2 and 200),
  reason text not null check (char_length(reason) between 10 and 2000),
  expires_at timestamptz,
  approved_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.releases(workspace_id, created_at desc);
create index on public.release_changed_files(release_id);
create index on public.release_capabilities(capability_id);
create index on public.release_archetype_selections(archetype_id);
create index on public.runs(workspace_id, created_at desc);
create index on public.runs(release_id);
create index on public.runs(journey_id);
create index on public.runs(archetype_id);
create index on public.run_step_results(run_id);
create index on public.assertion_results(run_step_result_id);
create index on public.failure_clusters(workspace_id);
create index on public.failure_cluster_runs(run_id);
create index on public.waivers(release_id);

-- ============ GRANTS + RLS for product tables ============
do $$
declare t text;
begin
  foreach t in array array['capabilities','integrations','tenant_archetypes','journeys'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t||'_updated', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t||'_audit', t);
  end loop;
end $$;
-- capabilities / integrations / archetypes: admin manages
create policy "admins insert" on public.capabilities for insert to authenticated with check (public.can_admin(workspace_id));
create policy "admins update" on public.capabilities for update to authenticated using (public.can_admin(workspace_id));
create policy "admins delete" on public.capabilities for delete to authenticated using (public.can_admin(workspace_id));
create policy "admins insert" on public.integrations for insert to authenticated with check (public.can_admin(workspace_id));
create policy "admins update" on public.integrations for update to authenticated using (public.can_admin(workspace_id));
create policy "admins delete" on public.integrations for delete to authenticated using (public.can_admin(workspace_id));
create policy "admins insert" on public.tenant_archetypes for insert to authenticated with check (public.can_admin(workspace_id));
create policy "admins update" on public.tenant_archetypes for update to authenticated using (public.can_admin(workspace_id));
create policy "admins delete" on public.tenant_archetypes for delete to authenticated using (public.can_admin(workspace_id));
-- journeys: engineers+
create policy "editors insert" on public.journeys for insert to authenticated with check (public.can_edit(workspace_id));
create policy "editors update" on public.journeys for update to authenticated using (public.can_edit(workspace_id));
create policy "admins delete" on public.journeys for delete to authenticated using (public.can_admin(workspace_id));

-- child tables via parent workspace
grant select, insert, update, delete on public.capability_path_rules, public.archetype_capabilities, public.archetype_integrations, public.journey_capabilities, public.journey_steps, public.journey_assertions to authenticated;
grant all on public.capability_path_rules, public.archetype_capabilities, public.archetype_integrations, public.journey_capabilities, public.journey_steps, public.journey_assertions to service_role;
alter table public.capability_path_rules enable row level security;
alter table public.archetype_capabilities enable row level security;
alter table public.archetype_integrations enable row level security;
alter table public.journey_capabilities enable row level security;
alter table public.journey_steps enable row level security;
alter table public.journey_assertions enable row level security;

create or replace function public.capability_ws(_id uuid) returns uuid language sql stable security definer set search_path = public as $$ select workspace_id from public.capabilities where id = _id $$;
create or replace function public.archetype_ws(_id uuid) returns uuid language sql stable security definer set search_path = public as $$ select workspace_id from public.tenant_archetypes where id = _id $$;
create or replace function public.journey_ws(_id uuid) returns uuid language sql stable security definer set search_path = public as $$ select workspace_id from public.journeys where id = _id $$;
create or replace function public.step_ws(_id uuid) returns uuid language sql stable security definer set search_path = public as $$ select j.workspace_id from public.journey_steps s join public.journeys j on j.id = s.journey_id where s.id = _id $$;

create policy "read" on public.capability_path_rules for select to authenticated using (public.is_workspace_member(public.capability_ws(capability_id)));
create policy "write" on public.capability_path_rules for all to authenticated using (public.can_admin(public.capability_ws(capability_id))) with check (public.can_admin(public.capability_ws(capability_id)));
create policy "read" on public.archetype_capabilities for select to authenticated using (public.is_workspace_member(public.archetype_ws(archetype_id)));
create policy "write" on public.archetype_capabilities for all to authenticated using (public.can_admin(public.archetype_ws(archetype_id))) with check (public.can_admin(public.archetype_ws(archetype_id)) and public.capability_ws(capability_id) = public.archetype_ws(archetype_id));
create policy "read" on public.archetype_integrations for select to authenticated using (public.is_workspace_member(public.archetype_ws(archetype_id)));
create policy "write" on public.archetype_integrations for all to authenticated using (public.can_admin(public.archetype_ws(archetype_id))) with check (public.can_admin(public.archetype_ws(archetype_id)));
create policy "read" on public.journey_capabilities for select to authenticated using (public.is_workspace_member(public.journey_ws(journey_id)));
create policy "write" on public.journey_capabilities for all to authenticated using (public.can_edit(public.journey_ws(journey_id))) with check (public.can_edit(public.journey_ws(journey_id)) and public.capability_ws(capability_id) = public.journey_ws(journey_id));
create policy "read" on public.journey_steps for select to authenticated using (public.is_workspace_member(public.journey_ws(journey_id)));
create policy "write" on public.journey_steps for all to authenticated using (public.can_edit(public.journey_ws(journey_id))) with check (public.can_edit(public.journey_ws(journey_id)));
create policy "read" on public.journey_assertions for select to authenticated using (public.is_workspace_member(public.step_ws(journey_step_id)));
create policy "write" on public.journey_assertions for all to authenticated using (public.can_edit(public.step_ws(journey_step_id))) with check (public.can_edit(public.step_ws(journey_step_id)));

-- read-only-to-browser tables (writes only by trusted server code)
grant select on public.releases, public.release_changed_files, public.release_capabilities, public.release_archetype_selections, public.runs, public.run_step_results, public.assertion_results, public.failure_clusters, public.failure_cluster_runs to authenticated;
grant all on public.releases, public.release_changed_files, public.release_capabilities, public.release_archetype_selections, public.runs, public.run_step_results, public.assertion_results, public.failure_clusters, public.failure_cluster_runs, public.waivers to service_role;
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

create or replace function public.release_ws(_id uuid) returns uuid language sql stable security definer set search_path = public as $$ select workspace_id from public.releases where id = _id $$;
create or replace function public.run_ws(_id uuid) returns uuid language sql stable security definer set search_path = public as $$ select workspace_id from public.runs where id = _id $$;

create policy "read" on public.releases for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "read" on public.release_changed_files for select to authenticated using (public.is_workspace_member(public.release_ws(release_id)));
create policy "read" on public.release_capabilities for select to authenticated using (public.is_workspace_member(public.release_ws(release_id)));
create policy "read" on public.release_archetype_selections for select to authenticated using (public.is_workspace_member(public.release_ws(release_id)));
create policy "read" on public.runs for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "read" on public.run_step_results for select to authenticated using (public.is_workspace_member(public.run_ws(run_id)));
create policy "read" on public.assertion_results for select to authenticated using (exists (select 1 from public.run_step_results r where r.id = run_step_result_id and public.is_workspace_member(public.run_ws(r.run_id))));
create policy "read" on public.failure_clusters for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "read" on public.failure_cluster_runs for select to authenticated using (exists (select 1 from public.failure_clusters c where c.id = failure_cluster_id and public.is_workspace_member(c.workspace_id)));

-- waivers: immutable, admins create
grant select, insert on public.waivers to authenticated;
create policy "read" on public.waivers for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "admins insert" on public.waivers for insert to authenticated with check (public.can_admin(workspace_id) and approved_by = auth.uid() and public.release_ws(release_id) = workspace_id);
create trigger waivers_audit after insert on public.waivers for each row execute function public.audit_row();
