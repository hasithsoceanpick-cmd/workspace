-- =====================================================================
--  WORKSPACE — update 4: phone alerts, checker sign-off, "Got it",
--  early reminders, Compliance calendar, Trends and search
--  For a database set up BEFORE this update (after update 2 or update 3).
--  Run once in the SQL Editor. Safe to run again. Keeps all your data.
--  It also contains everything from update 3, so it doesn't matter
--  whether update 3 was run.
--  (It is the ensure_profile part of 01_platform.sql + 02_app_tasks.sql
--   + the notes_search part of 05_app_notes.sql + 06_feature_month_end.sql
--   + 07_push.sql + 08_feature_compliance.sql.)
--  Nothing here touches tables or rules that other apps created.
-- =====================================================================

-- ---------- Logins made before Workspace get a profile on first sign-in ----------
-- >>> ensure_profile
create or replace function public.ensure_profile() returns void
language plpgsql security definer set search_path = public as $$
declare
  u  auth.users;
  nm text;
  n  int;
  palette text[] := array['#2563eb','#db2777','#059669','#d97706','#7c3aed',
                          '#0891b2','#dc2626','#65a30d','#c026d3','#ea580c'];
begin
  if auth.uid() is null or exists (select 1 from public.profiles where id = auth.uid()) then
    return;
  end if;
  select * into u from auth.users where id = auth.uid();
  if not found then return; end if;
  nm := coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1));
  select count(*) into n from public.profiles;
  insert into public.profiles (id, full_name, email, active, color)
  values (u.id, nm, coalesce(u.email, ''), false, palette[(n % array_length(palette, 1)) + 1])
  on conflict (id) do nothing;
  perform public.notify(public.admin_ids(), null, null, null, 'signup',
    format('%s (%s) signed in and is waiting for approval', nm, u.email), null);
end $$;
revoke execute on function public.ensure_profile() from public, anon;
grant  execute on function public.ensure_profile() to authenticated;
-- <<< ensure_profile

-- =====================================================================
--  WORKSPACE — Tasks app (step 2 of 8)
--  Run after 01_platform.sql. Safe to run again.
--
--  Every task belongs to exactly one department. People only ever see
--  tasks from their own department (the admin can see every department).
-- =====================================================================

insert into public.apps (key, name, description, sort)
values ('tasks', 'Tasks', 'Assign work, deadlines, calendar and daily review', 10)
on conflict (key) do update set name = excluded.name, description = excluded.description;

-- ---------- Tables -----------------------------------------------------
create table if not exists public.tasks (
  id                   bigint generated always as identity primary key,
  department_id        uuid not null references public.departments(id) on delete restrict,
  title                text not null check (length(trim(title)) > 0),
  notes                text not null default '',
  assignee_id          uuid not null references public.profiles(id),
  created_by           uuid references public.profiles(id) on delete set null,
  status               text not null default 'todo',   -- todo | doing | waiting | review | done (see tasks_status_check)
  priority             text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  due_date             date not null,
  completed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  overdue_notified_on  date,   -- internal: so each alert is only sent once
  reminded_on          date
);

create table if not exists public.task_comments (
  id          bigint generated always as identity primary key,
  task_id     bigint not null references public.tasks(id) on delete cascade,
  author_id   uuid default auth.uid() references public.profiles(id) on delete set null,
  body        text not null check (length(trim(body)) > 0),
  created_at  timestamptz not null default now()
);

-- Everything that happens to a task (history + the Day review)
create table if not exists public.task_activity (
  id             bigint generated always as identity primary key,
  task_id        bigint not null references public.tasks(id) on delete cascade,
  department_id  uuid not null references public.departments(id) on delete cascade,
  actor_id       uuid references public.profiles(id) on delete set null,
  kind           text not null,  -- created | status | due_date | assignee | edited | comment | helper_added | helper_removed | step
                                 -- | repeated | sent_back | acknowledged
  old_value      text,
  new_value      text,
  created_at     timestamptz not null default now()
);

-- If someone's login is deleted, their history stays (their name just shows as "Someone").
-- Tasks still ASSIGNED to them block the delete, so no work disappears.
alter table public.tasks drop constraint if exists tasks_created_by_fkey;
alter table public.tasks add constraint tasks_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.task_comments alter column author_id drop not null;
alter table public.task_comments drop constraint if exists task_comments_author_id_fkey;
alter table public.task_comments add constraint task_comments_author_id_fkey
  foreign key (author_id) references public.profiles(id) on delete set null;
alter table public.task_activity drop constraint if exists task_activity_actor_id_fkey;
alter table public.task_activity add constraint task_activity_actor_id_fkey
  foreign key (actor_id) references public.profiles(id) on delete set null;

-- People working on a task alongside its owner (added by managers / senior executives)
create table if not exists public.task_helpers (
  task_id        bigint not null references public.tasks(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  department_id  uuid not null references public.departments(id) on delete cascade,
  added_by       uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  primary key (task_id, user_id)
);

-- Checklist steps inside a task
create table if not exists public.task_checklist (
  id             bigint generated always as identity primary key,
  task_id        bigint not null references public.tasks(id) on delete cascade,
  department_id  uuid not null references public.departments(id) on delete cascade,
  body           text not null check (length(trim(body)) > 0),
  done           boolean not null default false,
  position       double precision not null default 0,
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  done_by        uuid references public.profiles(id) on delete set null,
  done_at        timestamptz,
  created_at     timestamptz not null default now()
);

-- Files (stored in the private "attachments" bucket) and links on a task
create table if not exists public.task_attachments (
  id             bigint generated always as identity primary key,
  task_id        bigint not null references public.tasks(id) on delete cascade,
  department_id  uuid not null references public.departments(id) on delete cascade,
  kind           text not null check (kind in ('file', 'link')),
  name           text not null check (length(trim(name)) > 0),
  url            text,         -- links
  path           text,         -- files: tasks/<task id>/<random>-<file name>
  size           bigint,
  mime           text,
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  check ((kind = 'link' and url is not null) or (kind = 'file' and path is not null))
);

-- Time blocks on someone's day (Today page), 07:00–20:30
create table if not exists public.time_blocks (
  id             bigint generated always as identity primary key,
  department_id  uuid not null references public.departments(id) on delete cascade,
  user_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  day            date not null,
  start_min      int not null,   -- minutes after midnight
  end_min        int not null,
  task_id        bigint references public.tasks(id) on delete cascade,
  title          text,
  created_at     timestamptz not null default now(),
  check (start_min >= 420 and end_min <= 1230 and end_min > start_min),
  check (task_id is not null or length(trim(coalesce(title, ''))) > 0)
);

create index if not exists tasks_dept_idx          on public.tasks (department_id, due_date);
create index if not exists tasks_assignee_idx      on public.tasks (assignee_id);
create index if not exists task_comments_task_idx  on public.task_comments (task_id);
create index if not exists task_activity_day_idx   on public.task_activity (department_id, created_at);
create index if not exists task_activity_task_idx  on public.task_activity (task_id);
create index if not exists task_helpers_user_idx    on public.task_helpers (user_id);
create index if not exists task_helpers_dept_idx    on public.task_helpers (department_id);
create index if not exists task_checklist_task_idx  on public.task_checklist (task_id, position);
create index if not exists task_checklist_dept_idx  on public.task_checklist (department_id);
create index if not exists task_attachments_task_idx on public.task_attachments (task_id);
create index if not exists time_blocks_day_idx      on public.time_blocks (department_id, day, user_id);

-- ---------- Deadline history + repeating tasks (added Oct 2026) ------------
alter table public.tasks add column if not exists original_due  date;              -- first deadline it was given
alter table public.tasks add column if not exists due_moves     int not null default 0;  -- times the deadline was moved
alter table public.tasks add column if not exists repeat        text check (repeat in ('weekly', 'monthly', 'quarterly', 'yearly'));
alter table public.tasks add column if not exists repeat_anchor date;              -- the series' first deadline
alter table public.tasks add column if not exists repeat_n      int not null default 0;  -- which occurrence this is
alter table public.tasks add column if not exists next_task_id  bigint references public.tasks(id) on delete set null;

do $$
begin
  perform set_config('app.system', 'on', true);   -- housekeeping: skip the task rules and alerts
  update public.tasks t
     set original_due = coalesce((select a.old_value::date from public.task_activity a
                                   where a.task_id = t.id and a.kind = 'due_date'
                                   order by a.created_at, a.id limit 1), t.due_date),
         due_moves = (select count(*) from public.task_activity a where a.task_id = t.id and a.kind = 'due_date')
   where t.original_due is null;
  perform set_config('app.system', 'off', true);
end $$;

-- ---------- Sign-off, "Got it", early reminders, series (added Oct 2026) -----
-- review  = the owner finished; waiting for whoever gave the task (or a manager) to sign it off
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('todo', 'doing', 'waiting', 'review', 'done'));
alter table public.tasks add column if not exists needs_check     boolean not null default true; -- sign-off needed when given by someone else
alter table public.tasks add column if not exists submitted_at    timestamptz;   -- when the owner finished it
alter table public.tasks add column if not exists checked_by      uuid references public.profiles(id) on delete set null;
alter table public.tasks add column if not exists checked_at      timestamptz;
alter table public.tasks add column if not exists sent_back_n     int not null default 0;
alter table public.tasks add column if not exists remind_days     int check (remind_days between 1 and 60);  -- remind N days before
alter table public.tasks add column if not exists remind_sent_for date;          -- internal: early reminder sent for this deadline
alter table public.tasks add column if not exists ack_reminded_on date;          -- internal: "not opened yet" reminder sent today
alter table public.tasks add column if not exists series_id       bigint references public.tasks(id) on delete set null; -- first task of a repeating series
create index if not exists tasks_series_idx on public.tasks (series_id);

