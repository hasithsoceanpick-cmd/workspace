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
-- daily repeats (added Oct 2026): every day, or Monday to Friday
alter table public.tasks drop constraint if exists tasks_repeat_check;
alter table public.tasks add constraint tasks_repeat_check
  check (repeat in ('daily', 'weekdays', 'weekly', 'monthly', 'quarterly', 'yearly'));

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

-- daily updates (added Oct 2026): the owner writes a short update every weekday while the task is open
alter table public.tasks add column if not exists daily_update      boolean not null default false;
alter table public.tasks add column if not exists daily_update_from date;   -- internal: first weekday an update is needed
alter table public.task_comments add column if not exists daily_for date;   -- set on a "Daily update": the weekday it's for
create index if not exists task_comments_daily_idx on public.task_comments (task_id, daily_for) where daily_for is not null;
create index if not exists tasks_daily_update_idx  on public.tasks (assignee_id) where daily_update;

-- people outside the app (added Oct 2026): someone without a login a task is given to — a bank officer, a supplier,
-- a colleague elsewhere. The task's owner (an app user) follows up; the task keeps the record.
create table if not exists public.task_contacts (
  id             bigint generated always as identity primary key,
  department_id  uuid not null references public.departments(id) on delete cascade,
  name           text not null check (length(trim(name)) between 1 and 120),
  organisation   text not null default '' check (length(organisation) <= 120),
  phone          text not null default '' check (length(phone) <= 40),
  email          text not null default '' check (length(email) <= 200),
  note           text not null default '' check (length(note) <= 500),
  active         boolean not null default true,     -- off = removed from the list (their tasks keep the name)
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists task_contacts_dept_idx on public.task_contacts (department_id, name);
alter table public.tasks add column if not exists contact_id bigint references public.task_contacts(id) on delete restrict;
create index if not exists tasks_contact_idx on public.tasks (contact_id) where contact_id is not null;

-- projects (added Oct 2026): one big task with dated stages; each stage can have its own person.
-- Stages are checklist steps with a date (and optionally a person). The owner keeps a status flag with a note.
alter table public.tasks add column if not exists nature text not null default 'task';
alter table public.tasks drop constraint if exists tasks_nature_check;
alter table public.tasks add constraint tasks_nature_check check (nature in ('task', 'project'));
alter table public.tasks add column if not exists health      text;              -- project status flag
alter table public.tasks drop constraint if exists tasks_health_check;
alter table public.tasks add constraint tasks_health_check check (health in ('on_track', 'at_risk', 'off_track'));
alter table public.tasks add column if not exists health_note text not null default '';
alter table public.tasks add column if not exists health_at   timestamptz;
alter table public.tasks add column if not exists health_by   uuid references public.profiles(id) on delete set null;
alter table public.task_checklist add column if not exists due_date date;           -- a project stage's date
alter table public.task_checklist add column if not exists assignee_id uuid references public.profiles(id) on delete set null;  -- stage person (empty = the project owner)
alter table public.task_checklist add column if not exists overdue_notified_on date; -- internal: missed-stage alert sent
create index if not exists task_checklist_assignee_idx on public.task_checklist (assignee_id) where assignee_id is not null;
create index if not exists tasks_nature_idx on public.tasks (department_id) where nature = 'project';

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

-- escalation: still open 3 days after the deadline → the department's managers are told (once per deadline).
-- Added once; work that was already that late when this arrived is flagged quietly (no flood of alerts).
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'tasks' and column_name = 'escalated_at') then
    alter table public.tasks add column escalated_at timestamptz;
    perform set_config('app.system', 'on', true);
    update public.tasks set escalated_at = now()
     where status not in ('done', 'review') and due_date <= public.app_today() - 3;
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

-- Could this person see this task? (the same rule as can_see_task, for someone other than me)
create or replace function public.task_visible_to(p_user uuid, p_dept uuid, p_assignee uuid, p_creator uuid, p_task bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_admin_user(p_user)
    or (public.user_has_app(p_user, 'tasks', p_dept)
        and (case public.role_of(p_user)
               when 'manager' then true
               when 'senior'  then p_assignee = p_user or p_creator = p_user or public.role_of(p_assignee) = 'member'
               when 'member'  then p_assignee = p_user or p_creator = p_user
               else false
             end
             or exists (select 1 from public.task_helpers h where h.task_id = p_task and h.user_id = p_user))), false)
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

