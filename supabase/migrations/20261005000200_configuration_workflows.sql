create function public.create_workspace_invitation(
  _workspace_id uuid,
  _email text,
  _role public.workspace_role
)
returns table (
  invitation_id uuid,
  invitation_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(_email));
  raw_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not private.can_admin(_workspace_id) then
    raise exception 'Not authorized';
  end if;
  if _role = 'owner' then
    raise exception 'Owner invitations are not allowed';
  end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'A valid email address is required';
  end if;
  if exists (
    select 1
    from public.workspace_members member
    join auth.users account on account.id = member.user_id
    where member.workspace_id = _workspace_id
      and lower(account.email) = normalized_email
      and member.accepted_at is not null
  ) then
    raise exception 'This person is already a workspace member';
  end if;

  delete from public.workspace_invitations
  where workspace_id = _workspace_id
    and email = normalized_email
    and accepted_at is null;

  return query
  insert into public.workspace_invitations (
    workspace_id,
    email,
    role,
    token_hash,
    invited_by
  )
  values (
    _workspace_id,
    normalized_email,
    _role,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    auth.uid()
  )
  returning id, raw_token, workspace_invitations.expires_at;
end;
$$;

create function public.accept_workspace_invitation(_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.workspace_invitations%rowtype;
  account_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select lower(email) into account_email
  from auth.users
  where id = auth.uid();

  select *
  into invitation
  from public.workspace_invitations
  where token_hash = encode(extensions.digest(_token, 'sha256'), 'hex')
  for update;

  if invitation.id is null then
    raise exception 'Invitation is invalid';
  end if;
  if invitation.accepted_at is not null then
    raise exception 'Invitation has already been accepted';
  end if;
  if invitation.expires_at <= now() then
    raise exception 'Invitation has expired';
  end if;
  if invitation.email <> account_email then
    raise exception 'Sign in with the email address that was invited';
  end if;

  insert into public.workspace_members (
    workspace_id,
    user_id,
    role,
    invited_by,
    accepted_at
  )
  values (
    invitation.workspace_id,
    auth.uid(),
    invitation.role,
    invitation.invited_by,
    now()
  )
  on conflict (workspace_id, user_id)
  do update set
    role = excluded.role,
    invited_by = excluded.invited_by,
    accepted_at = excluded.accepted_at;

  update public.workspace_invitations
  set accepted_at = now()
  where id = invitation.id;

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    invitation.workspace_id,
    auth.uid(),
    'accept',
    'workspace_invitations',
    invitation.id,
    jsonb_build_object('role', invitation.role)
  );

  return invitation.workspace_id;
end;
$$;