-- "Got it": when the owner first saw a task someone else gave them.
-- Added once; tasks that already existed count as seen, so nobody gets a flood of reminders.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'tasks' and column_name = 'acknowledged_at') then
    alter table public.tasks add column acknowledged_at timestamptz;
    perform set_config('app.system', 'on', true);
    update public.tasks set acknowledged_at = created_at;
    perform set_config('app.system', 'off', true);
  end if;
end $$;

-- repeating tasks made before series existed: link each chain to its first task
do $$
begin
  perform set_config('app.system', 'on', true);
  with recursive chain as (
    select t.id as root, t.id from public.tasks t
     where (t.repeat is not null or t.next_task_id is not null)
       and not exists (select 1 from public.tasks p where p.next_task_id = t.id)
    union all
    select c.root, t.next_task_id from chain c join public.tasks t on t.id = c.id where t.next_task_id is not null
  )
  update public.tasks t set series_id = c.root from chain c where t.id = c.id and t.series_id is null;
  perform set_config('app.system', 'off', true);
end $$;

-- ---------- Who can see / assign ---------------------------------------
-- See a task:  admin → any;  otherwise it must be in MY department, I must have the
-- Tasks app, and:  manager → all;  senior → own + assigned by me + members';
-- member → own + assigned by me.
create or replace function public.can_see_task(p_dept uuid, p_assignee uuid, p_creator uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.is_admin()
    or (p_dept = public.my_dept()
        and public.user_has_app(auth.uid(), 'tasks', p_dept)
        and case public.my_role()
              when 'manager' then true
              when 'senior'  then p_assignee = auth.uid() or p_creator = auth.uid()
                                  or public.role_of(p_assignee) = 'member'
              when 'member'  then p_assignee = auth.uid() or p_creator = auth.uid()
              else false
            end), false)
$$;

-- Give work to someone: they must be active, in that department and have the Tasks app.
-- admin → anyone;  manager → anyone in my dept;  senior → self + members;  member → self.
create or replace function public.can_assign_task(p_target uuid, p_dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.user_has_app(p_target, 'tasks', p_dept)
    and (public.is_admin()
         or (p_dept = public.my_dept()
             and public.user_has_app(auth.uid(), 'tasks', p_dept)
             and case public.my_role()
                   when 'manager' then true
                   when 'senior'  then p_target = auth.uid() or public.role_of(p_target) = 'member'
                   when 'member'  then p_target = auth.uid()
                   else false
                 end)), false)
$$;

-- Am I a helper on this task? (and still in its department with the Tasks app)
create or replace function public.is_task_helper(p_task bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.task_helpers h
    where h.task_id = p_task and h.user_id = auth.uid()
      and h.department_id = public.my_dept()
      and public.user_has_app(auth.uid(), 'tasks', h.department_id))
$$;

create or replace function public.helper_ids(p_task bigint) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id), '{}') from public.task_helpers where task_id = p_task
$$;

-- Can I add (or remove) this person as a helper? Managers and senior executives only:
-- admin / manager → anyone in the department;  senior → themselves or members.
create or replace function public.can_manage_helper(p_task bigint, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select public.user_has_app(p_user, 'tasks', t.department_id)
       and public.can_see_task(t.department_id, t.assignee_id, t.created_by)
       and (public.is_admin()
            or (t.department_id = public.my_dept()
                and case public.my_role()
                      when 'manager' then true
                      when 'senior'  then p_user = auth.uid() or public.role_of(p_user) = 'member'
                      else false
                    end))
    from public.tasks t where t.id = p_task), false)
$$;

-- Owner, creator, leads (not helpers): may delete anyone's file on the task
create or replace function public.can_run_task(p_task bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.can_see_task(t.department_id, t.assignee_id, t.created_by)
                   from public.tasks t where t.id = p_task), false)
$$;

-- May I sign off this task? Whoever gave it, a manager of the department, or the admin — never its owner.
create or replace function public.can_check_task(p_dept uuid, p_assignee uuid, p_creator uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid() is distinct from p_assignee
    and (public.is_admin()
         or (p_dept = public.my_dept()
             and public.user_has_app(auth.uid(), 'tasks', p_dept)
             and (auth.uid() = p_creator or public.my_role() = 'manager'))), false)
$$;

-- Who is asked to sign off: whoever gave the task (the admin may give work in any department);
-- if they've left or moved to another department, the department's managers
create or replace function public.task_checker_ids(p_dept uuid, p_creator uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.profiles where id = p_creator and active
                           and (department_id = p_dept or public.is_admin_user(p_creator)))
              then array[p_creator] else public.manager_ids(p_dept) end
$$;