-- ---------- Repeating tasks: when the next one is due ---------------------
-- The day an occurrence was scheduled for (moving its deadline doesn't move the schedule).
create or replace function public.task_repeat_sched(t public.tasks) returns date
language sql stable set search_path = public as $$
  select case when t.repeat_n = 0 then coalesce(t.repeat_anchor, t.original_due, t.due_date)
              else coalesce(t.original_due, t.due_date) end
$$;

-- The first day on or after p_day that a daily repeat runs on ("weekdays" skips Saturday and Sunday).
create or replace function public.task_repeat_day(p_day date, p_repeat text) returns date
language sql immutable as $$
  select case when p_repeat = 'weekdays' and extract(isodow from p_day) = 6 then p_day + 2
              when p_repeat = 'weekdays' and extract(isodow from p_day) = 7 then p_day + 1
              else p_day end
$$;

-- The deadline of the occurrence after t.
--   daily / weekdays: the next working day after this one's, never in the past
--                     (finishing late doesn't bring back days that were skipped)
--   weekly … yearly:  the series' first deadline + n steps, so it never drifts
create or replace function public.task_repeat_next_due(t public.tasks) returns date
language sql stable set search_path = public as $$
  select case
    when t.repeat in ('daily', 'weekdays') then
      greatest(public.task_repeat_day(public.task_repeat_sched(t) + 1, t.repeat),
               public.task_repeat_day(public.app_today(), t.repeat))
    else (coalesce(t.repeat_anchor, t.due_date)
          + case t.repeat when 'weekly' then interval '7 days' when 'monthly' then interval '1 month'
                          when 'quarterly' then interval '3 months' else interval '1 year' end
            * (t.repeat_n + 1))::date
  end
$$;

-- ---------- Daily updates: which weekday, and is one needed -----------------
-- The last weekday (Mon–Fri) before p_day: Monday, Saturday and Sunday → Friday.
create or replace function public.task_prev_workday(p_day date) returns date
language sql immutable as $$
  select case extract(isodow from p_day)::int when 1 then p_day - 3 when 7 then p_day - 2 else p_day - 1 end
$$;

-- Does task t need its owner's daily update for p_day? (Whether one was written is checked by the caller.)
-- Weekdays only, from the first weekday after it was switched on, until the day the owner finishes it.
create or replace function public.task_update_required(t public.tasks, p_day date) returns boolean
language sql stable set search_path = public as $$
  select t.daily_update and t.daily_update_from is not null and t.daily_update_from <= p_day
     and extract(isodow from p_day) < 6
     and (t.status not in ('review', 'done')
          or (coalesce(t.submitted_at, t.completed_at, now()) at time zone public.app_tz())::date > p_day)
$$;

-- Make the next occurrence of repeating task p_id, due p_due, with the same steps and helpers.
-- Once per occurrence (does nothing if the next one already exists). No alerts: it's a routine they know.
create or replace function public.task_repeat_spawn(p_id bigint, p_due date, p_actor uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  t   public.tasks;
  nid bigint;
  was text := coalesce(nullif(current_setting('app.system', true), ''), 'off');
begin
  select * into t from public.tasks where id = p_id for update;
  if not found or t.repeat is null or t.next_task_id is not null then
    return null;
  end if;
  perform set_config('app.system', 'on', true);
  insert into public.tasks (department_id, title, notes, assignee_id, created_by, status, priority, due_date,
                            original_due, due_moves, repeat, repeat_anchor, repeat_n, created_at, updated_at,
                            needs_check, remind_days, series_id, acknowledged_at, daily_update, daily_update_from, contact_id)
  values (t.department_id, t.title, t.notes, t.assignee_id, t.created_by, 'todo', t.priority, p_due,
          p_due, 0, t.repeat, coalesce(t.repeat_anchor, t.due_date), t.repeat_n + 1, now(), now(),
          t.needs_check, t.remind_days, coalesce(t.series_id, t.id), now(),   -- no "Got it" needed
          t.daily_update, case when t.daily_update then public.task_repeat_day(public.app_today() + 1, 'weekdays') end,
          t.contact_id)
  returning id into nid;
  insert into public.task_checklist (task_id, department_id, body, position, created_by)
  select nid, t.department_id, c.body, c.position, c.created_by from public.task_checklist c where c.task_id = t.id;
  insert into public.task_helpers (task_id, user_id, department_id, added_by)
  select nid, h.user_id, t.department_id, h.added_by from public.task_helpers h where h.task_id = t.id;
  update public.tasks set next_task_id = nid where id = t.id;
  insert into public.task_activity (task_id, department_id, actor_id, kind, old_value, new_value)
  values (nid, t.department_id, p_actor, 'repeated', t.id::text, t.repeat);
  perform set_config('app.system', was, true);
  return nid;
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
    if new.nature = 'project' then new.repeat := null; end if;   -- projects don't repeat
    new.health_at := case when new.health is not null then now() end;
    new.health_by := case when new.health is not null then auth.uid() end;
    if new.contact_id is not null and not exists (select 1 from public.task_contacts c
                                                  where c.id = new.contact_id and c.department_id = new.department_id) then
      raise exception 'That person isn''t on this department''s list.';
    end if;
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
    new.escalated_at := null;
    -- daily updates start on the first weekday after today
    new.daily_update_from := case when new.daily_update then public.task_repeat_day(public.app_today() + 1, 'weekdays') end;
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
  -- a new deadline is a fresh start for escalation
  new.escalated_at := case when new.due_date is distinct from old.due_date then null else old.escalated_at end;
  new.due_moves := old.due_moves + case when new.due_date is distinct from old.due_date then 1 else 0 end;
  if new.nature = 'project' then new.repeat := null; end if;   -- projects don't repeat
  -- project status flag: the owner, whoever gave it, or a manager
  if row(new.health, new.health_note) is distinct from row(old.health, old.health_note) then
    if auth.uid() is not null and auth.uid() is distinct from old.assignee_id and auth.uid() is distinct from old.created_by
       and not public.can_check_task(old.department_id, old.assignee_id, old.created_by) then
      raise exception 'Only the owner (or whoever gave it, or a manager) sets the project status.' using errcode = '42501';
    end if;
    new.health_note := left(trim(new.health_note), 300);
    new.health_at := now();
    new.health_by := auth.uid();
  else
    new.health_at := old.health_at;
    new.health_by := old.health_by;
  end if;
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

  -- the outside person must be on this department's list
  if new.contact_id is distinct from old.contact_id and new.contact_id is not null
     and not exists (select 1 from public.task_contacts c where c.id = new.contact_id and c.department_id = old.department_id) then
    raise exception 'That person isn''t on this department''s list.';
  end if;

  -- daily updates: switched on/off by whoever gave the task or a manager (the owner only on a task they made themselves);
  -- a new owner, or switching it on, starts fresh from the next weekday
  if new.daily_update is distinct from old.daily_update
     and auth.uid() is not null and auth.uid() is distinct from old.created_by
     and not public.can_check_task(old.department_id, old.assignee_id, old.created_by) then
    raise exception 'Only the person who gave this task (or a manager) can change whether it needs daily updates.' using errcode = '42501';
  end if;
  if not new.daily_update then
    new.daily_update_from := null;
  elsif not old.daily_update or new.assignee_id is distinct from old.assignee_id then
    new.daily_update_from := public.task_repeat_day(public.app_today() + 1, 'weekdays');
  else
    new.daily_update_from := old.daily_update_from;
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

  if row(new.title, new.notes, new.assignee_id, new.status, new.priority, new.due_date, new.repeat, new.needs_check, new.remind_days, new.daily_update, new.contact_id)
     is distinct from
     row(old.title, old.notes, old.assignee_id, old.status, old.priority, old.due_date, old.repeat, old.needs_check, old.remind_days, old.daily_update, old.contact_id) then
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
      perform public.notify(array[new.assignee_id] || public.helper_ids(new.id) || public.task_follower_ids(new.id), d, 'tasks', new.id, 'sent_back',
        format('%s sent back "%s"%s', who, new.title, coalesce(': ' || reason, '')), actor);
    else
      insert into public.task_activity (task_id, department_id, actor_id, kind, old_value, new_value)
      values (new.id, d, actor, 'status', old.status, new.status);
      if new.status = 'review' then
        perform public.notify(public.task_checker_ids(d, new.created_by), d, 'tasks', new.id, 'review',
          format('%s finished "%s" — please check it and sign it off', who, new.title), actor);
      elsif new.status = 'done' and old.status = 'review' then
        perform public.notify(array[new.assignee_id] || public.helper_ids(new.id) || public.task_follower_ids(new.id), d, 'tasks', new.id, 'signed_off',
          format('%s signed off "%s"', who, new.title), actor);
      elsif new.status = 'done' then
        perform public.notify(array[new.created_by, new.assignee_id] || public.helper_ids(new.id) || public.task_follower_ids(new.id), d, 'tasks', new.id, 'done',
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
    perform public.notify(array[new.assignee_id, new.created_by] || public.manager_ids(d) || public.helper_ids(new.id)
                          || public.task_follower_ids(new.id),
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
  if new.daily_update is distinct from old.daily_update then changed := changed || 'daily updates'::text; end if;
  if new.contact_id is distinct from old.contact_id then changed := changed || 'outside person'::text; end if;
  if cardinality(changed) > 0 then
    insert into public.task_activity (task_id, department_id, actor_id, kind, old_value, new_value)
    values (new.id, d, actor, 'edited',
            case when 'priority' = any(changed) then old.priority end,
            array_to_string(changed, ', '));
    perform public.notify(array[new.assignee_id], d, 'tasks', new.id, 'edited',
      format('%s updated the %s of "%s"', who, array_to_string(changed, ', '), new.title), actor);
  end if;

  -- project status flag: kept in the history; At risk / Off track tells whoever gave it and the managers
  if row(new.health, new.health_note) is distinct from row(old.health, old.health_note) then
    insert into public.task_activity (task_id, department_id, actor_id, kind, old_value, new_value)
    values (new.id, d, actor, 'health', old.health, coalesce(new.health, '') || '|' || new.health_note);
    if new.health in ('at_risk', 'off_track') and new.health is distinct from old.health then
      perform public.notify(array[new.created_by, new.assignee_id] || public.manager_ids(d) || public.task_follower_ids(new.id),
        d, 'tasks', new.id, 'health',
        format('%s marked "%s" %s%s', who, new.title,
               case new.health when 'at_risk' then 'At risk' else 'Off track' end,
               coalesce(': ' || nullif(new.health_note, ''), '')), actor);
    end if;
  end if;

  -- repeating task completed → the next one, on the series' schedule (once per occurrence)
  if new.status = 'done' and old.status <> 'done' and new.repeat is not null and new.next_task_id is null then
    perform public.task_repeat_spawn(new.id, public.task_repeat_next_due(new), actor);
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

-- A "Daily update" is a comment with daily_for set: only the owner writes it, on a task that needs them,
-- for today or the last weekday (the morning catch-up).
create or replace function public.task_comments_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
begin
  if current_setting('app.system', true) = 'on' or pg_trigger_depth() > 1 then
    return new;
  end if;
  new.created_at := now();
  if new.daily_for is not null then
    select * into t from public.tasks where id = new.task_id;
    if t.assignee_id is distinct from auth.uid() then
      raise exception 'Only the owner of this task writes its daily update.' using errcode = '42501';
    end if;
    if not t.daily_update then
      raise exception 'This task doesn''t need daily updates.';
    end if;
    if new.daily_for not in (public.app_today(), public.task_prev_workday(public.app_today())) then
      raise exception 'A daily update can only be for today or the last working day.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists task_comments_before on public.task_comments;
create trigger task_comments_before before insert on public.task_comments
  for each row execute function public.task_comments_before();

create or replace function public.task_comments_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = new.task_id;
  if new.daily_for is not null then
    insert into public.task_activity (task_id, department_id, actor_id, kind, old_value, new_value, created_at)
    values (t.id, t.department_id, new.author_id, 'daily_update', new.daily_for::text, left(new.body, 300), new.created_at);
    perform public.notify(array[t.created_by] || public.task_follower_ids(t.id),
      t.department_id, 'tasks', t.id, 'daily_update',
      format('%s''s daily update on "%s"%s: %s', public.name_of(new.author_id), t.title,
             case when new.daily_for < public.app_today() then ' (for ' || public.fmt_date(new.daily_for) || ')' else '' end,
             left(new.body, 160)),
      new.author_id);
    return null;
  end if;
  insert into public.task_activity (task_id, department_id, actor_id, kind, new_value, created_at)
  values (t.id, t.department_id, new.author_id, 'comment', left(new.body, 300), new.created_at);
  perform public.notify(array[t.assignee_id, t.created_by] || public.helper_ids(t.id) || public.task_follower_ids(t.id),
    t.department_id, 'tasks', t.id, 'comment',
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

-- Project stages. Ordinary tasks' steps have no date or person. On a project, whoever runs it (owner, giver,
-- managers, seniors for members) changes the stages and gives them to people they could give work to;
-- someone given a stage can only tick their own.
create or replace function public.task_stage_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
begin
  if current_setting('app.system', true) = 'on' or pg_trigger_depth() > 1 or auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select * into t from public.tasks where id = case when tg_op = 'DELETE' then old.task_id else new.task_id end;
  if not found or t.nature <> 'project' then
    if tg_op = 'DELETE' then return old; end if;
    new.due_date := null;
    new.assignee_id := null;
    return new;
  end if;
  if public.can_run_task(t.id) then
    if tg_op <> 'DELETE' and new.assignee_id is not null and new.assignee_id <> auth.uid()
       and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
       and not public.can_assign_task(new.assignee_id, t.department_id) then
      raise exception 'You can''t give work to that person.' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.assignee_id = auth.uid()
     and row(new.body, new.due_date, new.assignee_id, new.position) is not distinct from row(old.body, old.due_date, old.assignee_id, old.position) then
    return new;   -- ticking your own stage
  end if;
  raise exception 'Only the project owner changes the stages — you can tick your own.' using errcode = '42501';
end $$;

drop trigger if exists task_stage_rules on public.task_checklist;
create trigger task_stage_rules before insert or update or delete on public.task_checklist
  for each row execute function public.task_stage_rules();

-- Someone given a stage: they can open the project (added as a helper, quietly) and get one alert.
create or replace function public.task_stage_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
begin
  if current_setting('app.system', true) = 'on' or new.assignee_id is null
     or (tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id) then
    return null;
  end if;
  select * into t from public.tasks where id = new.task_id;
  if not found or t.nature <> 'project' then
    return null;
  end if;
  if new.assignee_id <> t.assignee_id then
    perform set_config('app.system', 'on', true);
    insert into public.task_helpers (task_id, user_id, department_id, added_by)
    values (t.id, new.assignee_id, t.department_id, auth.uid())
    on conflict (task_id, user_id) do nothing;
    perform set_config('app.system', 'off', true);
  end if;
  perform public.notify(array[new.assignee_id], t.department_id, 'tasks', t.id, 'stage',
    format('%s gave you a stage in "%s": %s%s', public.name_of(auth.uid()), t.title, new.body,
           coalesce(' — due ' || public.fmt_date(new.due_date), '')), auth.uid());
  return null;
end $$;

drop trigger if exists task_stage_after on public.task_checklist;
create trigger task_stage_after after insert or update on public.task_checklist
  for each row execute function public.task_stage_after();

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
-- Escalated       → still not finished 3 days after the deadline: the managers, once per deadline (red flag)
-- Due today       → one morning reminder per person
-- Coming up       → the early reminder a task asked for ("remind me N days before"), once per deadline
-- Not opened yet  → each morning to whoever hasn't pressed "Got it"; once to whoever gave the task
-- (Tasks waiting for sign-off are finished as far as their owner is concerned: no deadline alerts.)
-- Daily repeats   → today's task appears even if the last one is still open (a missed day stays overdue).
--                   They get no "Due today" / "Coming up" alerts: they're due every day.
-- Runs every morning (step 4) and whenever someone opens the app. Never double-sends.
create or replace function public.run_deadline_check() returns void
language plpgsql security definer set search_path = public as $$
declare
  today date := public.app_today();
begin
  perform set_config('app.system', 'on', true);

  -- daily repeats: today's occurrence for every series whose latest one is from an earlier day
  perform public.task_repeat_spawn(t.id, today, null)
     from public.tasks t
    where t.repeat in ('daily', 'weekdays') and t.next_task_id is null
      and public.task_repeat_sched(t) < today
      and public.task_repeat_day(today, t.repeat) = today
      and public.user_has_app(t.assignee_id, 'tasks', t.department_id);

  with missed as (
    update public.tasks set overdue_notified_on = due_date
     where status not in ('done', 'review') and due_date < today
       and overdue_notified_on is distinct from due_date
    returning id, department_id, title, assignee_id, created_by, due_date
  ), recipients as (
    select distinct m.id, m.department_id, m.title, m.assignee_id, m.due_date, r.uid
    from missed m
    cross join lateral unnest(array[m.assignee_id, m.created_by] || public.manager_ids(m.department_id)
                              || public.helper_ids(m.id) || public.task_follower_ids(m.id)) as r(uid)
  )
  insert into public.notifications (user_id, department_id, app_key, ref_id, kind, message)
  select r.uid, r.department_id, 'tasks', r.id, 'overdue',
         case when r.uid = r.assignee_id
              then format('Missed deadline: "%s" was due %s', r.title, public.fmt_date(r.due_date))
              else format('Missed deadline: %s — "%s" was due %s',
                          public.name_of(r.assignee_id), r.title, public.fmt_date(r.due_date)) end
  from recipients r
  join public.profiles p on p.id = r.uid and p.active;

  -- project stages past their date: the stage person and the project owner, once per stage date
  with missed as (
    update public.task_checklist c set overdue_notified_on = c.due_date
      from public.tasks t
     where t.id = c.task_id and t.nature = 'project' and t.status not in ('done', 'review')
       and not c.done and c.due_date < today and c.overdue_notified_on is distinct from c.due_date
    returning t.id, t.department_id, t.title, t.assignee_id, c.body, c.due_date, coalesce(c.assignee_id, t.assignee_id) as who
  ), recipients as (
    select distinct m.id, m.department_id, m.title, m.body, m.due_date, m.who, r.uid
      from missed m cross join lateral unnest(array[m.who, m.assignee_id]) as r(uid)
  )
  insert into public.notifications (user_id, department_id, app_key, ref_id, kind, message)
  select r.uid, r.department_id, 'tasks', r.id, 'stage_overdue',
         case when r.uid = r.who
              then format('Missed stage: "%s" in "%s" was due %s', r.body, r.title, public.fmt_date(r.due_date))
              else format('Missed stage: %s — "%s" in "%s" was due %s', public.name_of(r.who), r.body, r.title, public.fmt_date(r.due_date)) end
    from recipients r
    join public.profiles p on p.id = r.uid and p.active;

  -- escalation: 3 days past the deadline and still not finished → the managers (and the owner is told)
  with esc as (
    update public.tasks set escalated_at = now()
     where status not in ('done', 'review') and due_date <= today - 3 and escalated_at is null
    returning id, department_id, title, assignee_id, due_date
  ), recipients as (
    select distinct e.id, e.department_id, e.title, e.assignee_id, e.due_date, r.uid
    from esc e
    cross join lateral unnest(public.manager_ids(e.department_id) || array[e.assignee_id]
                              || public.task_follower_ids(e.id)) as r(uid)
  )
  insert into public.notifications (user_id, department_id, app_key, ref_id, kind, message)
  select r.uid, r.department_id, 'tasks', r.id, 'escalated',
         case when r.uid = r.assignee_id
              then format('Escalated to your manager: "%s" is %s days past its deadline', r.title, today - r.due_date)
              else format('Escalated: %s''s "%s" is %s days past its deadline (%s)',
                          public.name_of(r.assignee_id), r.title, today - r.due_date, public.fmt_date(r.due_date)) end
  from recipients r
  join public.profiles p on p.id = r.uid and p.active;

  with due as (
    update public.tasks set reminded_on = today
     where status not in ('done', 'review') and due_date = today
       and reminded_on is distinct from today
       and (repeat is null or repeat not in ('daily', 'weekdays'))
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
       and (repeat is null or repeat not in ('daily', 'weekdays'))
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

  -- weekday mornings: each manager / senior executive hears what their team did on the last weekday
  if extract(isodow from today) < 6 then
    perform pg_advisory_xact_lock(hashtext('workspace-output-summary'));
    perform public.task_output_summary(today);
  end if;

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

-- ---------- Pin & follow ------------------------------------------------------
-- pinned: shows at the top of your Tasks list.  following: you get the task's alerts like a helper does.
create table if not exists public.task_follows (
  task_id        bigint not null references public.tasks(id) on delete cascade,
  user_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  department_id  uuid not null references public.departments(id) on delete cascade,
  pinned         boolean not null default false,
  following      boolean not null default false,
  created_at     timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index if not exists task_follows_user_idx on public.task_follows (user_id);

create or replace function public.task_follows_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.user_id := coalesce(auth.uid(), new.user_id);           -- only ever for yourself
    new.department_id := (select department_id from public.tasks where id = new.task_id);
    new.created_at := now();
  else
    new.user_id := old.user_id;
    new.task_id := old.task_id;
    new.department_id := old.department_id;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists task_follows_before on public.task_follows;
create trigger task_follows_before before insert or update on public.task_follows
  for each row execute function public.task_follows_before();

-- people following a task who can still see it
create or replace function public.task_follower_ids(p_task bigint) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(f.user_id), '{}')
  from public.task_follows f
  join public.tasks t on t.id = f.task_id
  where f.task_id = p_task and f.following
    and public.task_visible_to(f.user_id, t.department_id, t.assignee_id, t.created_by, t.id)
$$;

-- ---------- Quick reminders -------------------------------------------------------
-- A note to yourself (or, for managers and senior executives, to someone in their team) that pops up in the
-- bell and on the phone at the time you choose. Optionally repeats, optionally about a task.
create table if not exists public.task_reminders (
  id             bigint generated always as identity primary key,
  department_id  uuid not null references public.departments(id) on delete cascade,
  user_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,  -- who is reminded
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  body           text not null check (length(trim(body)) > 0),
  remind_at      timestamptz not null,
  repeat         text check (repeat in ('daily', 'weekdays', 'weekly', 'monthly')),
  task_id        bigint references public.tasks(id) on delete cascade,
  sent_at        timestamptz,     -- internal: when the alert for remind_at went out
  done_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists task_reminders_due_idx  on public.task_reminders (remind_at) where done_at is null;
create index if not exists task_reminders_user_idx on public.task_reminders (user_id, remind_at);
create index if not exists task_reminders_by_idx   on public.task_reminders (created_by);

-- the next time a repeating reminder is due (weekdays skip Saturday and Sunday)
create or replace function public.task_reminder_next(p_at timestamptz, p_repeat text) returns timestamptz
language plpgsql stable set search_path = public as $$
declare
  n timestamptz := p_at;
begin
  loop
    n := case p_repeat
           when 'daily'    then n + interval '1 day'
           when 'weekdays' then n + interval '1 day'
           when 'weekly'   then n + interval '7 days'
           else                 n + interval '1 month' end;
    exit when p_repeat <> 'weekdays' or extract(isodow from (n at time zone public.app_tz())) < 6;
  end loop;
  return n;
end $$;

create or replace function public.task_reminders_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.system', true) = 'on' or pg_trigger_depth() > 1 then
    return new;   -- the sender marking what it sent
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.user_id := coalesce(new.user_id, auth.uid());
    new.department_id := public.dept_of(new.user_id);
    new.sent_at := null;
    new.done_at := null;
    new.created_at := now();
    if auth.uid() is not null and new.user_id <> auth.uid() and not public.can_assign_task(new.user_id, new.department_id) then
      raise exception 'You can only set reminders for yourself or people in your team.' using errcode = '42501';
    end if;
    if new.task_id is not null and not exists (
         select 1 from public.tasks t where t.id = new.task_id and t.department_id = new.department_id
           and (auth.uid() is null or public.can_see_task(t.department_id, t.assignee_id, t.created_by) or public.is_task_helper(t.id))) then
      raise exception 'That task isn''t one you can see.';
    end if;
    return new;
  end if;
  new.department_id := old.department_id;
  new.user_id := old.user_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.task_id := old.task_id;
  new.sent_at := case when new.remind_at is distinct from old.remind_at then null else old.sent_at end;  -- snoozed: alert again
  new.done_at := case when new.done_at is null then null else coalesce(old.done_at, now()) end;
  return new;
end $$;

drop trigger if exists task_reminders_before on public.task_reminders;
create trigger task_reminders_before before insert or update on public.task_reminders
  for each row execute function public.task_reminders_before();

-- Sends every reminder whose time has come. Runs every minute (pg_cron) and whenever the app checks in.
create or replace function public.task_reminders_due() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select * from public.task_reminders
     where done_at is null and remind_at <= now() and (sent_at is null or sent_at < remind_at)
     order by remind_at
     for update skip locked
  loop
    perform public.notify(array[r.user_id], r.department_id, 'tasks', r.task_id, 'reminder',
      case when r.created_by is distinct from r.user_id
           then format('Reminder from %s: %s', public.name_of(r.created_by), r.body)
           else format('Reminder: %s', r.body) end, null);
    perform set_config('app.system', 'on', true);
    if r.repeat is null then
      update public.task_reminders set sent_at = now() where id = r.id;
    else
      update public.task_reminders
         set sent_at = now(),
             remind_at = (select max(x) from (
                            with recursive nx(x) as (
                              select public.task_reminder_next(r.remind_at, r.repeat)
                              union all
                              select public.task_reminder_next(x, r.repeat) from nx where x <= now())
                            select x from nx) q)
       where id = r.id;
    end if;
    perform set_config('app.system', 'off', true);
    n := n + 1;
  end loop;
  perform public.run_update_reminder();   -- 4:30 pm: daily updates still needed today
  return n;
end $$;

-- every minute, if the scheduler is on (it is turned on in step 4)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('workspace-reminders', '* * * * *', 'select public.task_reminders_due();');
  end if;
exception when others then
  raise notice 'Reminders scheduler not set up here (%). The app still sends them when someone has it open.', sqlerrm;
end $$;

-- ---------- Mini tasks (Today page) ---------------------------------------------
-- Quick to-dos for one day, private to the person who wrote them. One not ticked by the end of
-- the day waits the next morning: do it today, turn it into a real task, or delete it.
create table if not exists public.task_minis (
  id             bigint generated always as identity primary key,
  department_id  uuid not null references public.departments(id) on delete cascade,
  user_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  day            date not null default public.app_today(),
  body           text not null check (length(trim(body)) between 1 and 300),
  done_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists task_minis_user_idx on public.task_minis (user_id, day);
-- given by someone else (a manager / senior to their team); empty on your own
alter table public.task_minis add column if not exists created_by uuid references public.profiles(id) on delete set null;
create index if not exists task_minis_by_idx on public.task_minis (created_by) where created_by is not null;
create index if not exists task_minis_dept_idx on public.task_minis (department_id);

create or replace function public.task_minis_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.user_id := coalesce(new.user_id, auth.uid());
    -- your own list, or someone you could give work to
    if auth.uid() is not null and new.user_id <> auth.uid()
       and not public.can_assign_task(new.user_id, public.dept_of(new.user_id)) then
      raise exception 'You can only give mini tasks to people in your team.' using errcode = '42501';
    end if;
    new.department_id := public.dept_of(new.user_id);
    new.created_at := now();
  else
    new.user_id := old.user_id;
    new.created_by := old.created_by;
    new.department_id := old.department_id;
    new.created_at := old.created_at;
    if auth.uid() is distinct from old.user_id then
      new.done_at := old.done_at;          -- only the person it's for ticks it
    end if;
  end if;
  new.body := trim(new.body);
  return new;
end $$;

-- a mini task given to someone: one alert
create or replace function public.task_minis_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null and new.created_by <> new.user_id then
    perform public.notify(array[new.user_id], new.department_id, 'tasks', null, 'mini',
      format('%s gave you a mini task%s: %s', public.name_of(new.created_by),
             case when new.day <> public.app_today() then ' for ' || public.fmt_date(new.day) else '' end, new.body),
      new.created_by);
  end if;
  return null;
end $$;

drop trigger if exists task_minis_after on public.task_minis;
create trigger task_minis_after after insert on public.task_minis
  for each row execute function public.task_minis_after();

drop trigger if exists task_minis_before on public.task_minis;
create trigger task_minis_before before insert or update on public.task_minis
  for each row execute function public.task_minis_before();

-- ---------- Output: "My output" page, other work, morning summary (added Oct 2026) ----------
-- Whose daily output can I see? My own; managers their department; senior executives their members; the admin anyone.
create or replace function public.task_sees_work_of(p_user uuid, p_dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_user = auth.uid()
    or public.is_admin()
    or (p_dept = public.my_dept()
        and public.user_has_app(auth.uid(), 'tasks', p_dept)
        and (public.my_role() = 'manager'
             or (public.my_role() = 'senior' and public.role_of(p_user) = 'member'))), false)
$$;

-- Work done outside the app, logged as a free-text line. Only for today; only by the person themselves.
create table if not exists public.task_work_log (
  id             bigint generated always as identity primary key,
  department_id  uuid not null references public.departments(id) on delete cascade,
  user_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  day            date not null default public.app_today(),
  body           text not null check (length(trim(body)) between 1 and 500),
  created_at     timestamptz not null default now()
);
create index if not exists task_work_log_user_idx on public.task_work_log (user_id, day);
create index if not exists task_work_log_dept_idx on public.task_work_log (department_id, day);

create or replace function public.task_work_log_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.user_id := coalesce(auth.uid(), new.user_id);
    new.department_id := public.dept_of(new.user_id);
    new.day := public.app_today();          -- today only: earlier days can't be filled in afterwards
    new.created_at := now();
  else
    new.user_id := old.user_id;
    new.department_id := old.department_id;
    new.day := old.day;
    new.created_at := old.created_at;
  end if;
  new.body := trim(new.body);
  return new;
end $$;

drop trigger if exists task_work_log_before on public.task_work_log;
create trigger task_work_log_before before insert or update on public.task_work_log
  for each row execute function public.task_work_log_before();

-- ---------- Focus timer (Pomodoro), added Oct 2026 ----------
-- One row per focus slot, written when it ends (finished, or stopped / skipped early). Optionally about a task.
-- Shown on My output; read by the person and whoever task_sees_work_of allows. Never changed afterwards.
create table if not exists public.task_focus (
  id             bigint generated always as identity primary key,
  department_id  uuid not null references public.departments(id) on delete cascade,
  user_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  task_id        bigint references public.tasks(id) on delete set null,
  started_at     timestamptz not null,
  ended_at       timestamptz not null default now(),
  planned_min    int not null check (planned_min between 1 and 240),
  minutes        int not null check (minutes between 1 and 240),
  completed      boolean not null default false,
  client_start   timestamptz not null,     -- the start as the device sent it: two open tabs record a slot once
  created_at     timestamptz not null default now()
);
create unique index if not exists task_focus_once_idx on public.task_focus (user_id, client_start);
create index if not exists task_focus_dept_idx on public.task_focus (department_id, started_at);
create index if not exists task_focus_task_idx on public.task_focus (task_id);

create or replace function public.task_focus_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks;
  wall int;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  new.user_id := coalesce(auth.uid(), new.user_id);
  new.department_id := public.dept_of(new.user_id);
  new.client_start := new.started_at;
  new.ended_at := coalesce(new.ended_at, now());
  -- a device whose clock runs fast: keep the length, end it now
  if new.ended_at > now() then
    new.started_at := new.started_at - (new.ended_at - now());
    new.ended_at := now();
  end if;
  new.created_at := now();
  if new.started_at is null or new.started_at > new.ended_at or new.started_at < now() - interval '2 days' then
    raise exception 'That focus session has the wrong times.';
  end if;
  -- can't have focused longer than the time that passed (pauses only make it shorter)
  wall := ceil(extract(epoch from new.ended_at - new.started_at) / 60.0)::int;
  new.minutes := greatest(1, least(new.minutes, wall + 1, new.planned_min));
  new.completed := coalesce(new.completed, false) and new.minutes >= new.planned_min;
  if new.task_id is not null then
    select * into t from public.tasks where id = new.task_id;
    if not found or t.department_id is distinct from new.department_id
       or not (auth.uid() is null or public.can_see_task(t.department_id, t.assignee_id, t.created_by) or public.is_task_helper(t.id)) then
      raise exception 'That task isn''t one you can see.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists task_focus_before on public.task_focus;
create trigger task_focus_before before insert on public.task_focus
  for each row execute function public.task_focus_before();

-- Each person's lengths (minutes): focus, short break, long break, and how many focus slots before the long break.
create table if not exists public.task_focus_settings (
  user_id     uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  focus_min   int not null default 25 check (focus_min between 1 and 180),
  short_min   int not null default 5  check (short_min between 1 and 60),
  long_min    int not null default 15 check (long_min between 1 and 90),
  rounds      int not null default 4  check (rounds between 1 and 12),
  sound       boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- Save my lengths (one row per person).
create or replace function public.task_focus_save(p_focus int, p_short int, p_long int, p_rounds int, p_sound boolean)
returns public.task_focus_settings
language sql volatile set search_path = public as $$
  insert into public.task_focus_settings (user_id, focus_min, short_min, long_min, rounds, sound, updated_at)
  values (auth.uid(), p_focus, p_short, p_long, p_rounds, coalesce(p_sound, true), now())
  on conflict (user_id) do update set focus_min = excluded.focus_min, short_min = excluded.short_min,
    long_min = excluded.long_min, rounds = excluded.rounds, sound = excluded.sound, updated_at = now()
  returning *
$$;

-- What one person did on one day, as counts (for the managers' morning summary). Internal.
create or replace function public.task_output_counts(p_user uuid, p_dept uuid, p_day date,
  out finished int, out minis int, out steps int, out updates int, out other int)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from public.tasks t
      where t.department_id = p_dept and t.assignee_id = p_user and t.status in ('review', 'done')
        and (coalesce(t.submitted_at, t.completed_at) at time zone public.app_tz())::date = p_day),
    (select count(*)::int from public.task_minis m
      where m.user_id = p_user and m.department_id = p_dept and (m.done_at at time zone public.app_tz())::date = p_day),
    (select count(*)::int from public.task_checklist c
      where c.department_id = p_dept and c.done_by = p_user and (c.done_at at time zone public.app_tz())::date = p_day),
    (select count(*)::int from public.task_comments c join public.tasks t on t.id = c.task_id
      where t.department_id = p_dept and c.author_id = p_user and c.daily_for = p_day),
    (select count(*)::int from public.task_work_log w
      where w.user_id = p_user and w.department_id = p_dept and w.day = p_day)
$$;

-- My tasks still waiting for yesterday's (the last weekday's) daily update. The app won't open until they're written.
create or replace function public.tasks_updates_owed()
returns table (task_id bigint, title text, day date)
language sql stable set search_path = public as $$
  select t.id, t.title, public.task_prev_workday(public.app_today())
    from public.tasks t
   where t.assignee_id = auth.uid() and t.daily_update
     and public.task_update_required(t, public.task_prev_workday(public.app_today()))
     and not exists (select 1 from public.task_comments c
                      where c.task_id = t.id and c.daily_for = public.task_prev_workday(public.app_today()))
   order by t.due_date, t.id
$$;

-- 4:30 pm on weekdays: one alert per person listing tasks still waiting for today's update.
-- Called every minute by task_reminders_due(); does nothing before 16:30 or once sent today.
create or replace function public.run_update_reminder(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  today date := (p_now at time zone public.app_tz())::date;
  n int := 0;
begin
  if extract(isodow from today) >= 6 or (p_now at time zone public.app_tz())::time < time '16:30' then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtext('workspace-update-reminder'));
  with owed as (
    select t.department_id, t.assignee_id, count(*) as k,
           string_agg('"' || t.title || '"', ', ' order by t.title) as titles
      from public.tasks t
      join public.profiles p on p.id = t.assignee_id and p.active
     where t.daily_update and public.task_update_required(t, today)
       and not exists (select 1 from public.task_comments c where c.task_id = t.id and c.daily_for = today)
       and not exists (select 1 from public.notifications x
                        where x.user_id = t.assignee_id and x.kind = 'update_due'
                          and (x.created_at at time zone public.app_tz())::date = today)
     group by t.department_id, t.assignee_id
  ), ins as (
    insert into public.notifications (user_id, department_id, app_key, kind, message)
    select o.assignee_id, o.department_id, 'tasks', 'update_due',
           case when o.k = 1 then format('Daily update still needed today: %s — write it in the task before you finish', o.titles)
                else format('%s tasks still need today''s update: %s', o.k, left(o.titles, 220)) end
      from owed o
    returning 1
  )
  select count(*) into n from ins;
  return n;
end $$;

-- Weekday mornings: each manager / senior executive gets one alert with what their team did on the last weekday,
-- and who didn't write a daily update that day (writing it the next morning counts as missed). Once per day.
create or replace function public.task_output_summary(p_today date) returns int
language plpgsql security definer set search_path = public as $$
declare
  prev   date := public.task_prev_workday(p_today);
  lead   record;
  m      record;
  c      record;
  parts  text[];
  missed text[];
  total  int;
  n      int := 0;
  pl     text;
begin
  for lead in
    select p.id, p.department_id, p.role from public.profiles p
     where p.active and p.department_id is not null and p.role in ('manager', 'senior')
       and public.user_has_app(p.id, 'tasks', p.department_id)
       and not exists (select 1 from public.notifications x
                        where x.user_id = p.id and x.kind = 'output_summary'
                          and (x.created_at at time zone public.app_tz())::date = p_today)
     order by p.id
  loop
    parts := '{}';
    missed := '{}';
    for m in
      select q.id, q.full_name from public.profiles q
       where q.active and q.department_id = lead.department_id and q.id <> lead.id
         and public.user_has_app(q.id, 'tasks', q.department_id)
         and (lead.role = 'manager' or q.role = 'member')
       order by q.full_name
    loop
      select * into c from public.task_output_counts(m.id, lead.department_id, prev);
      total := c.finished + c.minis + c.steps + c.updates + c.other;
      pl := concat_ws(', ',
              case when c.finished > 0 then c.finished || ' task' || case when c.finished = 1 then '' else 's' end || ' finished' end,
              case when c.updates > 0 then c.updates || ' update' || case when c.updates = 1 then '' else 's' end end,
              case when c.minis + c.steps > 0 then (c.minis + c.steps) || ' small item' || case when c.minis + c.steps = 1 then '' else 's' end end,
              case when c.other > 0 then c.other || ' other' end);
      parts := parts || (split_part(m.full_name, ' ', 1) || ' ' || case when total = 0 then 'nothing recorded' else pl end);
      if exists (select 1 from public.tasks t
                  where t.assignee_id = m.id and t.department_id = lead.department_id and t.daily_update
                    and public.task_update_required(t, prev)
                    and not exists (select 1 from public.task_comments cc
                                     where cc.task_id = t.id and cc.daily_for = prev
                                       and (cc.created_at at time zone public.app_tz())::date = prev)) then
        missed := missed || split_part(m.full_name, ' ', 1);
      end if;
    end loop;
    continue when cardinality(parts) = 0;
    insert into public.notifications (user_id, department_id, app_key, kind, message)
    values (lead.id, lead.department_id, 'tasks', 'output_summary',
            left(format('%s — %s%s', public.fmt_date(prev), array_to_string(parts, ' · '),
                        case when cardinality(missed) > 0
                             then '. Missed daily updates: ' || array_to_string(missed, ', ') else '' end), 900));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- People outside the app (contacts) --------------------------------
-- Department: the person's own (the admin may keep the one being viewed). Who added it never changes.
create or replace function public.task_contacts_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if not public.is_admin() or new.department_id is null then
      new.department_id := public.my_dept();
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    new.active := true;
  else
    new.department_id := old.department_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.name := trim(new.name);
  new.organisation := trim(coalesce(new.organisation, ''));
  new.phone := trim(coalesce(new.phone, ''));
  new.email := trim(coalesce(new.email, ''));
  new.note := trim(coalesce(new.note, ''));
  return new;
end $$;

drop trigger if exists task_contacts_before on public.task_contacts;
create trigger task_contacts_before before insert or update on public.task_contacts
  for each row execute function public.task_contacts_before();

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

-- pin & follow: your own marks, on tasks you can see
alter table public.task_follows   enable row level security;
alter table public.task_reminders enable row level security;
drop policy if exists task_follows_own on public.task_follows;
create policy task_follows_own on public.task_follows for all to authenticated
  using (user_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id))
  with check (user_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id));

-- reminders: only the person reminded and whoever set it
drop policy if exists task_reminders_select on public.task_reminders;
create policy task_reminders_select on public.task_reminders for select to authenticated
  using (user_id = auth.uid() or created_by = auth.uid());
drop policy if exists task_reminders_insert on public.task_reminders;
create policy task_reminders_insert on public.task_reminders for insert to authenticated
  with check (public.has_app('tasks', department_id)
              and department_id = public.dept_of(user_id)
              and (user_id = auth.uid() or public.can_assign_task(user_id, department_id)));
drop policy if exists task_reminders_update on public.task_reminders;
create policy task_reminders_update on public.task_reminders for update to authenticated
  using (user_id = auth.uid() or created_by = auth.uid())
  with check (user_id = auth.uid() or created_by = auth.uid());
drop policy if exists task_reminders_delete on public.task_reminders;
create policy task_reminders_delete on public.task_reminders for delete to authenticated
  using (user_id = auth.uid() or created_by = auth.uid());

-- mini tasks: private to the person they're for (and whoever gave one), except ticked ones, which show in their
-- output to their managers
alter table public.task_minis enable row level security;
drop policy if exists task_minis_select on public.task_minis;
create policy task_minis_select on public.task_minis for select to authenticated
  using (user_id = auth.uid() or created_by = auth.uid()                                 -- yours, and ones you gave
         or (done_at is not null and public.task_sees_work_of(user_id, department_id)));   -- ticked ones: in their output
drop policy if exists task_minis_insert on public.task_minis;
create policy task_minis_insert on public.task_minis for insert to authenticated
  with check (created_by = auth.uid()
              and department_id = public.my_dept()
              and public.user_has_app(auth.uid(), 'tasks', department_id));
drop policy if exists task_minis_update on public.task_minis;
create policy task_minis_update on public.task_minis for update to authenticated
  using (user_id = auth.uid() or (created_by = auth.uid() and done_at is null))         -- the giver: until it's ticked
  with check (user_id = auth.uid() or created_by = auth.uid());
drop policy if exists task_minis_delete on public.task_minis;
create policy task_minis_delete on public.task_minis for delete to authenticated
  using (user_id = auth.uid() or (created_by = auth.uid() and done_at is null));

-- people outside the app: a shared list per department. Anyone with Tasks adds people and gives them work;
-- whoever added someone, managers, senior executives and the admin change details; managers remove them for good
-- (only once no task mentions them — otherwise they're switched off and stay on their tasks).
alter table public.task_contacts enable row level security;
drop policy if exists task_contacts_select on public.task_contacts;
create policy task_contacts_select on public.task_contacts for select to authenticated
  using (public.is_admin() or (department_id = public.my_dept() and public.has_app('tasks', department_id)));
drop policy if exists task_contacts_insert on public.task_contacts;
create policy task_contacts_insert on public.task_contacts for insert to authenticated
  with check (public.has_app('tasks', department_id) and (public.is_admin() or department_id = public.my_dept()));
drop policy if exists task_contacts_update on public.task_contacts;
create policy task_contacts_update on public.task_contacts for update to authenticated
  using (public.is_admin() or (department_id = public.my_dept() and public.has_app('tasks', department_id)
                               and (created_by = auth.uid() or public.my_role() in ('manager', 'senior'))))
  with check (public.is_admin() or department_id = public.my_dept());
drop policy if exists task_contacts_delete on public.task_contacts;
create policy task_contacts_delete on public.task_contacts for delete to authenticated
  using (public.is_admin() or (department_id = public.my_dept() and public.my_role() = 'manager'));

-- other work: the person writes today's lines; they and their managers / senior executive can read them
alter table public.task_work_log enable row level security;
drop policy if exists task_work_log_select on public.task_work_log;
create policy task_work_log_select on public.task_work_log for select to authenticated
  using (public.task_sees_work_of(user_id, department_id));
drop policy if exists task_work_log_insert on public.task_work_log;
create policy task_work_log_insert on public.task_work_log for insert to authenticated
  with check (user_id = auth.uid()
              and department_id = public.my_dept()
              and public.user_has_app(auth.uid(), 'tasks', department_id));
drop policy if exists task_work_log_update on public.task_work_log;
create policy task_work_log_update on public.task_work_log for update to authenticated
  using (user_id = auth.uid() and day = public.app_today())
  with check (user_id = auth.uid());
drop policy if exists task_work_log_delete on public.task_work_log;
create policy task_work_log_delete on public.task_work_log for delete to authenticated
  using (user_id = auth.uid() and day = public.app_today());

-- focus sessions: the person records their own; they and their managers / senior executive can read them;
-- today's can be removed by the person (a mistaken one). Lengths: each person's own row only.
alter table public.task_focus enable row level security;
drop policy if exists task_focus_select on public.task_focus;
create policy task_focus_select on public.task_focus for select to authenticated
  using (public.task_sees_work_of(user_id, department_id));
drop policy if exists task_focus_insert on public.task_focus;
create policy task_focus_insert on public.task_focus for insert to authenticated
  with check (user_id = auth.uid()
              and department_id = public.my_dept()
              and public.user_has_app(auth.uid(), 'tasks', department_id));
drop policy if exists task_focus_delete on public.task_focus;
create policy task_focus_delete on public.task_focus for delete to authenticated
  using (user_id = auth.uid() and (started_at at time zone public.app_tz())::date = public.app_today());

alter table public.task_focus_settings enable row level security;
drop policy if exists task_focus_settings_own on public.task_focus_settings;
create policy task_focus_settings_own on public.task_focus_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

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
              public.task_checklist, public.task_attachments, public.time_blocks, public.task_follows,
              public.task_reminders, public.task_minis, public.task_work_log, public.task_contacts,
              public.task_focus, public.task_focus_settings
  from anon, authenticated;
grant select, insert, delete         on public.task_focus       to authenticated;
grant select, insert, update         on public.task_focus_settings to authenticated;
grant select, insert, update, delete on public.task_contacts    to authenticated;
grant select, insert, update, delete on public.task_minis       to authenticated;
grant select, insert, update, delete on public.task_work_log    to authenticated;
grant select, insert, update, delete on public.task_follows     to authenticated;
grant select, insert, update, delete on public.task_reminders   to authenticated;
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
revoke execute on function public.task_follows_before()          from public, anon, authenticated;
revoke execute on function public.task_reminders_before()        from public, anon, authenticated;
revoke execute on function public.task_reminders_due()           from public, anon;
grant  execute on function public.task_reminders_due()           to authenticated;
revoke execute on function public.task_minis_before()            from public, anon, authenticated;
revoke execute on function public.task_repeat_spawn(bigint, date, uuid) from public, anon, authenticated;
revoke execute on function public.task_comments_before()         from public, anon, authenticated;
revoke execute on function public.task_work_log_before()         from public, anon, authenticated;
revoke execute on function public.task_focus_before()            from public, anon, authenticated;
revoke execute on function public.task_focus_save(int, int, int, int, boolean) from public, anon;
grant  execute on function public.task_focus_save(int, int, int, int, boolean) to authenticated;
revoke execute on function public.task_output_counts(uuid, uuid, date) from public, anon, authenticated;
revoke execute on function public.task_output_summary(date)      from public, anon, authenticated;
revoke execute on function public.run_update_reminder(timestamptz) from public, anon, authenticated;
revoke execute on function public.tasks_updates_owed()           from public, anon;
grant  execute on function public.tasks_updates_owed()           to authenticated;
revoke execute on function public.task_contacts_before()         from public, anon, authenticated;
revoke execute on function public.task_stage_rules()             from public, anon, authenticated;
revoke execute on function public.task_stage_after()             from public, anon, authenticated;
revoke execute on function public.task_minis_after()             from public, anon, authenticated;
