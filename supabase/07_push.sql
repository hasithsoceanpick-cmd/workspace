-- =====================================================================
--  WORKSPACE — phone alerts (step 7 of 8)
--  Run after 01–06. Safe to run again.
--
--  Whatever lands in someone's bell is also sent to every phone / computer
--  where they switched "Phone alerts" on (their account menu).
--
--  How it travels:  new notification → this database (pg_net) → the Edge
--  Function "workspace-push" (supabase/functions/workspace-push) → Google /
--  Apple / Mozilla / Microsoft push service → the device.
--
--  The admin turns it on once in Admin console → Phone alerts, which creates
--  the signing keys. The private key is stored only here, in a table nobody
--  can read from the app.
-- =====================================================================

-- pg_net lets the database call the Edge Function. (Supabase → Database → Extensions → pg_net)
do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net could not be switched on here (%). Turn it on in Database → Extensions.', sqlerrm;
end $$;

-- ---------- Tables ------------------------------------------------------
-- One row per device that wants alerts
create table if not exists public.workspace_push_subscriptions (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  device        text not null default '',
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists workspace_push_subscriptions_user_idx on public.workspace_push_subscriptions (user_id);

-- The one settings row (signing keys and where the Edge Function lives)
create table if not exists public.workspace_push_config (
  id            int primary key default 1 check (id = 1),
  function_url  text not null,
  public_key    text not null,
  private_key   text not null,
  subject       text not null,
  api_key       text,
  enabled       boolean not null default true,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null
);

-- Each batch handed to pg_net, so the admin page can show how sending went
create table if not exists public.workspace_push_log (
  id          bigint generated always as identity primary key,
  request_id  bigint not null,
  messages    int not null,
  test        boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.workspace_push_subscriptions enable row level security;
alter table public.workspace_push_config        enable row level security;
alter table public.workspace_push_log           enable row level security;

-- people see (and remove) only their own devices; everything else goes through the functions below
drop policy if exists workspace_push_subscriptions_own on public.workspace_push_subscriptions;
create policy workspace_push_subscriptions_own on public.workspace_push_subscriptions for select to authenticated
  using (user_id = auth.uid());

revoke all on public.workspace_push_subscriptions, public.workspace_push_config, public.workspace_push_log
  from anon, authenticated;
grant select on public.workspace_push_subscriptions to authenticated;

-- ---------- Helpers -----------------------------------------------------
-- only the official push services (the same list the Edge Function accepts)
create or replace function public.workspace_push_endpoint_ok(p_endpoint text) returns boolean
language sql immutable as $$
  select coalesce(p_endpoint ~ '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(:443)?/', false)
$$;

create or replace function public.workspace_push_title(p_kind text) returns text
language sql immutable as $$
  select case p_kind
    when 'assigned'    then 'New task'
    when 'reassigned'  then 'Task handed over'
    when 'done'        then 'Task completed'
    when 'waiting'     then 'Waiting on something'
    when 'due_moved'   then 'Deadline moved'
    when 'edited'      then 'Task updated'
    when 'comment'     then 'New comment'
    when 'helper'      then 'You''re helping on a task'
    when 'overdue'     then 'Missed deadline'
    when 'due_today'   then 'Due today'
    when 'due_soon'    then 'Coming up'
    when 'weekly'      then 'Weekly summary'
    when 'month_end'   then 'Month-end'
    when 'signup'      then 'New sign-up'
    when 'shared'      then 'Note shared with you'
    when 'review'      then 'Ready for your sign-off'
    when 'signed_off'  then 'Signed off'
    when 'sent_back'   then 'Sent back to you'
    when 'unseen'      then 'Not opened yet'
    when 'reminder'    then 'Reminder'
    when 'escalated'   then 'Escalated'
    when 'test'        then 'Phone alerts are working'
    else 'Workspace'
  end
$$;

-- hand one batch to the Edge Function (pg_net sends it after the transaction commits)
create or replace function public.workspace_push_post(p_msgs jsonb, p_test boolean default false) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  cfg public.workspace_push_config;
  rid bigint;
begin
  select * into cfg from public.workspace_push_config where id = 1;
  if not found or jsonb_array_length(coalesce(p_msgs, '[]')) = 0 then
    return null;
  end if;
  rid := net.http_post(
    url := cfg.function_url,
    body := jsonb_build_object(
      'vapid', jsonb_build_object('public_key', cfg.public_key, 'private_key', cfg.private_key, 'subject', cfg.subject),
      'messages', p_msgs),
    headers := jsonb_build_object('Content-Type', 'application/json')
               || case when cfg.api_key is not null
                       then jsonb_build_object('apikey', cfg.api_key, 'Authorization', 'Bearer ' || cfg.api_key)
                       else '{}'::jsonb end,
    timeout_milliseconds := 15000);
  insert into public.workspace_push_log (request_id, messages, test) values (rid, jsonb_array_length(p_msgs), p_test);
  delete from public.workspace_push_log where id < (select max(id) - 300 from public.workspace_push_log);
  return rid;
end $$;

-- forget devices the push service says are gone, and devices unused for four months
create or replace function public.workspace_push_cleanup() returns void
language plpgsql security definer set search_path = public as $$
begin
  if to_regclass('net._http_response') is not null then
    delete from public.workspace_push_subscriptions s
     using (select jsonb_array_elements_text(r.content::jsonb -> 'gone') as endpoint
              from net._http_response r
              join public.workspace_push_log l on l.request_id = r.id
             where r.status_code = 200 and r.content like '{"workspace_push":true%') g
     where s.endpoint = g.endpoint;
  end if;
  delete from public.workspace_push_subscriptions where last_seen_at < now() - interval '120 days';
end $$;

-- ---------- New notifications → phones ------------------------------------
create or replace function public.workspace_push_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  batch jsonb;
begin
  if not exists (select 1 from public.workspace_push_config where id = 1 and enabled) then
    return null;
  end if;
  begin
    perform public.workspace_push_cleanup();
    for batch in
      select jsonb_agg(m)
      from (select jsonb_build_object(
                     'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
                     'title', public.workspace_push_title(f.kind),
                     'body', left(f.message, 400),
                     'notice', f.id,
                     'tag', coalesce(f.app_key, 'workspace') || '-' || coalesce(f.ref_id::text, f.kind)) as m,
                   (row_number() over (order by f.id, s.id) - 1) / 200 as chunk
              from fresh f
              join public.workspace_push_subscriptions s on s.user_id = f.user_id) x
      group by chunk
    loop
      perform public.workspace_push_post(batch);
    end loop;
  exception when others then
    raise warning 'Workspace phone alerts: %', sqlerrm;   -- an alert problem never stops the app
  end;
  return null;
end $$;

drop trigger if exists workspace_push_notify on public.notifications;
create trigger workspace_push_notify after insert on public.notifications
  referencing new table as fresh
  for each statement execute function public.workspace_push_notify();

-- ---------- For everyone: this device's alerts ----------------------------
create or replace function public.workspace_push_public_key() returns text
language sql stable security definer set search_path = public as $$
  select public_key from public.workspace_push_config where id = 1 and enabled
$$;

create or replace function public.workspace_push_save(p_endpoint text, p_p256dh text, p_auth text, p_device text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  if not public.workspace_push_endpoint_ok(p_endpoint) then
    raise exception 'This device''s alert address isn''t one we can send to.';
  end if;
  if length(coalesce(p_p256dh, '')) < 80 or length(coalesce(p_auth, '')) < 16 then
    raise exception 'This device sent incomplete alert keys.';
  end if;
  insert into public.workspace_push_subscriptions (user_id, endpoint, p256dh, auth, device)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_device, ''), 60))
  on conflict (endpoint) do update
     set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         device = excluded.device, last_seen_at = now();
