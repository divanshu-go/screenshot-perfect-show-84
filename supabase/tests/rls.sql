begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);

select is(
  (select count(*) from public.workspaces),
  1::bigint,
  'an Ashby owner sees only the accepted workspace'
);

select is(
  (select name from public.workspaces),
  'Ashby',
  'workspace rows cannot leak across tenants'
);

select is(
  (select count(*) from public.workspace_members),
  4::bigint,
  'members cannot read another workspace roster'
);

select lives_ok(
  $$
    insert into public.capabilities (
      workspace_id,
      name,
      criticality,
      created_by
    )
    values (
      'a0000000-0000-0000-0000-000000000001',
      'Offer approvals',
      'high',
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  'an owner can create a capability in their workspace'
);

select throws_ok(
  $$
    update public.workspace_members
    set workspace_id = 'b0000000-0000-0000-0000-000000000001'
    where user_id = '10000000-0000-0000-0000-000000000002'
  $$,
  'Workspace identity cannot be changed',
  'membership cannot be moved into another workspace'
);

select results_eq(
  $$
    update public.workspace_members
    set role = 'admin'
    where user_id = '10000000-0000-0000-0000-000000000001'
    returning id
  $$,
  $$ select null::uuid where false $$,
  'an owner cannot demote or rewrite their own owner membership'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000003',
  true
);

select lives_ok(
  $$
    insert into public.journeys (
      workspace_id,
      name,
      created_by
    )
    values (
      'a0000000-0000-0000-0000-000000000001',
      'Create candidate',
      '10000000-0000-0000-0000-000000000003'
    )
  $$,
  'an engineer can create a journey'
);

select throws_ok(
  $$
    insert into public.capabilities (
      workspace_id,
      name,
      created_by
    )
    values (
      'a0000000-0000-0000-0000-000000000001',
      'Unauthorized capability',
      '10000000-0000-0000-0000-000000000003'
    )
  $$,
  'new row violates row-level security policy for table "capabilities"',
  'an engineer cannot create configuration reserved for admins'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000004',
  true
);

select is(
  (select count(*) from public.journeys),
  1::bigint,
  'a viewer can read workspace journeys'
);

select throws_ok(
  $$
    insert into public.journeys (
      workspace_id,
      name,
      created_by
    )
    values (
      'a0000000-0000-0000-0000-000000000001',
      'Viewer write attempt',
      '10000000-0000-0000-0000-000000000004'
    )
  $$,
  'new row violates row-level security policy for table "journeys"',
  'a viewer cannot create journeys'
);

select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000001',
  true
);

select is(
  (select count(*) from public.workspaces),
  1::bigint,
  'a user in the second workspace sees one workspace'
);

select is(
  (select name from public.workspaces),
  'Front',
  'the second workspace user cannot see Ashby'
);

select is(
  (select count(*) from public.capabilities),
  1::bigint,
  'the second workspace user cannot see Ashby capabilities'
);

select throws_ok(
  $$
    insert into public.archetype_capabilities (
      workspace_id,
      archetype_id,
      capability_id
    )
    values (
      'b0000000-0000-0000-0000-000000000001',
      'b2000000-0000-0000-0000-000000000001',
      'a1000000-0000-0000-0000-000000000001'
    )
  $$,
  'insert or update on table "archetype_capabilities" violates foreign key constraint "archetype_capabilities_workspace_id_capability_id_fkey"',
  'composite keys reject cross-workspace relationships'
);

reset role;

insert into public.workspace_members (
  workspace_id,
  user_id,
  role,
  accepted_at
)
values (
  'a0000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'viewer',
  null
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000001',
  true
);

select is(
  (select count(*) from public.workspaces),
  1::bigint,
  'a pending invitation does not grant workspace access'
);

select is(
  (select name from public.workspaces),
  'Customer.io',
  'pending members retain access only to accepted workspaces'
);

select is(
  (
    select count(*)
    from public.audit_logs
    where workspace_id = 'a0000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'audit logs from an unaccepted workspace are not visible'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'public.credential_records',
    'encrypted_payload',
    'SELECT'
  ),
  'authenticated clients cannot read encrypted credential payloads'
);

select * from finish();
rollback;