-- Storage: may I open / upload files under tasks/<task id>/... ?
create or replace function public.tasks_file_ok(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare ref bigint;
begin
  if split_part(p_name, '/', 1) <> 'tasks' then return false; end if;
  begin
    ref := split_part(p_name, '/', 2)::bigint;
  exception when others then
    return false;
  end;
  return exists (select 1 from public.tasks t where t.id = ref
                 and (public.can_see_task(t.department_id, t.assignee_id, t.created_by)
                      or public.is_task_helper(t.id)));
end $$;

-- ---------- Rules before saving ----------------------------------------
create or replace function public.tasks_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.system', true) = 'on' then
    return new;  -- internal housekeeping by the daily check
  end if;
  if pg_trigger_depth() > 1 then
    return new;  -- automatic clean-up by the database (e.g. a deleted person's name removed)
  end if;

  if tg_op = 'INSERT' then
    new.department_id := public.dept_of(new.assignee_id);  -- a task lives in its assignee's department
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    new.updated_at := now();
    new.completed_at := case when new.status = 'done' then now() end;
    new.overdue_notified_on := null;
    new.reminded_on := null;
    new.original_due := new.due_date;
    new.due_moves := 0;
    new.next_task_id := null;
    new.repeat_anchor := case when new.repeat is not null then new.due_date end;
    new.repeat_n := 0;
    new.series_id := case when new.repeat is not null then new.id end;
    new.remind_sent_for := null;
    new.ack_reminded_on := null;
    new.sent_back_n := 0;
    -- your own task needs no "Got it"; work given to someone else waits until they open it
    new.acknowledged_at := case when new.assignee_id = new.created_by then now() end;
    -- whoever creates a task is its checker, so it can't start out waiting for sign-off
    if new.status = 'review' then new.status := 'done'; end if;
    new.submitted_at := case when new.status = 'done' then now() end;
    new.checked_by := case when new.status = 'done' and new.assignee_id is distinct from new.created_by then new.created_by end;
    new.checked_at := case when new.checked_by is not null then now() end;
    return new;
  end if;

  -- UPDATE: department, creator and markers can't be changed by users
  new.department_id := old.department_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.overdue_notified_on := old.overdue_notified_on;
  new.reminded_on := old.reminded_on;
  new.original_due := old.original_due;
  new.next_task_id := old.next_task_id;
  new.remind_sent_for := old.remind_sent_for;
  new.ack_reminded_on := case when new.assignee_id is distinct from old.assignee_id then null else old.ack_reminded_on end;
  new.submitted_at := old.submitted_at;
  new.checked_by := old.checked_by;
  new.checked_at := old.checked_at;
  new.sent_back_n := old.sent_back_n;
  new.series_id := coalesce(old.series_id, case when new.repeat is not null then old.id end);
  new.due_moves := old.due_moves + case when new.due_date is distinct from old.due_date then 1 else 0 end;
  if new.repeat is distinct from old.repeat then      -- repeat switched on/changed: the series starts here
    new.repeat_anchor := case when new.repeat is not null then new.due_date end;
    new.repeat_n := 0;
  else
    new.repeat_anchor := old.repeat_anchor;
    new.repeat_n := old.repeat_n;
  end if;

  if auth.uid() is not null
     and new.assignee_id is distinct from old.assignee_id
     and not public.can_assign_task(new.assignee_id, old.department_id) then
    raise exception 'You can''t assign work to that person.' using errcode = '42501';
  end if;

  -- only whoever gave the task (or a manager) decides whether it needs their sign-off
  if new.needs_check is distinct from old.needs_check
     and auth.uid() is not null and not public.can_check_task(old.department_id, old.assignee_id, old.created_by) then
    raise exception 'Only the person who gave this task can change whether it needs sign-off.' using errcode = '42501';
  end if;

  -- "Got it": a new owner starts unseen; the owner's first action on the task counts as seeing it
  if new.assignee_id is distinct from old.assignee_id then
    new.acknowledged_at := case when new.assignee_id = auth.uid() then now() end;
  elsif old.acknowledged_at is null and auth.uid() = old.assignee_id
        and (new.acknowledged_at is not null or new.status is distinct from old.status
             or new.due_date is distinct from old.due_date) then
    new.acknowledged_at := now();
  else
    new.acknowledged_at := old.acknowledged_at;
  end if;

  -- sign-off (maker → checker)
  if new.status is distinct from old.status and auth.uid() is not null then
    declare
      checker boolean := public.can_check_task(old.department_id, new.assignee_id, old.created_by);
      needed  boolean := new.needs_check and old.created_by is not null and old.created_by is distinct from new.assignee_id;
    begin
      if old.status = 'review' and new.status = 'done' then
        if not checker then
          raise exception 'This is waiting for % to sign it off.', public.name_of(old.created_by) using errcode = '42501';
        end if;
        new.checked_by := auth.uid();
        new.checked_at := now();
      elsif old.status = 'review' then                 -- back to work: sent back by the checker, or taken back by the owner
        if not checker and auth.uid() is distinct from new.assignee_id then
          raise exception 'Only % or the owner can take this out of sign-off.', public.name_of(old.created_by) using errcode = '42501';
        end if;
        if checker then new.sent_back_n := old.sent_back_n + 1; end if;
        new.submitted_at := null;
      elsif new.status in ('done', 'review') then
        if needed and not checker then
          new.status := 'review';                      -- the owner finished: over to the checker
        else
          new.status := 'done';                        -- own task, or the checker finishing it themselves
          new.checked_by := case when needed then auth.uid() end;
          new.checked_at := case when needed then now() end;
        end if;
        new.submitted_at := now();
      else                                             -- reopened
        new.submitted_at := null;
        new.checked_by := null;
        new.checked_at := null;
      end if;
    end;
  end if;

  if new.status is distinct from old.status then
    new.completed_at := case when new.status = 'done' then now() end;
  else
    new.completed_at := old.completed_at;
  end if;

  if row(new.title, new.notes, new.assignee_id, new.status, new.priority, new.due_date, new.repeat, new.needs_check, new.remind_days)
     is distinct from
     row(old.title, old.notes, old.assignee_id, old.status, old.priority, old.due_date, old.repeat, old.needs_check, old.remind_days) then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;

drop trigger if exists tasks_before on public.tasks;
create trigger tasks_before before insert or update on public.tasks
  for each row execute function public.tasks_before();

-- ---------- History + notifications after saving -----------------------
create or replace function public.tasks_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  who   text := public.name_of(auth.uid());
  d     uuid := new.department_id;
  changed text[] := '{}';
  step  interval;
  nxt   date;
  nid   bigint;
  reason text;
begin
  if current_setting('app.system', true) = 'on' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    insert into public.task_activity (task_id, department_id, actor_id, kind, new_value)
    values (new.id, d, actor, 'created', new.title);
    perform public.notify(array[new.assignee_id], d, 'tasks', new.id, 'assigned',
      format('%s assigned you "%s" — due %s', who, new.title, public.fmt_date(new.due_date)), actor);
    return null;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'review' and new.status <> 'done' and actor is distinct from new.assignee_id then
      -- the checker sent it back, with what needs fixing
      reason := nullif(current_setting('app.sendback', true), '');
      insert into public.task_activity (task_id, department_id, actor_id, kind, old_value, new_value)
      values (new.id, d, actor, 'sent_back', new.status, reason);
      perform public.notify(array[new.assignee_id] || public.helper_ids(new.id), d, 'tasks', new.id, 'sent_back',
        format('%s sent back "%s"%s', who, new.title, coalesce(': ' || reason, '')), actor);
    else
      insert into public.task_activity (task_id, department_id, actor_id, kind, old_value, new_value)
      values (new.id, d, actor, 'status', old.status, new.status);
      if new.status = 'review' then
        perform public.notify(public.task_checker_ids(d, new.created_by), d, 'tasks', new.id, 'review',
          format('%s finished "%s" — please check it and sign it off', who, new.title), actor);
      elsif new.status = 'done' and old.status = 'review' then
        perform public.notify(array[new.assignee_id] || public.helper_ids(new.id), d, 'tasks', new.id, 'signed_off',
          format('%s signed off "%s"', who, new.title), actor);
      elsif new.status = 'done' then
        perform public.notify(array[new.created_by, new.assignee_id] || public.helper_ids(new.id), d, 'tasks', new.id, 'done',
          format('%s completed "%s"', who, new.title), actor);
      elsif new.status = 'waiting' then
        perform public.notify(array[new.created_by], d, 'tasks', new.id, 'waiting',
          format('%s is waiting on something for "%s"', who, new.title), actor);
      end if;
    end if;
  end if;

  if new.acknowledged_at is not null and old.acknowledged_at is null and new.assignee_id = old.assignee_id then
    insert into public.task_activity (task_id, department_id, actor_id, kind)
    values (new.id, d, actor, 'acknowledged');
  end if;

  -- deadline moved → assignee, assigner and the department's managers
  if new.due_date is distinct from old.due_date then
    insert into public.task_activity (task_id, department_id, actor_id, kind, old_value, new_value)
    values (new.id, d, actor, 'due_date', old.due_date::text, new.due_date::text);
    perform public.notify(array[new.assignee_id, new.created_by] || public.manager_ids(d) || public.helper_ids(new.id),
      d, 'tasks', new.id, 'due_moved',
      format('%s moved the deadline for "%s": %s → %s',
             who, new.title, public.fmt_date(old.due_date), public.fmt_date(new.due_date)), actor);
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    insert into public.task_activity (task_id, department_id, actor_id, kind, old_value, new_value)
    values (new.id, d, actor, 'assignee', old.assignee_id::text, new.assignee_id::text);
    perform public.notify(array[new.assignee_id], d, 'tasks', new.id, 'assigned',
      format('%s assigned you "%s" — due %s', who, new.title, public.fmt_date(new.due_date)), actor);
    perform public.notify(array[old.assignee_id], d, 'tasks', new.id, 'reassigned',
      format('%s moved "%s" to %s', who, new.title, public.name_of(new.assignee_id)), actor);
  end if;

  if new.title    is distinct from old.title    then changed := changed || 'title'::text;    end if;
  if new.notes    is distinct from old.notes    then changed := changed || 'notes'::text;    end if;
  if new.priority is distinct from old.priority then changed := changed || 'priority'::text; end if;
  if new.repeat   is distinct from old.repeat   then changed := changed || 'repeat'::text;   end if;
  if new.remind_days is distinct from old.remind_days then changed := changed || 'reminder'::text; end if;
  if new.needs_check is distinct from old.needs_check then changed := changed || 'sign-off'::text; end if;
  if cardinality(changed) > 0 then
    insert into public.task_activity (task_id, department_id, actor_id, kind, old_value, new_value)
    values (new.id, d, actor, 'edited',
            case when 'priority' = any(changed) then old.priority end,
            array_to_string(changed, ', '));
    perform public.notify(array[new.assignee_id], d, 'tasks', new.id, 'edited',
      format('%s updated the %s of "%s"', who, array_to_string(changed, ', '), new.title), actor);
  end if;

  -- repeating task completed → the next one, on the series' schedule (once per occurrence)
  if new.status = 'done' and old.status <> 'done' and new.repeat is not null and new.next_task_id is null then
    step := case new.repeat when 'weekly' then interval '7 days' when 'monthly' then interval '1 month'
                            when 'quarterly' then interval '3 months' else interval '1 year' end;
    nxt := (coalesce(new.repeat_anchor, new.due_date) + step * (new.repeat_n + 1))::date;
    perform set_config('app.system', 'on', true);
    insert into public.tasks (department_id, title, notes, assignee_id, created_by, status, priority, due_date,
                              original_due, due_moves, repeat, repeat_anchor, repeat_n, created_at, updated_at,
                              needs_check, remind_days, series_id, acknowledged_at)
    values (d, new.title, new.notes, new.assignee_id, new.created_by, 'todo', new.priority, nxt,
            nxt, 0, new.repeat, coalesce(new.repeat_anchor, new.due_date), new.repeat_n + 1, now(), now(),
            new.needs_check, new.remind_days, coalesce(new.series_id, new.id), now())   -- a routine they know: no "Got it" needed
    returning id into nid;
    insert into public.task_checklist (task_id, department_id, body, position, created_by)
    select nid, d, c.body, c.position, c.created_by from public.task_checklist c where c.task_id = new.id;
    insert into public.task_helpers (task_id, user_id, department_id, added_by)
    select nid, h.user_id, d, h.added_by from public.task_helpers h where h.task_id = new.id;
    update public.tasks set next_task_id = nid where id = new.id;
    insert into public.task_activity (task_id, department_id, actor_id, kind, old_value, new_value)
    values (nid, d, actor, 'repeated', new.id::text, new.repeat);
    perform set_config('app.system', 'off', true);
  end if;
  return null;
end $$;

drop trigger if exists tasks_after on public.tasks;
create trigger tasks_after after insert or update on public.tasks
  for each row execute function public.tasks_after();

-- deleting a task clears its notifications
create or replace function public.tasks_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.notifications where app_key = 'tasks' and ref_id = old.id;
  return null;
end $$;

drop trigger if exists tasks_deleted on public.tasks;
create trigger tasks_deleted after delete on public.tasks
  for each row execute function public.tasks_deleted();

create or replace function public.task_comments_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = new.task_id;
  insert into public.task_activity (task_id, department_id, actor_id, kind, new_value, created_at)
  values (t.id, t.department_id, new.author_id, 'comment', left(new.body, 300), new.created_at);
  perform public.notify(array[t.assignee_id, t.created_by] || public.helper_ids(t.id), t.department_id, 'tasks', t.id, 'comment',
    format('%s commented on "%s": %s', public.name_of(new.author_id), t.title, left(new.body, 120)),
    new.author_id);
  return null;
end $$;

drop trigger if exists task_comments_after on public.task_comments;
create trigger task_comments_after after insert on public.task_comments
  for each row execute function public.task_comments_after();

-- ---------- Helpers, checklist, files, time blocks ----------------------
create or replace function public.task_children_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.department_id := (select department_id from public.tasks where id = new.task_id);
  else
    new.department_id := old.department_id;
    new.task_id := old.task_id;
  end if;
  return new;
end $$;

drop trigger if exists task_helpers_before on public.task_helpers;
create trigger task_helpers_before before insert or update on public.task_helpers
  for each row execute function public.task_children_before();
drop trigger if exists task_checklist_before on public.task_checklist;
create trigger task_checklist_before before insert or update on public.task_checklist
  for each row execute function public.task_children_before();
drop trigger if exists task_attachments_before on public.task_attachments;
create trigger task_attachments_before before insert or update on public.task_attachments
  for each row execute function public.task_children_before();

-- helpers: stamp who added them, never the owner; tell the helper; log it
create or replace function public.task_helpers_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.system', true) = 'on' then
    return new;
  end if;
  new.added_by := coalesce(auth.uid(), new.added_by);
  if exists (select 1 from public.tasks where id = new.task_id and assignee_id = new.user_id) then
    raise exception 'That person already owns this task.';
  end if;
  return new;
end $$;

drop trigger if exists task_helpers_rules on public.task_helpers;
create trigger task_helpers_rules before insert on public.task_helpers
  for each row execute function public.task_helpers_rules();

create or replace function public.task_helpers_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.tasks;
begin
  if current_setting('app.system', true) = 'on' then
    return null;   -- copied onto the next occurrence of a repeating task
  end if;
  if tg_op = 'INSERT' then
    select * into t from public.tasks where id = new.task_id;
    insert into public.task_activity (task_id, department_id, actor_id, kind, new_value)
    values (t.id, t.department_id, auth.uid(), 'helper_added', new.user_id::text);
    perform public.notify(array[new.user_id], t.department_id, 'tasks', t.id, 'helper',
      format('%s added you as a helper on "%s" — due %s', public.name_of(auth.uid()), t.title,
             public.fmt_date(t.due_date)), auth.uid());
  elsif pg_trigger_depth() = 1 then
    select * into t from public.tasks where id = old.task_id;
    if found then
      insert into public.task_activity (task_id, department_id, actor_id, kind, old_value)
      values (t.id, t.department_id, auth.uid(), 'helper_removed', old.user_id::text);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists task_helpers_after on public.task_helpers;
create trigger task_helpers_after after insert or delete on public.task_helpers
  for each row execute function public.task_helpers_after();

-- a helper who becomes the owner stops being a helper
create or replace function public.tasks_owner_not_helper() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is distinct from old.assignee_id then
    delete from public.task_helpers where task_id = new.id and user_id = new.assignee_id;
  end if;
  return null;
end $$;

drop trigger if exists tasks_owner_not_helper on public.tasks;
create trigger tasks_owner_not_helper after update on public.tasks
  for each row execute function public.tasks_owner_not_helper();

-- checklist: record who ticked a step and when; log ticks in the history
create or replace function public.task_checklist_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.system', true) = 'on' then
    return new;    -- copied onto the next occurrence of a repeating task
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if new.done then new.done_by := auth.uid(); new.done_at := now(); end if;
  elsif new.done is distinct from old.done then
    new.done_by := case when new.done then auth.uid() end;
    new.done_at := case when new.done then now() end;
  else
    new.done_by := old.done_by;
    new.done_at := old.done_at;
  end if;
  return new;
end $$;

drop trigger if exists task_checklist_rules on public.task_checklist;
create trigger task_checklist_rules before insert or update on public.task_checklist
  for each row execute function public.task_checklist_rules();

create or replace function public.task_checklist_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.done is distinct from old.done then
    insert into public.task_activity (task_id, department_id, actor_id, kind, old_value, new_value)
    values (new.task_id, new.department_id, auth.uid(), 'step',
            case when new.done then 'done' else 'undone' end, new.body);
  end if;
  return null;
end $$;

drop trigger if exists task_checklist_after on public.task_checklist;
create trigger task_checklist_after after update on public.task_checklist
  for each row execute function public.task_checklist_after();

create or replace function public.task_attachments_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end $$;

drop trigger if exists task_attachments_rules on public.task_attachments;
create trigger task_attachments_rules before insert on public.task_attachments
  for each row execute function public.task_attachments_rules();

-- time blocks always belong to the person who makes them, in their department
create or replace function public.time_blocks_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.user_id := coalesce(auth.uid(), new.user_id);
    new.department_id := public.dept_of(new.user_id);
  else
    new.user_id := old.user_id;
    new.department_id := old.department_id;
  end if;
  return new;
end $$;

drop trigger if exists time_blocks_before on public.time_blocks;
create trigger time_blocks_before before insert or update on public.time_blocks
  for each row execute function public.time_blocks_before();

-- ---------- Daily deadline check ----------------------------------------
-- Missed deadline → assignee, assigner and that department's managers (once per deadline)
-- Due today       → one morning reminder per person
-- Coming up       → the early reminder a task asked for ("remind me N days before"), once per deadline
-- Not opened yet  → each morning to whoever hasn't pressed "Got it"; once to whoever gave the task
-- (Tasks waiting for sign-off are finished as far as their owner is concerned: no deadline alerts.)
-- Runs every morning (step 4) and whenever someone opens the app. Never double-sends.
create or replace function public.run_deadline_check() returns void
language plpgsql security definer set search_path = public as $$
declare
  today date := public.app_today();
begin
  perform set_config('app.system', 'on', true);

  with missed as (
    update public.tasks set overdue_notified_on = due_date
     where status not in ('done', 'review') and due_date < today
       and overdue_notified_on is distinct from due_date
    returning id, department_id, title, assignee_id, created_by, due_date
  ), recipients as (
    select distinct m.id, m.department_id, m.title, m.assignee_id, m.due_date, r.uid
    from missed m
    cross join lateral unnest(array[m.assignee_id, m.created_by] || public.manager_ids(m.department_id)
                              || public.helper_ids(m.id)) as r(uid)
  )
  insert into public.notifications (user_id, department_id, app_key, ref_id, kind, message)
  select r.uid, r.department_id, 'tasks', r.id, 'overdue',
         case when r.uid = r.assignee_id
              then format('Missed deadline: "%s" was due %s', r.title, public.fmt_date(r.due_date))
              else format('Missed deadline: %s — "%s" was due %s',
                          public.name_of(r.assignee_id), r.title, public.fmt_date(r.due_date)) end
  from recipients r
  join public.profiles p on p.id = r.uid and p.active;

  with due as (
    update public.tasks set reminded_on = today
     where status not in ('done', 'review') and due_date = today
       and reminded_on is distinct from today
       and (created_at at time zone public.app_tz())::date < today
    returning department_id, assignee_id, title, priority
  ), grouped as (
    select department_id, assignee_id, count(*) as n,
           string_agg('"' || title || '"', ', ' order by (priority = 'high') desc, title) as titles
    from due group by department_id, assignee_id
  )
  insert into public.notifications (user_id, department_id, app_key, kind, message)
  select g.assignee_id, g.department_id, 'tasks', 'due_today',
         case when g.n = 1 then format('Due today: %s', g.titles)
              else format('%s tasks due today: %s', g.n, left(g.titles, 220)) end
  from grouped g
  join public.profiles p on p.id = g.assignee_id and p.active;

  with soon as (
    update public.tasks set remind_sent_for = due_date
     where status not in ('done', 'review') and remind_days is not null
       and due_date > today and due_date - remind_days <= today
       and remind_sent_for is distinct from due_date
       and (created_at at time zone public.app_tz())::date < today
    returning id, department_id, title, assignee_id, due_date
  )
  insert into public.notifications (user_id, department_id, app_key, ref_id, kind, message)
  select s.assignee_id, s.department_id, 'tasks', s.id, 'due_soon',
         format('Coming up: "%s" is due in %s day%s (%s)', s.title, s.due_date - today,
                case when s.due_date - today = 1 then '' else 's' end, public.fmt_date(s.due_date))
  from soon s
  join public.profiles p on p.id = s.assignee_id and p.active;

  -- not opened yet: whoever gave the task hears once, the first morning
  insert into public.notifications (user_id, department_id, app_key, ref_id, kind, message)
  select t.created_by, t.department_id, 'tasks', t.id, 'unseen',
         format('%s hasn''t opened "%s" yet', public.name_of(t.assignee_id), t.title)
  from public.tasks t
  join public.profiles p on p.id = t.created_by and p.active
  where t.status not in ('done', 'review') and t.acknowledged_at is null and t.ack_reminded_on is null
    and t.created_by is distinct from t.assignee_id
    and (t.created_at at time zone public.app_tz())::date < today;

  with unseen as (
    update public.tasks set ack_reminded_on = today
     where status not in ('done', 'review') and acknowledged_at is null
       and ack_reminded_on is distinct from today
       and (created_at at time zone public.app_tz())::date < today
    returning department_id, assignee_id, title
  ), grouped as (
    select department_id, assignee_id, count(*) as n, string_agg('"' || title || '"', ', ' order by title) as titles
    from unseen group by department_id, assignee_id
  )
  insert into public.notifications (user_id, department_id, app_key, kind, message)
  select g.assignee_id, g.department_id, 'tasks', 'unseen',
         case when g.n = 1 then format('New task you haven''t opened yet: %s — open it and press "Got it"', g.titles)
              else format('%s new tasks you haven''t opened yet: %s', g.n, left(g.titles, 220)) end
  from grouped g
  join public.profiles p on p.id = g.assignee_id and p.active;

  -- Mondays: tell each manager their weekly summary is ready
  if extract(isodow from today) = 1 then
    insert into public.notifications (user_id, department_id, app_key, kind, message)
    select p.id, p.department_id, 'tasks', 'weekly',
           format('Your weekly summary for %s – %s is ready', public.fmt_date(today - 7), public.fmt_date(today - 1))
    from public.profiles p
    where p.active and p.role = 'manager' and p.department_id is not null
      and public.user_has_app(p.id, 'tasks', p.department_id)
      and not exists (select 1 from public.notifications n
                      where n.user_id = p.id and n.kind = 'weekly'
                        and (n.created_at at time zone public.app_tz())::date = today);
  end if;

  perform set_config('app.system', 'off', true);
end $$;

-- ---------- Sign-off: send back with what needs fixing ---------------------
create or replace function public.tasks_send_back(p_task bigint, p_reason text) returns void
language plpgsql set search_path = public as $$
begin
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Please say what needs fixing.';
  end if;
  if not exists (select 1 from public.tasks t where t.id = p_task
                 and public.can_check_task(t.department_id, t.assignee_id, t.created_by)) then
    raise exception 'Only the person who gave this task (or a manager) can send it back.' using errcode = '42501';
  end if;
  perform set_config('app.sendback', left(trim(p_reason), 500), true);
  update public.tasks set status = 'doing' where id = p_task and status = 'review';
  if not found then
    raise exception 'This task isn''t waiting for sign-off any more.';
  end if;
  perform set_config('app.sendback', '', true);
end $$;

-- ---------- Search (Ctrl+K): only finds what the person can already see ------
create or replace function public.tasks_search(p_q text, p_dept uuid)
returns table (id bigint, title text, status text, due_date date, assignee_id uuid, found_in text, snippet text)
language sql stable set search_path = public as $$
  with q as (
    select '%' || replace(replace(replace(trim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select t.id, t.title, t.status, t.due_date, t.assignee_id,
         case when t.title ilike q.pat then 'title' when t.notes ilike q.pat then 'notes'
              when c.body is not null then 'comment' else 'step' end,
         case when t.title ilike q.pat then '' when t.notes ilike q.pat then t.notes
              else coalesce(c.body, s.body, '') end
  from public.tasks t
  cross join q
  left join lateral (select x.body from public.task_comments x
                      where x.task_id = t.id and x.body ilike q.pat order by x.id desc limit 1) c on true
  left join lateral (select x.body from public.task_checklist x
                      where x.task_id = t.id and x.body ilike q.pat order by x.position limit 1) s on true
  where t.department_id = p_dept and length(trim(coalesce(p_q, ''))) >= 2
    and (t.title ilike q.pat or t.notes ilike q.pat or c.body is not null or s.body is not null)
  order by (t.title ilike q.pat) desc, (t.status = 'done'), t.due_date desc
  limit 40
$$;

-- ---------- Performance trends: month by month, per person ----------------
--  due        deadlines that fell in the month (up to today)
--  on_time    … finished on or before the deadline (finished = sent for sign-off, or done)
--  late       … finished after the deadline;   open_late … still not finished
--  finished   tasks finished in the month (any deadline)
--  moved      deadline moves made in the month;  sent_back  times sent back in the month
--  assigned   tasks given to them by someone else;  ack_hours  average hours before they opened those
--             (tasks from before "Got it" existed count as seen when made, so they're left out of that average)
create or replace function public.tasks_trends(p_dept uuid, p_months int default 6)
returns table (month date, user_id uuid, due int, on_time int, late int, open_late int, finished int,
               moved int, sent_back int, assigned int, ack_hours numeric)
language sql stable set search_path = public as $$
  with today as (select public.app_today() as d),
  months as (
    select generate_series(date_trunc('month', (select d from today))
                             - make_interval(months => least(greatest(coalesce(p_months, 6), 1), 24) - 1),
                           date_trunc('month', (select d from today)), interval '1 month')::date as m
  ),
  t as materialized (
    select x.id, x.assignee_id, x.created_by, x.due_date, x.created_at, x.acknowledged_at,
           ((coalesce(x.submitted_at, x.completed_at)) at time zone public.app_tz())::date as fin_day,
           (x.created_at at time zone public.app_tz())::date as made_day
    from public.tasks x where x.department_id = p_dept
  ),
  a as materialized (
    select y.task_id, y.kind, (y.created_at at time zone public.app_tz())::date as day
    from public.task_activity y
    where y.department_id = p_dept and y.kind in ('due_date', 'sent_back')
      and y.created_at >= (select min(m) from months)
  ),
  by_due as (
    select date_trunc('month', due_date)::date as m, assignee_id as uid,
           count(*) filter (where due_date <= (select d from today)) as due,
           count(*) filter (where due_date <= (select d from today) and fin_day <= due_date) as on_time,
           count(*) filter (where due_date <= (select d from today) and fin_day > due_date) as late,
           count(*) filter (where due_date < (select d from today) and fin_day is null) as open_late
    from t group by 1, 2
  ),
  by_fin as (select date_trunc('month', fin_day)::date as m, assignee_id as uid, count(*) as finished
             from t where fin_day is not null group by 1, 2),
  by_new as (select date_trunc('month', made_day)::date as m, assignee_id as uid,
                    count(*) filter (where created_by is distinct from assignee_id) as assigned,
                    round(avg(extract(epoch from acknowledged_at - created_at) / 3600.0)
                          filter (where created_by is distinct from assignee_id and acknowledged_at > created_at)::numeric, 1) as ack_hours
             from t group by 1, 2),
  by_act as (select date_trunc('month', a.day)::date as m, t.assignee_id as uid,
                    count(*) filter (where a.kind = 'due_date') as moved,
                    count(*) filter (where a.kind = 'sent_back') as sent_back
             from a join t on t.id = a.task_id group by 1, 2),
  people as (select distinct assignee_id as uid from t)
  select mo.m, p.uid,
         coalesce(d.due, 0)::int, coalesce(d.on_time, 0)::int, coalesce(d.late, 0)::int, coalesce(d.open_late, 0)::int,
         coalesce(f.finished, 0)::int, coalesce(x.moved, 0)::int, coalesce(x.sent_back, 0)::int,
         coalesce(n.assigned, 0)::int, n.ack_hours
  from months mo cross join people p
  left join by_due d on d.m = mo.m and d.uid = p.uid
  left join by_fin f on f.m = mo.m and f.uid = p.uid
  left join by_new n on n.m = mo.m and n.uid = p.uid
  left join by_act x on x.m = mo.m and x.uid = p.uid
  order by mo.m, p.uid
$$;

-- ---------- Row level security ------------------------------------------
alter table public.tasks         enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_activity enable row level security;
alter table public.task_helpers     enable row level security;
alter table public.task_checklist   enable row level security;
alter table public.task_attachments enable row level security;
alter table public.time_blocks      enable row level security;

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (public.can_see_task(department_id, assignee_id, created_by) or public.is_task_helper(id));

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.can_assign_task(assignee_id, department_id));

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_see_task(department_id, assignee_id, created_by))
  with check (public.can_see_task(department_id, assignee_id, created_by));

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_admin()
         or (public.can_see_task(department_id, assignee_id, created_by)
             and (public.my_role() = 'manager' or created_by = auth.uid())));

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (author_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists task_activity_select on public.task_activity;
create policy task_activity_select on public.task_activity for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));

-- helpers: visible with the task; only managers / seniors add or remove them
drop policy if exists task_helpers_select on public.task_helpers;
create policy task_helpers_select on public.task_helpers for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
drop policy if exists task_helpers_insert on public.task_helpers;
create policy task_helpers_insert on public.task_helpers for insert to authenticated
  with check (public.can_manage_helper(task_id, user_id));
drop policy if exists task_helpers_delete on public.task_helpers;
create policy task_helpers_delete on public.task_helpers for delete to authenticated
  using (public.can_manage_helper(task_id, user_id));

-- checklist: anyone on the task (owner, leads, helpers) can add, tick, edit, remove steps
drop policy if exists task_checklist_rw on public.task_checklist;
create policy task_checklist_rw on public.task_checklist for all to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id))
  with check (exists (select 1 from public.tasks t where t.id = task_id));

-- files and links: anyone on the task adds; uploader or owner/leads remove
drop policy if exists task_attachments_select on public.task_attachments;
create policy task_attachments_select on public.task_attachments for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
drop policy if exists task_attachments_insert on public.task_attachments;
create policy task_attachments_insert on public.task_attachments for insert to authenticated
  with check (exists (select 1 from public.tasks t where t.id = task_id)
              and (kind = 'link' or path like 'tasks/' || task_id || '/%'));
drop policy if exists task_attachments_delete on public.task_attachments;
create policy task_attachments_delete on public.task_attachments for delete to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id)
         and (created_by = auth.uid() or public.can_run_task(task_id)));

