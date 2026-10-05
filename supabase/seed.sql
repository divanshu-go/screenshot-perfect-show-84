-- Local development data only. Hosted deployments do not run this file.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'platform@ashbyhq.com',
    extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Maya Chen"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'release-admin@ashbyhq.com',
    extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Jordan Lee"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'backend@ashbyhq.com',
    extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Priya Shah"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000004',
    'authenticated',
    'authenticated',
    'support@ashbyhq.com',
    extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Theo Brooks"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'platform@front.com',
    extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Sam Rivera"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '30000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'platform@customer.io',
    extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Avery Morgan"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
on conflict (id) do nothing;

insert into public.workspaces (id, name, slug, created_by)
values
  (
    'a0000000-0000-0000-0000-000000000001',
    'Ashby',
    'ashby',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    'b0000000-0000-0000-0000-000000000001',
    'Front',
    'front',
    '20000000-0000-0000-0000-000000000001'
  ),
  (
    'c0000000-0000-0000-0000-000000000001',
    'Customer.io',
    'customer-io',
    '30000000-0000-0000-0000-000000000001'
  )
on conflict (id) do nothing;

insert into public.workspace_members (
  workspace_id,
  user_id,
  role,
  accepted_at
)
values
  (
    'a0000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'owner',
    now()
  ),
  (
    'a0000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    'admin',
    now()
  ),
  (
    'a0000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000003',
    'engineer',
    now()
  ),
  (
    'a0000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000004',
    'viewer',
    now()
  ),
  (
    'b0000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'owner',
    now()
  ),
  (
    'c0000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'owner',
    now()
  )
on conflict (workspace_id, user_id) do nothing;

insert into public.workspace_allowed_hosts (workspace_id, hostname)
values
  ('a0000000-0000-0000-0000-000000000001', 'api.ashbyhq.com'),
  ('b0000000-0000-0000-0000-000000000001', 'api.frontapp.com'),
  ('c0000000-0000-0000-0000-000000000001', 'api.customer.io')
on conflict (workspace_id, hostname) do nothing;

insert into public.integrations (
  id,
  workspace_id,
  name,
  provider_key,
  environment,
  base_url
)
values
  (
    'a3000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'Ashby API',
    'ashby',
    'sandbox',
    'https://api.ashbyhq.com'
  ),
  (
    'b3000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'Front API',
    'front',
    'sandbox',
    'https://api.frontapp.com'
  ),
  (
    'c3000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'Customer.io API',
    'customer_io',
    'sandbox',
    'https://api.customer.io'
  )
on conflict (id) do nothing;

insert into public.capabilities (
  id,
  workspace_id,
  name,
  description,
  criticality,
  created_by
)
values
  (
    'a1000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'Candidate scheduling',
    'Interview scheduling and calendar coordination',
    'critical',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    'b1000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'Shared inbox routing',
    'Routes inbound conversations to the correct team',
    'critical',
    '20000000-0000-0000-0000-000000000001'
  ),
  (
    'c1000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'Campaign delivery',
    'Queues and delivers lifecycle messages',
    'critical',
    '30000000-0000-0000-0000-000000000001'
  )
on conflict (id) do nothing;

insert into public.tenant_archetypes (
  id,
  workspace_id,
  name,
  description,
  region,
  auth_mode,
  permission_profile,
  risk_weight,
  created_by
)
values
  (
    'a2000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'US enterprise recruiter',
    'Large hiring team with SSO and restricted scheduling permissions',
    'us',
    'sso',
    'recruiter',
    90,
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    'b2000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'European support team',
    'Regional inbox with custom routing rules',
    'eu',
    'sso',
    'teammate',
    75,
    '20000000-0000-0000-0000-000000000001'
  ),
  (
    'c2000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'High-volume workspace',
    'Lifecycle messaging tenant with strict delivery controls',
    'us',
    'api_key',
    'campaign_manager',
    85,
    '30000000-0000-0000-0000-000000000001'
  )
on conflict (id) do nothing;