end $$;

create or replace function public.workspace_push_forget(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.workspace_push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

-- ---------- For the admin: set up, check, test ----------------------------
create or replace function public.workspace_push_setup(p_url text, p_public text, p_private text,
                                                      p_subject text, p_api_key text)
returns void language plpgsql security definer set search_path = public as $$
declare
  old_key text;
begin
  if not public.is_admin() then
    raise exception 'Only the administrator can set up phone alerts.' using errcode = '42501';
  end if;
  if coalesce(p_url, '') !~ '^https?://[^ ]+/functions/v1/workspace-push$' then
    raise exception 'That doesn''t look like the address of the workspace-push function.';
  end if;
  if length(coalesce(p_public, '')) < 80 or length(coalesce(p_private, '')) < 40
     or coalesce(p_subject, '') !~ '^(https://|mailto:)' then
    raise exception 'The new keys are incomplete. Please try again.';
  end if;
  select public_key into old_key from public.workspace_push_config where id = 1;
  insert into public.workspace_push_config (id, function_url, public_key, private_key, subject, api_key, enabled, updated_at, updated_by)
  values (1, p_url, p_public, p_private, p_subject, nullif(p_api_key, ''), true, now(), auth.uid())
  on conflict (id) do update
     set function_url = excluded.function_url, public_key = excluded.public_key, private_key = excluded.private_key,
         subject = excluded.subject, api_key = excluded.api_key, enabled = true,
         updated_at = now(), updated_by = auth.uid();
  -- devices signed up with the old keys can't receive anything any more; they re-join by themselves next time
  if old_key is distinct from p_public then
    delete from public.workspace_push_subscriptions;
  end if;
end $$;

create or replace function public.workspace_push_enable(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only the administrator can do that.' using errcode = '42501';
  end if;
  update public.workspace_push_config set enabled = p_on, updated_at = now(), updated_by = auth.uid() where id = 1;
end $$;

create or replace function public.workspace_push_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cfg public.workspace_push_config;
  recent jsonb := '[]';
begin
  if not public.is_admin() then
    raise exception 'Only the administrator can see this.' using errcode = '42501';
  end if;
  select * into cfg from public.workspace_push_config where id = 1;
  if to_regclass('net._http_response') is not null then
    execute $q$
      select coalesce(jsonb_agg(x order by x.at desc), '[]') from (
        select l.created_at as at, l.messages, l.test, r.status_code as status, r.error_msg as error,
               r.timed_out, case when r.content like '{"workspace_push":true%' then r.content::jsonb end as result
          from public.workspace_push_log l
          left join net._http_response r on r.id = l.request_id
         order by l.id desc limit 12) x $q$ into recent;
  end if;
  return jsonb_build_object(
    'configured', cfg.id is not null,
    'enabled', coalesce(cfg.enabled, false),
    'function_url', cfg.function_url,
    'updated_at', cfg.updated_at,
    'pg_net', to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null,
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('user_id', s.user_id, 'device', s.device,
                                                             'last_seen_at', s.last_seen_at) order by s.last_seen_at desc), '[]')
                  from public.workspace_push_subscriptions s),
    'recent', recent);