-- time blocks: you plan your own day; managers see their department, seniors see members
drop policy if exists time_blocks_select on public.time_blocks;
create policy time_blocks_select on public.time_blocks for select to authenticated
  using (user_id = auth.uid()
         or public.is_admin()
         or (department_id = public.my_dept()
             and public.user_has_app(auth.uid(), 'tasks', department_id)
             and (public.my_role() = 'manager'
                  or (public.my_role() = 'senior' and public.role_of(user_id) = 'member'))));
drop policy if exists time_blocks_insert on public.time_blocks;
create policy time_blocks_insert on public.time_blocks for insert to authenticated
  with check (user_id = auth.uid()
              and department_id = public.my_dept()
              and public.user_has_app(auth.uid(), 'tasks', department_id)
              and (task_id is null or exists (select 1 from public.tasks t where t.id = task_id)));
drop policy if exists time_blocks_update on public.time_blocks;
create policy time_blocks_update on public.time_blocks for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
              and (task_id is null or exists (select 1 from public.tasks t where t.id = task_id)));
drop policy if exists time_blocks_delete on public.time_blocks;
create policy time_blocks_delete on public.time_blocks for delete to authenticated
  using (user_id = auth.uid());

-- ---------- File storage (private bucket, 10 MB per file) ----------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('workspace-files', 'workspace-files', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "tasks files: read" on storage.objects;
create policy "tasks files: read" on storage.objects for select to authenticated
  using (bucket_id = 'workspace-files' and public.tasks_file_ok(name));
drop policy if exists "tasks files: upload" on storage.objects;
create policy "tasks files: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'workspace-files' and public.tasks_file_ok(name));
drop policy if exists "tasks files: delete" on storage.objects;
create policy "tasks files: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'workspace-files' and public.tasks_file_ok(name));

-- ---------- Permissions -------------------------------------------------
revoke all on public.tasks, public.task_comments, public.task_activity, public.task_helpers,
              public.task_checklist, public.task_attachments, public.time_blocks
  from anon, authenticated;
grant select, insert, update, delete on public.tasks            to authenticated;
grant select, insert                 on public.task_comments    to authenticated;
grant select                         on public.task_activity    to authenticated;
grant select, insert, delete         on public.task_helpers     to authenticated;
grant select, insert, update, delete on public.task_checklist   to authenticated;
grant select, insert, delete         on public.task_attachments to authenticated;
grant select, insert, update, delete on public.time_blocks      to authenticated;
grant usage on all sequences in schema public to authenticated;

revoke execute on function public.tasks_before()        from public, anon, authenticated;
revoke execute on function public.tasks_after()         from public, anon, authenticated;
revoke execute on function public.tasks_deleted()       from public, anon, authenticated;
revoke execute on function public.task_comments_after() from public, anon, authenticated;
revoke execute on function public.task_children_before()  from public, anon, authenticated;
revoke execute on function public.task_helpers_rules()    from public, anon, authenticated;
revoke execute on function public.task_helpers_after()    from public, anon, authenticated;
revoke execute on function public.tasks_owner_not_helper() from public, anon, authenticated;
revoke execute on function public.task_checklist_rules()  from public, anon, authenticated;
revoke execute on function public.task_checklist_after()  from public, anon, authenticated;
revoke execute on function public.task_attachments_rules() from public, anon, authenticated;
revoke execute on function public.time_blocks_before()    from public, anon, authenticated;
revoke execute on function public.run_deadline_check()  from public, anon;
grant  execute on function public.run_deadline_check()  to authenticated;
revoke execute on function public.tasks_send_back(bigint, text) from public, anon;
grant  execute on function public.tasks_send_back(bigint, text) to authenticated;
revoke execute on function public.tasks_search(text, uuid)      from public, anon;
grant  execute on function public.tasks_search(text, uuid)      to authenticated;
revoke execute on function public.tasks_trends(uuid, int)       from public, anon;
grant  execute on function public.tasks_trends(uuid, int)       to authenticated;


-- ---------- Notes: search ----------
-- >>> notes_search
-- ---------- Search (Ctrl+K): titles and page text, only pages the person can open ----
create or replace function public.notes_search(p_q text, p_dept uuid)
returns table (id bigint, title text, parent_id bigint, found_in text, snippet text)
language sql stable set search_path = public as $$
  with q as (
    select '%' || replace(replace(replace(trim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select p.id, p.title, p.parent_id,
         case when p.title ilike q.pat then 'title' else 'text' end,
         case when p.title ilike q.pat then '' else b.body end
  from public.notes_pages p
  cross join q
  cross join lateral (select coalesce(string_agg(x #>> '{}', ' '), '') as body
                        from jsonb_path_query(p.content, 'strict $.**.text') x) b
  where p.department_id = p_dept and length(trim(coalesce(p_q, ''))) >= 2
    and (p.title ilike q.pat or b.body ilike q.pat)
  order by (p.title ilike q.pat) desc, p.updated_at desc
  limit 30
$$;
revoke execute on function public.notes_search(text, uuid) from public, anon;
grant  execute on function public.notes_search(text, uuid) to authenticated;
-- <<< notes_search

-- =====================================================================
--  WORKSPACE — "Month-end declaration" department feature (step 6 of 8)
--  Run after 02_app_tasks.sql. Safe to run again.
--
--  A monthly self-declaration checklist. A master list of lines (MEC =
--  month-end confirmation, CMP = compliance, or any category) is copied
--  into each month. Each line's owner ticks it and adds remarks by its due
--  date (default: the 15th of the following month). When every line is
--  ticked, a senior executive reviews and the manager approves; the month
--  is then locked.
--
--  OFF for every department until the admin ticks it in
--  Admin console → Departments & apps. Departments without it can't see
--  it in the app and can't read or write it through the database.
-- =====================================================================

-- ---------- Tables -----------------------------------------------------
create table if not exists public.month_end_items (           -- the master list
  id             bigint generated always as identity primary key,
  department_id  uuid not null references public.departments(id) on delete cascade,
  code           text not null default '',
  category       text not null default 'MEC',
  title          text not null check (length(trim(title)) > 0),
  owner_id       uuid references public.profiles(id) on delete set null,
  due_day        int not null default 15 check (due_day between 1 and 31),  -- day of the following month
  position       double precision not null default 0,
  active         boolean not null default true,
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create table if not exists public.month_end_periods (         -- one per department per month
  id             bigint generated always as identity primary key,
  department_id  uuid not null references public.departments(id) on delete cascade,
  period         date not null check (extract(day from period) = 1),   -- the month being closed
  status         text not null default 'open' check (status in ('open', 'reviewed', 'approved')),
  reviewed_by    uuid references public.profiles(id) on delete set null,
  reviewed_at    timestamptz,
  approved_by    uuid references public.profiles(id) on delete set null,
  approved_at    timestamptz,
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (department_id, period)
);

create table if not exists public.month_end_entries (         -- that month's copy of each line
  id                bigint generated always as identity primary key,
  period_id         bigint not null references public.month_end_periods(id) on delete cascade,
  department_id     uuid not null references public.departments(id) on delete cascade,
  item_id           bigint references public.month_end_items(id) on delete set null,
  code              text not null default '',
  category          text not null default 'MEC',
  title             text not null check (length(trim(title)) > 0),
  owner_id          uuid references public.profiles(id) on delete set null,
  due_date          date not null,
  position          double precision not null default 0,
  done              boolean not null default false,
  done_by           uuid references public.profiles(id) on delete set null,
  done_at           timestamptz,
  remarks           text not null default '',
  reminded_on       date,      -- internal: due-today reminder sent
  overdue_notified  boolean not null default false,
  updated_at        timestamptz not null default now()
);

create index if not exists month_end_items_dept_idx     on public.month_end_items (department_id, position);
create index if not exists month_end_periods_dept_idx   on public.month_end_periods (department_id, period);
create index if not exists month_end_entries_period_idx on public.month_end_entries (period_id, position);
create index if not exists month_end_entries_owner_idx  on public.month_end_entries (owner_id);

-- ---------- Who can do what ----------------------------------------------
-- see: admin, or the department's people when the feature is on
create or replace function public.month_end_on(p_dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (p_dept = public.my_dept() and public.has_feature(p_dept, 'month_end'));
$$;

-- manage the list, start a month, edit lines: admin, or the department's seniors and managers
create or replace function public.month_end_lead(p_dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (p_dept = public.my_dept() and public.has_feature(p_dept, 'month_end')
          and public.my_role() in ('manager', 'senior'));
$$;

-- ---------- Rules before saving ----------------------------------------
create or replace function public.month_end_items_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.department_id := case when public.is_admin() and new.department_id is not null
                              then new.department_id else public.dept_of(auth.uid()) end;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.department_id := old.department_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.owner_id is not null and public.dept_of(new.owner_id) is distinct from new.department_id then
    raise exception 'The owner must be someone in this department.';
  end if;
  return new;
end $$;

drop trigger if exists month_end_items_before on public.month_end_items;
create trigger month_end_items_before before insert or update on public.month_end_items
  for each row execute function public.month_end_items_before();

create or replace function public.month_end_periods_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  in_dept boolean;
  lead    boolean;
  mgr     boolean;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'open';
    new.reviewed_by := null; new.reviewed_at := null;
    new.approved_by := null; new.approved_at := null;
    new.created_at := now();
    return new;
  end if;

  new.department_id := old.department_id;
  new.period := old.period;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  in_dept := old.department_id = public.my_dept();
  lead := in_dept and public.my_role() in ('manager', 'senior');
  mgr  := in_dept and public.my_role() = 'manager';

  if new.status is not distinct from old.status then
    new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  elsif old.status = 'open' and new.status = 'reviewed' then
    if not lead then
      raise exception 'Only a senior executive or the manager can review the declaration.';
    end if;
    if exists (select 1 from public.month_end_entries where period_id = old.id and not done) then
      raise exception 'Some lines are not ticked yet.';
    end if;
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
    new.approved_by := null; new.approved_at := null;
  elsif old.status = 'reviewed' and new.status = 'approved' then
    if not mgr then
      raise exception 'Only the manager can approve the declaration.';
    end if;
    new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
    new.approved_by := auth.uid(); new.approved_at := now();
  elsif new.status = 'open' and ((old.status = 'reviewed' and lead) or (old.status = 'approved' and mgr)) then
    new.reviewed_by := null; new.reviewed_at := null;     -- sent back / reopened
    new.approved_by := null; new.approved_at := null;
  else
    raise exception 'You can''t make that change to the declaration.';
  end if;
  return new;
end $$;

drop trigger if exists month_end_periods_before on public.month_end_periods;
create trigger month_end_periods_before before insert or update on public.month_end_periods
  for each row execute function public.month_end_periods_before();

create or replace function public.month_end_entries_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text; d uuid;
begin
  if current_setting('app.system', true) = 'on' or pg_trigger_depth() > 1 then
    return new;   -- the daily reminder bookkeeping
  end if;
  if tg_op = 'INSERT' then
    select department_id, status into d, st from public.month_end_periods where id = new.period_id;
    if st is distinct from 'open' then
      raise exception 'This month is signed off. Reopen it to make changes.';
    end if;
    new.department_id := d;
    new.done := false; new.done_by := null; new.done_at := null;
    new.reminded_on := null; new.overdue_notified := false;
  else
    select status into st from public.month_end_periods where id = old.period_id;
    if st is distinct from 'open' then
      raise exception 'This month is signed off. Reopen it to make changes.';
    end if;
    new.period_id := old.period_id;
    new.department_id := old.department_id;
    new.item_id := old.item_id;
    new.reminded_on := old.reminded_on;
    new.overdue_notified := old.overdue_notified;
    if not public.month_end_lead(old.department_id) then    -- owners: only their tick and remarks
      new.code := old.code; new.category := old.category; new.title := old.title;
      new.owner_id := old.owner_id; new.due_date := old.due_date; new.position := old.position;
    end if;
    if new.done is distinct from old.done then
      if old.owner_id is distinct from auth.uid() then          -- a self-declaration
        raise exception 'Only % can tick this line.', coalesce(public.name_of(old.owner_id), 'its owner');
      end if;
      new.done_by := case when new.done then auth.uid() end;
      new.done_at := case when new.done then now() end;
    else
      new.done_by := old.done_by;
      new.done_at := old.done_at;
    end if;
    if new.due_date is distinct from old.due_date then new.overdue_notified := false; end if;
  end if;
  if new.owner_id is not null and public.dept_of(new.owner_id) is distinct from new.department_id then
    raise exception 'The owner must be someone in this department.';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists month_end_entries_before on public.month_end_entries;
create trigger month_end_entries_before before insert or update on public.month_end_entries
  for each row execute function public.month_end_entries_before();

-- ---------- Alerts -------------------------------------------------------
create or replace function public.month_end_label(p date) returns text
language sql stable as $$ select trim(to_char(p, 'FMMonth YYYY')) $$;

-- every line ticked → the department's seniors and managers can review
create or replace function public.month_end_entries_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.month_end_periods;
begin
  if current_setting('app.system', true) = 'on' then
    return null;
  end if;
  if new.done and not old.done
     and not exists (select 1 from public.month_end_entries where period_id = new.period_id and not done) then
    select * into p from public.month_end_periods where id = new.period_id;
    perform public.notify(
      array(select id from public.profiles
            where department_id = new.department_id and active and role in ('manager', 'senior')),
      new.department_id, 'tasks', null, 'month_end',
      format('%s month-end declaration: every line is ticked, ready for review', public.month_end_label(p.period)),
      auth.uid());
  end if;
  return null;
end $$;

drop trigger if exists month_end_entries_after on public.month_end_entries;
create trigger month_end_entries_after after update on public.month_end_entries
  for each row execute function public.month_end_entries_after();

create or replace function public.month_end_periods_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text := public.name_of(auth.uid()); m text := public.month_end_label(new.period);
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  if new.status = 'reviewed' then
    perform public.notify(
      array(select id from public.profiles where department_id = new.department_id and active and role = 'manager'),
      new.department_id, 'tasks', null, 'month_end',
      format('%s reviewed the %s month-end declaration, ready for your approval', who, m), auth.uid());
  elsif new.status = 'approved' then
    perform public.notify(
      array(select distinct owner_id from public.month_end_entries where period_id = new.id and owner_id is not null)
        || array(select id from public.profiles where department_id = new.department_id and active and role = 'senior'),
      new.department_id, 'tasks', null, 'month_end',
      format('%s approved the %s month-end declaration', who, m), auth.uid());
  else
    perform public.notify(
      array(select id from public.profiles
            where department_id = new.department_id and active and role in ('manager', 'senior')),
      new.department_id, 'tasks', null, 'month_end',
      format('%s reopened the %s month-end declaration', who, m), auth.uid());
  end if;
  return null;
end $$;

drop trigger if exists month_end_periods_after on public.month_end_periods;
create trigger month_end_periods_after after update on public.month_end_periods
  for each row execute function public.month_end_periods_after();

-- ---------- Start a month: copy the master list -------------------------
create or replace function public.month_end_start(p_dept uuid, p_period date) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  p   date := date_trunc('month', p_period)::date;
  pid bigint;
begin
  if not public.has_feature(p_dept, 'month_end') or not public.month_end_lead(p_dept) then
    raise exception 'Only a senior executive or the manager can start a month.' using errcode = '42501';
  end if;
  select id into pid from public.month_end_periods where department_id = p_dept and period = p;
  if pid is not null then
    return pid;
  end if;
  insert into public.month_end_periods (department_id, period, created_by)
  values (p_dept, p, auth.uid()) returning id into pid;
  insert into public.month_end_entries (period_id, department_id, item_id, code, category, title, owner_id, due_date, position)
  select pid, p_dept, i.id, i.code, i.category, i.title, i.owner_id,
         least((p + interval '1 month')::date + (i.due_day - 1), (p + interval '2 months')::date - 1),
         i.position
  from public.month_end_items i
  where i.department_id = p_dept and i.active
  order by i.position, i.id;
  return pid;
end $$;

-- ---------- Daily reminders (07:05 Colombo, and whenever the page opens) ----
create or replace function public.month_end_check() returns void
language plpgsql security definer set search_path = public as $$
declare today date := public.app_today();
begin
  perform set_config('app.system', 'on', true);

  -- due today → the owner, once
  with due as (
    update public.month_end_entries e set reminded_on = today
      from public.month_end_periods p
     where p.id = e.period_id and p.status = 'open' and not e.done
       and e.due_date = today and e.reminded_on is distinct from today and e.owner_id is not null
    returning e.department_id, e.owner_id, p.period
  ), grouped as (
    select department_id, owner_id, period, count(*) as n from due group by 1, 2, 3
  )
  insert into public.notifications (user_id, department_id, app_key, kind, message)
  select g.owner_id, g.department_id, 'tasks', 'month_end',
         format('%s month-end declaration: %s line%s due today', public.month_end_label(g.period),
                g.n, case when g.n = 1 then '' else 's' end)
  from grouped g join public.profiles pr on pr.id = g.owner_id and pr.active;

  -- overdue → the owner and the department's seniors and managers, once per line
  with late as (
    update public.month_end_entries e set overdue_notified = true
      from public.month_end_periods p
     where p.id = e.period_id and p.status = 'open' and not e.done
       and e.due_date < today and not e.overdue_notified
    returning e.department_id, e.owner_id, e.title, e.due_date, p.period
  ), recipients as (
    select distinct l.*, r.uid
    from late l
    cross join lateral unnest(
      array[l.owner_id] || array(select id from public.profiles
                                 where department_id = l.department_id and active and role in ('manager', 'senior'))
    ) as r(uid)
    where r.uid is not null
  )
  insert into public.notifications (user_id, department_id, app_key, kind, message)
  select r.uid, r.department_id, 'tasks', 'month_end',
         case when r.uid = r.owner_id
              then format('Month-end declaration overdue: "%s" was due %s', r.title, public.fmt_date(r.due_date))
              else format('Month-end declaration overdue: %s — "%s" was due %s',
                          coalesce(public.name_of(r.owner_id), 'no owner'), r.title, public.fmt_date(r.due_date)) end
  from recipients r join public.profiles pr on pr.id = r.uid and pr.active;

  perform set_config('app.system', 'off', true);
end $$;

-- ---------- Row level security ------------------------------------------
alter table public.month_end_items   enable row level security;
alter table public.month_end_periods enable row level security;
alter table public.month_end_entries enable row level security;

drop policy if exists month_end_items_select on public.month_end_items;
create policy month_end_items_select on public.month_end_items for select to authenticated
  using (public.month_end_on(department_id));
drop policy if exists month_end_items_write on public.month_end_items;
create policy month_end_items_write on public.month_end_items for all to authenticated
  using (public.month_end_lead(department_id))
  with check (public.month_end_lead(department_id));

drop policy if exists month_end_periods_select on public.month_end_periods;
create policy month_end_periods_select on public.month_end_periods for select to authenticated
  using (public.month_end_on(department_id));
-- new months only through month_end_start(); status steps are checked by the trigger
drop policy if exists month_end_periods_update on public.month_end_periods;
create policy month_end_periods_update on public.month_end_periods for update to authenticated
  using (public.month_end_lead(department_id))
  with check (public.month_end_lead(department_id));
drop policy if exists month_end_periods_delete on public.month_end_periods;
create policy month_end_periods_delete on public.month_end_periods for delete to authenticated
  using (status = 'open'
         and (public.is_admin()
              or (department_id = public.my_dept() and public.has_feature(department_id, 'month_end')
                  and public.my_role() = 'manager')));

drop policy if exists month_end_entries_select on public.month_end_entries;
create policy month_end_entries_select on public.month_end_entries for select to authenticated
  using (public.month_end_on(department_id));
drop policy if exists month_end_entries_insert on public.month_end_entries;
create policy month_end_entries_insert on public.month_end_entries for insert to authenticated
  with check (public.month_end_lead(department_id));
drop policy if exists month_end_entries_update on public.month_end_entries;
create policy month_end_entries_update on public.month_end_entries for update to authenticated
  using (public.month_end_on(department_id) and (owner_id = auth.uid() or public.month_end_lead(department_id)))
  with check (public.month_end_on(department_id));
drop policy if exists month_end_entries_delete on public.month_end_entries;
create policy month_end_entries_delete on public.month_end_entries for delete to authenticated
  using (public.month_end_lead(department_id)
         and exists (select 1 from public.month_end_periods p where p.id = period_id and p.status = 'open'));

-- ---------- Permissions -------------------------------------------------
revoke all on public.month_end_items, public.month_end_periods, public.month_end_entries from anon, authenticated;
grant select, insert, update, delete on public.month_end_items   to authenticated;
grant select, update, delete         on public.month_end_periods to authenticated;
grant select, insert, update, delete on public.month_end_entries to authenticated;
grant usage on all sequences in schema public to authenticated;

revoke execute on function public.month_end_items_before()   from public, anon, authenticated;
revoke execute on function public.month_end_periods_before() from public, anon, authenticated;
revoke execute on function public.month_end_entries_before() from public, anon, authenticated;
revoke execute on function public.month_end_entries_after()  from public, anon, authenticated;
revoke execute on function public.month_end_periods_after()  from public, anon, authenticated;
revoke execute on function public.month_end_start(uuid, date) from public, anon;
grant  execute on function public.month_end_start(uuid, date) to authenticated;
revoke execute on function public.month_end_check() from public, anon;
grant  execute on function public.month_end_check() to authenticated;

-- ---------- Daily reminder job (only if Cron is switched on) -------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('workspace-month-end-check', '35 1 * * *', 'select public.month_end_check();');
  end if;
end $$;


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


-- =====================================================================
--  WORKSPACE — "Compliance calendar" department feature (step 8 of 8)
--  Run after 02_app_tasks.sql. Safe to run again.
--
--  The department's recurring obligations (tax returns, statutory payments,
--  renewals …) in one place. Each obligation is a repeating task: it has an
--  owner, a deadline, an early reminder ("N days before") and, when it is
--  finished, the next one is created on schedule. This page shows what's
--  next, who owns it, how many days are left, and whether past ones were
--  finished on time.
--
--  OFF for every department until the admin ticks it in
--  Admin console → Departments & apps.
-- =====================================================================

-- this name must be ours (the project also holds an older app's tables)
do $$
begin
  if to_regclass('public.compliance_items') is not null
     and not exists (select 1 from information_schema.columns where table_schema = 'public'
                     and table_name = 'compliance_items' and column_name = 'series_id') then
    raise exception 'A table called compliance_items already exists and was not made by Workspace. Nothing was changed — send this message to whoever looks after Workspace.';
  end if;
end $$;

create table if not exists public.compliance_items (
  id             bigint generated always as identity primary key,
  department_id  uuid not null references public.departments(id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  authority      text not null default '',     -- who it's for: IRD, EPF, Registrar of Companies …
  notes          text not null default '',
  series_id      bigint references public.tasks(id) on delete set null,   -- the repeating task behind it
  active         boolean not null default true,
  position       double precision not null default 0,
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists compliance_items_dept_idx on public.compliance_items (department_id, position);

-- ---------- Who can do what ----------------------------------------------
create or replace function public.compliance_on(p_dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (p_dept = public.my_dept() and public.has_feature(p_dept, 'compliance')
          and public.user_has_app(auth.uid(), 'tasks', p_dept));
$$;

-- add, change and remove obligations: admin, or the department's managers and senior executives
create or replace function public.compliance_lead(p_dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.compliance_on(p_dept) and public.my_role() in ('manager', 'senior'));
$$;

create or replace function public.compliance_items_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.department_id := case when public.is_admin() and new.department_id is not null
                              then new.department_id else public.dept_of(auth.uid()) end;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.department_id := old.department_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.series_id is not null
     and (select department_id from public.tasks where id = new.series_id) is distinct from new.department_id then
    raise exception 'That task belongs to another department.';
  end if;
  return new;
end $$;

drop trigger if exists compliance_items_before on public.compliance_items;
create trigger compliance_items_before before insert or update on public.compliance_items
  for each row execute function public.compliance_items_before();

-- Add an obligation in one step: its first (repeating) task and the calendar entry together.
-- Runs with the caller's own rights, so the usual rules decide who may give the task to whom.
create or replace function public.compliance_add(p_dept uuid, p_name text, p_authority text, p_notes text,
                                                 p_owner uuid, p_due date, p_repeat text, p_remind_days int)
returns bigint language plpgsql set search_path = public as $$
declare
  tid bigint;
  cid bigint;
begin
  if not public.compliance_lead(p_dept) then
    raise exception 'Only managers and senior executives can add obligations.' using errcode = '42501';
  end if;
  if p_repeat is null then
    raise exception 'Choose how often it repeats.';
  end if;
  insert into public.tasks (title, notes, assignee_id, due_date, repeat, remind_days, priority)
  values (trim(p_name), coalesce(p_notes, ''), p_owner, p_due, p_repeat, p_remind_days, 'high')
  returning id into tid;
  if (select department_id from public.tasks where id = tid) is distinct from p_dept then
    raise exception 'The owner must be someone in this department.';
  end if;
  insert into public.compliance_items (department_id, name, authority, notes, series_id, position)
  values (p_dept, trim(p_name), coalesce(trim(p_authority), ''), coalesce(p_notes, ''), tid,
          coalesce((select max(position) from public.compliance_items where department_id = p_dept), 0) + 1)
  returning id into cid;
  return cid;
end $$;

-- ---------- Row level security ------------------------------------------
alter table public.compliance_items enable row level security;

drop policy if exists compliance_items_select on public.compliance_items;
create policy compliance_items_select on public.compliance_items for select to authenticated
  using (public.compliance_on(department_id));
drop policy if exists compliance_items_insert on public.compliance_items;
create policy compliance_items_insert on public.compliance_items for insert to authenticated
  with check (public.compliance_lead(department_id));
drop policy if exists compliance_items_update on public.compliance_items;
create policy compliance_items_update on public.compliance_items for update to authenticated
  using (public.compliance_lead(department_id)) with check (public.compliance_lead(department_id));
drop policy if exists compliance_items_delete on public.compliance_items;
create policy compliance_items_delete on public.compliance_items for delete to authenticated
  using (public.compliance_lead(department_id));

revoke all on public.compliance_items from anon, authenticated;
grant select, insert, update, delete on public.compliance_items to authenticated;
grant usage on all sequences in schema public to authenticated;

revoke execute on function public.compliance_items_before() from public, anon, authenticated;
revoke execute on function public.compliance_add(uuid, text, text, text, uuid, date, text, int) from public, anon;
grant  execute on function public.compliance_add(uuid, text, text, text, uuid, date, text, int) to authenticated;
