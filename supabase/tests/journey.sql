begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000003',
  true
);

create temporary table saved_journey as
select public.save_journey(
  'a0000000-0000-0000-0000-000000000001',
  null,
  'Create candidate',
  'Creates and removes a canary candidate',
  'a3000000-0000-0000-0000-000000000001',
  10000,
  true,
  array['a1000000-0000-0000-0000-000000000001']::uuid[],
  '[
    {
      "position": 0,
      "name": "Create candidate",
      "method": "POST",
      "path_template": "/candidates",
      "request_headers": {},
      "request_body": {"name": "Canary"},
      "extraction_rules": [{"name": "candidate_id", "source": "body", "path": "$.id"}],
      "continue_on_failure": false,
      "is_cleanup": false,
      "assertions": [
        {"assertion_type": "http_status", "operator": "eq", "expected_value": 201}
      ]
    },
    {
      "position": 0,
      "name": "Delete candidate",
      "method": "DELETE",
      "path_template": "/candidates/{{candidate_id}}",
      "request_headers": {},
      "request_body": null,
      "extraction_rules": [],
      "continue_on_failure": true,
      "is_cleanup": true,
      "assertions": []
    }
  ]'::jsonb
) as id;

select is(
  (select count(*) from public.journeys where id = (select id from saved_journey)),
  1::bigint,
  'engineers can create a journey transactionally'
);

select is(
  (
    select count(*)
    from public.journey_steps
    where journey_id = (select id from saved_journey)
  ),
  2::bigint,
  'primary and cleanup steps are persisted'
);

select is(
  (
    select count(*)
    from public.journey_assertions assertion
    join public.journey_steps step on step.id = assertion.journey_step_id
    where step.journey_id = (select id from saved_journey)
  ),
  1::bigint,
  'step assertions are persisted'
);

select is(
  (
    select count(*)
    from public.journey_capabilities
    where journey_id = (select id from saved_journey)
  ),
  1::bigint,
  'journey capability relationships are persisted'
);

reset role;

insert into public.runs (
  id,
  workspace_id,
  journey_id,
  archetype_id,
  journey_name,
  archetype_name,
  status
)
values (
  'd0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  (select id from saved_journey),
  'a2000000-0000-0000-0000-000000000001',
  'Create candidate',
  'US enterprise recruiter',
  'failed'
);

insert into public.run_step_results (
  id,
  workspace_id,
  run_id,
  journey_step_id,
  step_name,
  position,
  status
)
select
  'd1000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'd0000000-0000-0000-0000-000000000001',
  id,
  name,
  position,
  'failed'
from public.journey_steps
where journey_id = (select id from saved_journey)
  and is_cleanup = false;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000003',
  true
);

select lives_ok(
  format(
    $query$
      select public.save_journey(
        'a0000000-0000-0000-0000-000000000001',
        %L,
        'Read candidate',
        'Updated workflow',
        'a3000000-0000-0000-0000-000000000001',
        10000,
        true,
        array['a1000000-0000-0000-0000-000000000001']::uuid[],
        '[{
          "position": 0,
          "name": "Read candidate",
          "method": "GET",
          "path_template": "/candidates/known",
          "request_headers": {},
          "request_body": null,
          "extraction_rules": [],
          "continue_on_failure": false,
          "is_cleanup": false,
          "assertions": [{"assertion_type": "http_status", "expected_value": 200}]
        }]'::jsonb
      )
    $query$,
    (select id from saved_journey)
  ),
  'journey edits replace configuration in one transaction'
);

select is(
  (select count(*) from public.runs where id = 'd0000000-0000-0000-0000-000000000001'),
  1::bigint,
  'journey edits preserve historical runs'
);

select is(
  (
    select count(*)
    from public.run_step_results
    where id = 'd1000000-0000-0000-0000-000000000001'
      and journey_step_id is null
  ),
  1::bigint,
  'historical step evidence survives with its step snapshot'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000004',
  true
);

select throws_ok(
  $$
    select public.save_journey(
      'a0000000-0000-0000-0000-000000000001',
      null,
      'Viewer journey',
      '',
      'a3000000-0000-0000-0000-000000000001',
      10000,
      true,
      array['a1000000-0000-0000-0000-000000000001']::uuid[],
      '[{"position":0,"name":"Read","method":"GET","path_template":"/","is_cleanup":false}]'::jsonb
    )
  $$,
  'Not authorized',
  'viewers cannot save journeys'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000003',
  true
);

select throws_ok(
  $$
    select public.save_journey(
      'a0000000-0000-0000-0000-000000000001',
      null,
      'Cross workspace journey',
      '',
      'b3000000-0000-0000-0000-000000000001',
      10000,
      true,
      array['a1000000-0000-0000-0000-000000000001']::uuid[],
      '[{"position":0,"name":"Read","method":"GET","path_template":"/","is_cleanup":false}]'::jsonb
    )
  $$,
  'insert or update on table "journeys" violates foreign key constraint "journeys_workspace_id_integration_id_fkey"',
  'journeys cannot reference another workspace provider'
);

select * from finish();
rollback;