end $$;

-- a test alert to the admin's own devices (returns the request number to check on)
create or replace function public.workspace_push_test() returns bigint
language plpgsql security definer set search_path = public as $$
declare
  msgs jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only the administrator can do that.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspace_push_config where id = 1) then
    raise exception 'Turn phone alerts on first.';
  end if;
  select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth,
                                      'title', public.workspace_push_title('test'),
                                      'body', 'This is how Workspace alerts will look on this device.',
                                      'notice', null, 'tag', 'workspace-test'))
    into msgs
    from public.workspace_push_subscriptions where user_id = auth.uid();
  if msgs is null then
    raise exception 'None of your devices has phone alerts on yet. Open your account menu (top right) on your phone and turn on Phone alerts.';
  end if;
  return public.workspace_push_post(msgs, true);
end $$;

create or replace function public.workspace_push_result(p_request bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  out jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only the administrator can see this.' using errcode = '42501';
  end if;
  if to_regclass('net._http_response') is null then
    return jsonb_build_object('done', false);
  end if;
  execute $q$
    select jsonb_build_object('done', true, 'status', r.status_code, 'error', r.error_msg, 'timed_out', r.timed_out,
                              'result', case when r.content like '{"workspace_push":true%' then r.content::jsonb end,
                              'text', left(r.content, 300))
      from net._http_response r where r.id = $1 $q$ into out using p_request;
  return coalesce(out, jsonb_build_object('done', false));
end $$;

-- ---------- Permissions -------------------------------------------------
revoke execute on function public.workspace_push_post(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.workspace_push_cleanup()            from public, anon, authenticated;
revoke execute on function public.workspace_push_notify()             from public, anon, authenticated;
revoke execute on function public.workspace_push_public_key()         from public, anon;
revoke execute on function public.workspace_push_save(text, text, text, text) from public, anon;
revoke execute on function public.workspace_push_forget(text)         from public, anon;
revoke execute on function public.workspace_push_setup(text, text, text, text, text) from public, anon;
revoke execute on function public.workspace_push_enable(boolean)      from public, anon;
revoke execute on function public.workspace_push_status()             from public, anon;
revoke execute on function public.workspace_push_test()               from public, anon;
revoke execute on function public.workspace_push_result(bigint)       from public, anon;
grant execute on function public.workspace_push_public_key()          to authenticated;
grant execute on function public.workspace_push_save(text, text, text, text) to authenticated;
grant execute on function public.workspace_push_forget(text)          to authenticated;
grant execute on function public.workspace_push_setup(text, text, text, text, text) to authenticated;
grant execute on function public.workspace_push_enable(boolean)       to authenticated;
grant execute on function public.workspace_push_status()              to authenticated;
grant execute on function public.workspace_push_test()                to authenticated;
grant execute on function public.workspace_push_result(bigint)        to authenticated;
