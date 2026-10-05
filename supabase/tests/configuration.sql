begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000002',
  true
);

select is(
  (select count(*) from public.list_workspace_members('a0000000-0000-0000-0000-000000000001')),
  4::bigint,
  'accepted members can read their workspace member directory'
);

select lives_ok(
  $$
    select public.save_capability(
      'a0000000-0000-0000-0000-000000000001',
      null,
      'Offer approvals',
      'Approval routing and permissions',
      'high',
      true,
      array['src/offers/**', 'packages/approvals/**']
    )
  $$,
  'admins can save a capability and path rules transactionally'
);

select is(
  (
    select count(*)
    from public.capability_path_rules path_rule
    join public.capabilities capability on capability.id = path_rule.capability_id
    where capability.workspace_id = 'a0000000-0000-0000-0000-000000000001'
      and capability.name = 'Offer approvals'
  ),
  2::bigint,
  'all capability path rules are persisted'
);

select lives_ok(
  $$
    select public.save_integration(
      'a0000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000001',
      'Ashby API',
      'ashby',
      'sandbox',
      'https://api.ashbyhq.com',
      true
    )
  $$,
  'admins can save a provider whose hostname is allowed'
);

select throws_ok(
  $$
    select public.save_integration(
      'a0000000-0000-0000-0000-000000000001',
      null,
      'Untrusted API',
      'untrusted',
      'sandbox',
      'https://untrusted.example',
      true
    )
  $$,
  'Add this hostname to the outbound allowlist first',
  'providers cannot bypass the outbound host allowlist'
);

create temporary table invite_result as
select *
from public.create_workspace_invitation(
  'a0000000-0000-0000-0000-000000000001',
  'platform@customer.io',
  'viewer'
);

select isnt(
  (select invitation_token from invite_result),
  (
    select token_hash
    from public.workspace_invitations
    where id = (select invitation_id from invite_result)
  ),
  'only the invitation hash is stored'
);

select is(
  length((select invitation_token from invite_result)),
  64,
  'invitation tokens contain sufficient entropy'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000003',
  true
);

select throws_ok(
  $$
    select public.create_workspace_invitation(
      'a0000000-0000-0000-0000-000000000001',
      'someone@example.com',
      'viewer'
    )
  $$,
  'Not authorized',
  'engineers cannot create invitations'
);

select throws_ok(
  $$
    select public.accept_workspace_invitation(
      (select invitation_token from invite_result)
    )
  $$,
  'Sign in with the email address that was invited',
  'an invitation cannot be accepted by another account'
);

select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000001',
  true
);

select is(
  public.accept_workspace_invitation((select invitation_token from invite_result)),
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'the invited account can accept an unexpired invitation'
);

select is(
  (select count(*) from public.workspaces),
  2::bigint,
  'accepted invitations grant access without leaking other workspaces'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000004',
  true
);

select results_eq(
  $$
    update public.workspaces
    set name = 'Viewer edit'
    where id = 'a0000000-0000-0000-0000-000000000001'
    returning id
  $$,
  $$ select null::uuid where false $$,
  'viewers cannot update workspace settings'
);

select * from finish();
rollback;
