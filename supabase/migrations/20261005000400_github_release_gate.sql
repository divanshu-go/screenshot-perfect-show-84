create table public.github_installation_repositories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  github_installation_id uuid not null,
  repository_id bigint not null,
  owner_login text not null,
  repository_name text not null,
  repository_full_name text not null,
  default_branch text not null default 'main',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (github_installation_id, repository_id),
  unique (workspace_id, repository_full_name),
  unique (workspace_id, id),
  foreign key (workspace_id, github_installation_id)
    references public.github_installations(workspace_id, id) on delete cascade
);
create index github_installation_repositories_workspace_idx
  on public.github_installation_repositories(workspace_id);

create table public.release_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  release_id uuid not null,
  attempt integer not null check (attempt > 0),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{7,40}$'),
  status text not null check (status in ('passed', 'failed', 'error')),
  summary text not null,
  reasons jsonb not null default '[]'::jsonb,
  run_ids uuid[] not null default '{}'::uuid[],
  uncovered_capability_ids uuid[] not null default '{}'::uuid[],
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (release_id, attempt),
  unique (workspace_id, id),
  foreign key (workspace_id, release_id)
    references public.releases(workspace_id, id) on delete cascade
);
create index release_decisions_workspace_created_idx
  on public.release_decisions(workspace_id, created_at desc);

alter table public.waivers
  add column release_decision_id uuid;

alter table public.waivers
  add constraint waivers_workspace_decision_fkey
  foreign key (workspace_id, release_decision_id)
  references public.release_decisions(workspace_id, id) on delete restrict;

create unique index waivers_release_decision_scope_idx
  on public.waivers(release_decision_id, scope);

create function private.prevent_immutable_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception '% records are immutable', tg_table_name;
end;
$$;

create trigger release_decisions_immutable
before update or delete on public.release_decisions
for each row execute function private.prevent_immutable_change();

create trigger waivers_immutable
before update or delete on public.waivers
for each row execute function private.prevent_immutable_change();

create or replace function private.validate_waiver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_decision public.release_decisions%rowtype;
begin
  if new.release_decision_id is null then
    raise exception 'Waiver must reference an immutable release decision';
  end if;

  select *
  into selected_decision
  from public.release_decisions
  where workspace_id = new.workspace_id
    and id = new.release_decision_id;

  if selected_decision.id is null
    or selected_decision.release_id <> new.release_id
    or selected_decision.status <> 'failed'
  then
    raise exception 'Only a failed decision for this release can be waived';
  end if;
  if new.expires_at is not null and new.expires_at <= now() then
    raise exception 'Waiver expiry must be in the future';
  end if;
  if new.failure_cluster_id is not null and not exists (
    select 1
    from public.failure_clusters cluster
    where cluster.id = new.failure_cluster_id
      and cluster.workspace_id = new.workspace_id
      and cluster.status in ('open', 'acknowledged')
  ) then
    raise exception 'Waiver cluster must be an active failure for this workspace';
  end if;
  return new;
end;
$$;

create trigger github_installation_repositories_updated_at
before update on public.github_installation_repositories
for each row execute function private.set_updated_at();

alter table public.github_installation_repositories enable row level security;
alter table public.release_decisions enable row level security;

create policy "members read github repositories"
on public.github_installation_repositories for select to authenticated
using (private.is_workspace_member(workspace_id));

create policy "members read release decisions"
on public.release_decisions for select to authenticated
using (private.is_workspace_member(workspace_id));

revoke all on public.github_installation_repositories from anon, authenticated;
revoke all on public.release_decisions from anon, authenticated;
grant select on public.github_installation_repositories, public.release_decisions
  to authenticated;
grant all on public.github_installation_repositories, public.release_decisions
  to service_role;

revoke insert on public.waivers from authenticated;

alter publication supabase_realtime add table public.release_decisions;