create function public.list_workspace_members(_workspace_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  email text,
  display_name text,
  role public.workspace_role,
  accepted_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_workspace_member(_workspace_id) then
    raise exception 'Not authorized';
  end if;
  return query
  select
    member.id,
    member.user_id,
    account.email::text,
    profile.display_name,
    member.role,
    member.accepted_at,
    member.created_at
  from public.workspace_members member
  join auth.users account on account.id = member.user_id
  left join public.profiles profile on profile.id = member.user_id
  where member.workspace_id = _workspace_id
    and member.accepted_at is not null
  order by
    case member.role
      when 'owner' then 1
      when 'admin' then 2
      when 'engineer' then 3
      else 4
    end,
    lower(account.email);
end;
$$;

create function public.save_capability(
  _workspace_id uuid,
  _capability_id uuid,
  _name text,
  _description text,
  _criticality public.criticality,
  _active boolean,
  _path_rules text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  path_rule text;
begin
  if not private.can_admin(_workspace_id) then
    raise exception 'Not authorized';
  end if;
  if char_length(trim(_name)) not between 2 and 120 then
    raise exception 'Capability name must be between 2 and 120 characters';
  end if;
  if coalesce(array_length(_path_rules, 1), 0) > 100 then
    raise exception 'A capability can have at most 100 path rules';
  end if;

  if _capability_id is null then
    insert into public.capabilities (
      workspace_id,
      name,
      description,
      criticality,
      active,
      created_by
    )
    values (
      _workspace_id,
      trim(_name),
      nullif(trim(_description), ''),
      _criticality,
      _active,
      auth.uid()
    )
    returning id into saved_id;
  else
    update public.capabilities
    set
      name = trim(_name),
      description = nullif(trim(_description), ''),
      criticality = _criticality,
      active = _active
    where id = _capability_id and workspace_id = _workspace_id
    returning id into saved_id;
    if saved_id is null then
      raise exception 'Capability not found';
    end if;
  end if;

  delete from public.capability_path_rules
  where workspace_id = _workspace_id and capability_id = saved_id;

  foreach path_rule in array coalesce(_path_rules, array[]::text[])
  loop
    if char_length(trim(path_rule)) not between 1 and 300 then
      raise exception 'Path rules must be between 1 and 300 characters';
    end if;
    insert into public.capability_path_rules (
      workspace_id,
      capability_id,
      glob_pattern
    )
    values (_workspace_id, saved_id, trim(path_rule));
  end loop;
  return saved_id;
end;
$$;

create function public.save_integration(
  _workspace_id uuid,
  _integration_id uuid,
  _name text,
  _provider_key text,
  _environment text,
  _base_url text,
  _active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  parsed_host text;
begin
  if not private.can_admin(_workspace_id) then
    raise exception 'Not authorized';
  end if;
  if _base_url !~ '^https://[A-Za-z0-9.-]+(?::[0-9]+)?(?:/.*)?$' then
    raise exception 'Base URL must use HTTPS and include a valid hostname';
  end if;
  parsed_host := lower(substring(_base_url from '^https://([^/:]+)'));
  if parsed_host is null then
    raise exception 'Base URL hostname is invalid';
  end if;
  if not exists (
    select 1
    from public.workspace_allowed_hosts host
    where host.workspace_id = _workspace_id
      and host.hostname = parsed_host
  ) then
    raise exception 'Add this hostname to the outbound allowlist first';
  end if;

  if _integration_id is null then
    insert into public.integrations (
      workspace_id,
      name,
      provider_key,
      environment,
      base_url,
      active
    )
    values (
      _workspace_id,
      trim(_name),
      lower(trim(_provider_key)),
      trim(_environment),
      trim(_base_url),
      _active
    )
    returning id into saved_id;
  else
    update public.integrations
    set
      name = trim(_name),
      provider_key = lower(trim(_provider_key)),
      environment = trim(_environment),
      base_url = trim(_base_url),
      active = _active
    where id = _integration_id and workspace_id = _workspace_id
    returning id into saved_id;
    if saved_id is null then
      raise exception 'Integration not found';
    end if;
  end if;
  return saved_id;
end;
$$;

create function public.save_archetype(
  _workspace_id uuid,
  _archetype_id uuid,
  _name text,
  _description text,
  _region text,
  _auth_mode text,
  _permission_profile text,
  _risk_weight integer,
  _active boolean,
  _metadata jsonb,
  _capability_ids uuid[],
  _integration_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
begin
  if not private.can_admin(_workspace_id) then
    raise exception 'Not authorized';
  end if;

  if _archetype_id is null then
    insert into public.tenant_archetypes (
      workspace_id,
      name,
      description,
      region,
      auth_mode,
      permission_profile,
      risk_weight,
      active,
      metadata,
      created_by
    )
    values (
      _workspace_id,
      trim(_name),
      nullif(trim(_description), ''),
      trim(_region),
      trim(_auth_mode),
      trim(_permission_profile),
      _risk_weight,
      _active,
      coalesce(_metadata, '{}'::jsonb),
      auth.uid()
    )
    returning id into saved_id;
  else
    update public.tenant_archetypes
    set
      name = trim(_name),
      description = nullif(trim(_description), ''),
      region = trim(_region),
      auth_mode = trim(_auth_mode),
      permission_profile = trim(_permission_profile),
      risk_weight = _risk_weight,
      active = _active,
      archived_at = case when _active then null else archived_at end,
      metadata = coalesce(_metadata, '{}'::jsonb)
    where id = _archetype_id
      and workspace_id = _workspace_id
      and archived_at is null
    returning id into saved_id;
    if saved_id is null then
      raise exception 'Archetype not found';
    end if;
  end if;

  delete from public.archetype_capabilities
  where workspace_id = _workspace_id and archetype_id = saved_id;
  insert into public.archetype_capabilities (
    workspace_id,
    archetype_id,
    capability_id
  )
  select _workspace_id, saved_id, capability_id
  from unnest(coalesce(_capability_ids, array[]::uuid[])) capability_id;

  delete from public.archetype_integrations
  where workspace_id = _workspace_id and archetype_id = saved_id;
  insert into public.archetype_integrations (
    workspace_id,
    archetype_id,
    integration_id
  )
  select _workspace_id, saved_id, integration_id
  from unnest(coalesce(_integration_ids, array[]::uuid[])) integration_id;

  return saved_id;
end;
$$;

revoke all on function public.create_workspace_invitation(uuid, text, public.workspace_role) from public, anon;
grant execute on function public.create_workspace_invitation(uuid, text, public.workspace_role) to authenticated;
revoke all on function public.accept_workspace_invitation(text) from public, anon;
grant execute on function public.accept_workspace_invitation(text) to authenticated;
revoke all on function public.list_workspace_members(uuid) from public, anon;
grant execute on function public.list_workspace_members(uuid) to authenticated;
revoke all on function public.save_capability(uuid, uuid, text, text, public.criticality, boolean, text[]) from public, anon;
grant execute on function public.save_capability(uuid, uuid, text, text, public.criticality, boolean, text[]) to authenticated;
revoke all on function public.save_integration(uuid, uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.save_integration(uuid, uuid, text, text, text, text, boolean) to authenticated;
revoke all on function public.save_archetype(uuid, uuid, text, text, text, text, text, integer, boolean, jsonb, uuid[], uuid[]) from public, anon;
grant execute on function public.save_archetype(uuid, uuid, text, text, text, text, text, integer, boolean, jsonb, uuid[], uuid[]) to authenticated;
