create function public.save_journey(
  _workspace_id uuid,
  _journey_id uuid,
  _name text,
  _description text,
  _integration_id uuid,
  _timeout_ms integer,
  _active boolean,
  _capability_ids uuid[],
  _steps jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_journey_id uuid;
  step_value jsonb;
  assertion_value jsonb;
  saved_step_id uuid;
  step_count integer;
begin
  if not private.can_edit(_workspace_id) then
    raise exception 'Not authorized';
  end if;
  if char_length(trim(_name)) not between 2 and 120 then
    raise exception 'Journey name must be between 2 and 120 characters';
  end if;
  if _timeout_ms not between 500 and 60000 then
    raise exception 'Journey timeout must be between 500 and 60000 milliseconds';
  end if;
  if jsonb_typeof(_steps) <> 'array' then
    raise exception 'Journey steps must be an array';
  end if;

  step_count := jsonb_array_length(_steps);
  if step_count < 1 or step_count > 30 then
    raise exception 'A journey must have between 1 and 30 steps';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(_steps) item
    where coalesce((item->>'is_cleanup')::boolean, false) = false
  ) then
    raise exception 'A journey needs at least one primary step';
  end if;
  if (
    select count(*)
    from jsonb_array_elements(_steps) item
    where coalesce((item->>'is_cleanup')::boolean, false)
  ) > 5 then
    raise exception 'A journey can have at most five cleanup steps';
  end if;

  if _journey_id is null then
    insert into public.journeys (
      workspace_id,
      name,
      description,
      integration_id,
      timeout_ms,
      active,
      created_by
    )
    values (
      _workspace_id,
      trim(_name),
      nullif(trim(_description), ''),
      _integration_id,
      _timeout_ms,
      _active,
      auth.uid()
    )
    returning id into saved_journey_id;
  else
    update public.journeys
    set
      name = trim(_name),
      description = nullif(trim(_description), ''),
      integration_id = _integration_id,
      timeout_ms = _timeout_ms,
      active = _active
    where id = _journey_id and workspace_id = _workspace_id
    returning id into saved_journey_id;
    if saved_journey_id is null then
      raise exception 'Journey not found';
    end if;
  end if;

  delete from public.journey_capabilities
  where workspace_id = _workspace_id
    and journey_id = saved_journey_id;

  insert into public.journey_capabilities (
    workspace_id,
    journey_id,
    capability_id
  )
  select _workspace_id, saved_journey_id, capability_id
  from unnest(coalesce(_capability_ids, array[]::uuid[])) capability_id;

  delete from public.journey_steps
  where workspace_id = _workspace_id
    and journey_id = saved_journey_id;

  for step_value in
    select item
    from jsonb_array_elements(_steps) item
    order by
      coalesce((item->>'is_cleanup')::boolean, false),
      (item->>'position')::integer
  loop
    if jsonb_array_length(coalesce(step_value->'assertions', '[]'::jsonb)) > 20 then
      raise exception 'A step can have at most 20 assertions';
    end if;

    insert into public.journey_steps (
      workspace_id,
      journey_id,
      position,
      name,
      method,
      path_template,
      request_headers,
      request_body,
      extraction_rules,
      continue_on_failure,
      is_cleanup
    )
    values (
      _workspace_id,
      saved_journey_id,
      (step_value->>'position')::integer,
      trim(step_value->>'name'),
      (step_value->>'method')::public.http_method,
      step_value->>'path_template',
      coalesce(step_value->'request_headers', '{}'::jsonb),
      step_value->'request_body',
      coalesce(step_value->'extraction_rules', '[]'::jsonb),
      coalesce((step_value->>'continue_on_failure')::boolean, false),
      coalesce((step_value->>'is_cleanup')::boolean, false)
    )
    returning id into saved_step_id;

    for assertion_value in
      select item
      from jsonb_array_elements(coalesce(step_value->'assertions', '[]'::jsonb)) item
    loop
      insert into public.journey_assertions (
        workspace_id,
        journey_step_id,
        assertion_type,
        target,
        operator,
        expected_value
      )
      values (
        _workspace_id,
        saved_step_id,
        (assertion_value->>'assertion_type')::public.assertion_type,
        nullif(assertion_value->>'target', ''),
        coalesce(nullif(assertion_value->>'operator', ''), 'eq'),
        assertion_value->'expected_value'
      );
    end loop;
  end loop;

  return saved_journey_id;
end;
$$;

revoke all on function public.save_journey(uuid, uuid, text, text, uuid, integer, boolean, uuid[], jsonb) from public, anon;
grant execute on function public.save_journey(uuid, uuid, text, text, uuid, integer, boolean, uuid[], jsonb) to authenticated;
