begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into public.github_installations (
  id,
  workspace_id,
  installation_id,
  github_account_login
)
values (
  'a7000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  700001,
  'ashbyhq'
);

insert into public.github_installation_repositories (
  id,
  workspace_id,
  github_installation_id,
  repository_id,
  owner_login,
  repository_name,
  repository_full_name
)
values (
  'a7100000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'a7000000-0000-0000-0000-000000000001',
  710001,
  'ashbyhq',
  'app',
  'ashbyhq/app'
);

insert into public.releases (
  id,
  workspace_id,
  github_installation_id,
  repository_full_name,
  pull_request_number,
  commit_sha,
  status
)
values (
  'a8000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'a7000000-0000-0000-0000-000000000001',
  'ashbyhq/app',
  42,
  'abcdef1234567890',
  'failed'
);

insert into public.release_decisions (
  id,
  workspace_id,
  release_id,
  attempt,
  commit_sha,
  status,
  summary
)
values (
  'a8100000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'a8000000-0000-0000-0000-000000000001',
  1,
  'abcdef1234567890',
  'failed',
  'A required tenant journey failed.'
);

select throws_ok(
  $$
    insert into public.waivers (
      workspace_id, release_id, scope, reason, approved_by
    )
    values (
      'a0000000-0000-0000-0000-000000000001',
      'a8000000-0000-0000-0000-000000000001',
      'release',
      'Approved after reviewing the failure evidence.',
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  'P0001',
  'Waiver must reference an immutable release decision',
  'waivers must bind to an immutable decision snapshot'
);

insert into public.waivers (
  id,
  workspace_id,
  release_id,
  release_decision_id,
  scope,
  reason,
  approved_by
)
values (
  'a8200000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'a8000000-0000-0000-0000-000000000001',
  'a8100000-0000-0000-0000-000000000001',
  'release',
  'Approved after reviewing the failure evidence.',
  '10000000-0000-0000-0000-000000000001'
);

select is(
  (
    select release_decision_id
    from public.waivers
    where id = 'a8200000-0000-0000-0000-000000000001'
  ),
  'a8100000-0000-0000-0000-000000000001'::uuid,
  'valid waiver stores the decision snapshot'
);

select throws_ok(
  $$
    update public.waivers
    set reason = 'A corrected reason that must not replace history.'
    where id = 'a8200000-0000-0000-0000-000000000001'
  $$,
  'P0001',
  'waivers records are immutable',
  'waivers cannot be changed'
);

select throws_ok(
  $$
    update public.release_decisions
    set summary = 'changed'
    where id = 'a8100000-0000-0000-0000-000000000001'
  $$,
  'P0001',
  'release_decisions records are immutable',
  'release decisions cannot be changed'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000003',
  true
);

select is(
  (
    select count(*)
    from public.github_installation_repositories
    where workspace_id = 'a0000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'workspace members can read bound repositories'
);

select is(
  (
    select count(*)
    from public.release_decisions
    where workspace_id = 'a0000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'workspace members can read release decisions'
);

select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000001',
  true
);

select is(
  (
    select count(*)
    from public.release_decisions
    where workspace_id = 'a0000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'another workspace cannot read release decisions'
);

select is(
  has_table_privilege('authenticated', 'public.waivers', 'insert'),
  false,
  'browser roles cannot bypass the waiver Edge Function'
);

select * from finish();
rollback;
