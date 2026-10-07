-- =====================================================================
--  WORKSPACE — update 2: helpers, checklist, files, Today page, Notes
--  For a database set up BEFORE this update (after update 1).
--  Run once in the SQL Editor. Safe to run again. Keeps all your data.
--  (It is 02_app_tasks.sql + 05_app_notes.sql, then a read-only report.)
-- =====================================================================

-- =====================================================================
--  WORKSPACE — Tasks app (step 2 of 5)
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
  status               text not null default 'todo' check (status in ('todo', 'doing', 'waiting', 'done')),
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
    return new;
  end if;

  -- UPDATE: department, creator and markers can't be changed by users
  new.department_id := old.department_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.overdue_notified_on := old.overdue_notified_on;
  new.reminded_on := old.reminded_on;

  if auth.uid() is not null
     and new.assignee_id is distinct from old.assignee_id
     and not public.can_assign_task(new.assignee_id, old.department_id) then
    raise exception 'You can''t assign work to that person.' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    new.completed_at := case when new.status = 'done' then now() end;
  else
    new.completed_at := old.completed_at;
  end if;

  if row(new.title, new.notes, new.assignee_id, new.status, new.priority, new.due_date)
     is distinct from
     row(old.title, old.notes, old.assignee_id, old.status, old.priority, old.due_date) then
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
    insert into public.task_activity (task_id, department_id, actor_id, kind, old_value, new_value)
    values (new.id, d, actor, 'status', old.status, new.status);
    if new.status = 'done' then
      perform public.notify(array[new.created_by] || public.helper_ids(new.id), d, 'tasks', new.id, 'done',
        format('%s completed "%s"', who, new.title), actor);
    elsif new.status = 'waiting' then
      perform public.notify(array[new.created_by], d, 'tasks', new.id, 'waiting',
        format('%s is waiting on something for "%s"', who, new.title), actor);
    end if;
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
  if cardinality(changed) > 0 then
    insert into public.task_activity (task_id, department_id, actor_id, kind, old_value, new_value)
    values (new.id, d, actor, 'edited',
            case when 'priority' = any(changed) then old.priority end,
            array_to_string(changed, ', '));
    perform public.notify(array[new.assignee_id], d, 'tasks', new.id, 'edited',
      format('%s updated the %s of "%s"', who, array_to_string(changed, ', '), new.title), actor);
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
-- Runs every morning (step 4) and whenever someone opens the app. Never double-sends.
create or replace function public.run_deadline_check() returns void
language plpgsql security definer set search_path = public as $$
declare
  today date := public.app_today();
begin
  perform set_config('app.system', 'on', true);

  with missed as (
    update public.tasks set overdue_notified_on = due_date
     where status <> 'done' and due_date < today
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
     where status <> 'done' and due_date = today
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

  perform set_config('app.system', 'off', true);
end $$;

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

-- =====================================================================
--  WORKSPACE — Notes app (step 5 of 5)
--  Run after 02_app_tasks.sql. Safe to run again.
--
--  Pages and sub-pages. A page is private to its owner unless the owner
--  shares it with the whole department or chosen people (view or edit).
--  Sub-pages follow the sharing of their top-level page.
--  The platform admin can read every page (read-only unless it's theirs).
-- =====================================================================

insert into public.apps (key, name, description, sort)
values ('notes', 'Notes', 'Pages and sub-pages, private or shared, linked to tasks', 20)
on conflict (key) do update set name = excluded.name, description = excluded.description;

-- ---------- Tables -----------------------------------------------------
create table if not exists public.notes_pages (
  id             bigint generated always as identity primary key,
  department_id  uuid not null references public.departments(id) on delete cascade,
  owner_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  parent_id      bigint references public.notes_pages(id) on delete cascade,
  root_id        bigint references public.notes_pages(id) on delete cascade,  -- its top-level page (itself if top-level)
  title          text not null default '',
  content        jsonb not null default '{}'::jsonb,                    -- rich text document
  position       double precision not null default 0,
  share_scope    text not null default 'private' check (share_scope in ('private', 'department', 'people')),
  dept_access    text not null default 'view' check (dept_access in ('view', 'edit')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id) on delete set null
);

-- Who a page is shared with when share_scope = 'people'
create table if not exists public.notes_shares (
  note_id     bigint not null references public.notes_pages(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  access      text not null default 'view' check (access in ('view', 'edit')),
  created_at  timestamptz not null default now(),
  primary key (note_id, user_id)
);

-- Files on a page (stored in the private "workspace-files" bucket under notes/<page id>/...)
create table if not exists public.notes_files (
  id             bigint generated always as identity primary key,
  note_id        bigint not null references public.notes_pages(id) on delete cascade,
  department_id  uuid not null references public.departments(id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  path           text not null,
  size           bigint,
  mime           text,
  inline         boolean not null default false,   -- true = an image shown inside the page
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- Pages linked to tasks
create table if not exists public.notes_task_links (
  note_id     bigint not null references public.notes_pages(id) on delete cascade,
  task_id     bigint not null references public.tasks(id) on delete cascade,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (note_id, task_id)
);

create index if not exists notes_pages_dept_idx          on public.notes_pages (department_id, owner_id);
create index if not exists notes_pages_parent_idx        on public.notes_pages (parent_id, position);
create index if not exists notes_pages_root_idx          on public.notes_pages (root_id);
create index if not exists notes_shares_user_idx    on public.notes_shares (user_id);
create index if not exists notes_files_note_idx on public.notes_files (note_id);
create index if not exists notes_task_links_task_idx  on public.notes_task_links (task_id);

-- ---------- Who can open a page ----------------------------------------
-- 'edit' / 'view' / null (no access). Decided by the TOP-LEVEL page:
--   owner (still in that department, with the Notes app) → edit
--   platform admin → view (edit if it's their own page)
--   same department + Notes app → department share or personal share
-- Works from the page's own fields, so a brand-new page can be checked in the
-- same statement that creates it.
create or replace function public.notes_access_row(p_id bigint, p_root bigint, p_owner uuid, p_dept uuid,
                                                  p_scope text, p_dept_access text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  share text;
begin
  if p_root is not null and p_root <> p_id then
    return public.notes_access(p_root);           -- sub-page: follow its top-level page
  end if;
  if p_owner = me and p_dept = public.my_dept()
     and (public.is_admin() or public.user_has_app(me, 'notes', p_dept)) then
    return 'edit';
  end if;
  if public.is_admin() then return 'view'; end if;
  if p_dept is distinct from public.my_dept() or not public.user_has_app(me, 'notes', p_dept) then
    return null;
  end if;
  if p_scope = 'department' then return p_dept_access; end if;
  if p_scope = 'people' then
    select access into share from public.notes_shares where note_id = p_id and user_id = me;
    return share;
  end if;
  return null;
end $$;

create or replace function public.notes_access(p_note bigint) returns text
language plpgsql stable security definer set search_path = public as $$
declare r public.notes_pages;
begin
  select root.* into r
  from public.notes_pages n join public.notes_pages root on root.id = coalesce(n.root_id, n.id)
  where n.id = p_note;
  if not found then return null; end if;
  return public.notes_access_row(r.id, r.id, r.owner_id, r.department_id, r.share_scope, r.dept_access);
end $$;

-- Storage: may I open / change files under notes/<page id>/... ?
create or replace function public.notes_file_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare ref bigint; acc text;
begin
  if split_part(p_name, '/', 1) <> 'notes' then return false; end if;
  begin
    ref := split_part(p_name, '/', 2)::bigint;
  exception when others then
    return false;
  end;
  acc := public.notes_access(ref);
  return case when p_write then acc = 'edit' else acc is not null end;
end $$;

-- ---------- Rules before saving ----------------------------------------
create or replace function public.notes_pages_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare parent public.notes_pages;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(auth.uid(), new.owner_id);
    if new.parent_id is null then
      new.root_id := new.id;
      new.department_id := public.dept_of(new.owner_id);
    else
      select * into parent from public.notes_pages where id = new.parent_id;
      new.root_id := coalesce(parent.root_id, parent.id);
      new.department_id := parent.department_id;
      new.share_scope := 'private';  -- sub-pages follow their top-level page
    end if;
    new.created_at := now();
  else
    new.owner_id := old.owner_id;
    new.parent_id := old.parent_id;
    new.root_id := old.root_id;
    new.department_id := old.department_id;
    new.created_at := old.created_at;
    -- only the owner of a top-level page changes its sharing
    if old.parent_id is not null or auth.uid() is distinct from old.owner_id then
      new.share_scope := old.share_scope;
      new.dept_access := old.dept_access;
    end if;
  end if;
  -- "edited" means the words changed (not the sharing or the order)
  if tg_op = 'INSERT' or new.title is distinct from old.title or new.content is distinct from old.content then
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  else
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  end if;
  return new;
end $$;

drop trigger if exists notes_pages_before on public.notes_pages;
create trigger notes_pages_before before insert or update on public.notes_pages
  for each row execute function public.notes_pages_before();

create or replace function public.notes_files_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.department_id := (select department_id from public.notes_pages where id = new.note_id);
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  return new;
end $$;

drop trigger if exists notes_files_before on public.notes_files;
create trigger notes_files_before before insert on public.notes_files
  for each row execute function public.notes_files_before();

-- tell someone when a page is shared with them
create or replace function public.notes_shares_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare n public.notes_pages;
begin
  select * into n from public.notes_pages where id = new.note_id;
  if tg_op = 'INSERT' or new.access is distinct from old.access then
    perform public.notify(array[new.user_id], n.department_id, 'notes', n.id, 'shared',
      format('%s shared "%s" with you (%s)', public.name_of(auth.uid()),
             coalesce(nullif(n.title, ''), 'Untitled page'),
             case when new.access = 'edit' then 'can edit' else 'can view' end), auth.uid());
  end if;
  return null;
end $$;

drop trigger if exists notes_shares_after on public.notes_shares;
create trigger notes_shares_after after insert or update on public.notes_shares
  for each row execute function public.notes_shares_after();

-- deleting a page clears its notifications
create or replace function public.notes_pages_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.notifications where app_key = 'notes' and ref_id = old.id;
  return null;
end $$;

drop trigger if exists notes_pages_deleted on public.notes_pages;
create trigger notes_pages_deleted after delete on public.notes_pages
  for each row execute function public.notes_pages_deleted();

-- ---------- Row level security ------------------------------------------
alter table public.notes_pages            enable row level security;
alter table public.notes_shares      enable row level security;
alter table public.notes_files enable row level security;
alter table public.notes_task_links  enable row level security;

drop policy if exists notes_pages_select on public.notes_pages;
create policy notes_pages_select on public.notes_pages for select to authenticated
  using (public.notes_access_row(id, root_id, owner_id, department_id, share_scope, dept_access) is not null);

-- new top-level page: your own, in your department, with the Notes app.
-- new sub-page: you need edit access to the page above it.
drop policy if exists notes_pages_insert on public.notes_pages;
create policy notes_pages_insert on public.notes_pages for insert to authenticated
  with check (owner_id = auth.uid()
              and department_id = public.my_dept()
              and public.user_has_app(auth.uid(), 'notes', department_id)
              and (parent_id is null or public.notes_access(parent_id) = 'edit'));

drop policy if exists notes_pages_update on public.notes_pages;
create policy notes_pages_update on public.notes_pages for update to authenticated
  using (public.notes_access_row(id, root_id, owner_id, department_id, share_scope, dept_access) = 'edit')
  with check (public.notes_access_row(id, root_id, owner_id, department_id, share_scope, dept_access) = 'edit');

-- top-level pages: only the owner deletes. Sub-pages: anyone who can edit.
drop policy if exists notes_pages_delete on public.notes_pages;
create policy notes_pages_delete on public.notes_pages for delete to authenticated
  using (public.notes_access_row(id, root_id, owner_id, department_id, share_scope, dept_access) = 'edit' and (parent_id is not null or owner_id = auth.uid()));

-- sharing list: visible to people who can open the page; only the page owner changes it,
-- and only with people in the same department who have Notes
drop policy if exists notes_shares_select on public.notes_shares;
create policy notes_shares_select on public.notes_shares for select to authenticated
  using (public.notes_access(note_id) is not null);
drop policy if exists notes_shares_write on public.notes_shares;
create policy notes_shares_write on public.notes_shares for all to authenticated
  using (exists (select 1 from public.notes_pages n where n.id = note_id and n.parent_id is null
                 and n.owner_id = auth.uid() and public.notes_access(n.id) = 'edit'))
  with check (exists (select 1 from public.notes_pages n where n.id = note_id and n.parent_id is null
                      and n.owner_id = auth.uid() and public.notes_access(n.id) = 'edit'
                      and public.user_has_app(user_id, 'notes', n.department_id))
              and user_id <> auth.uid());

drop policy if exists notes_files_select on public.notes_files;
create policy notes_files_select on public.notes_files for select to authenticated
  using (public.notes_access(note_id) is not null);
drop policy if exists notes_files_insert on public.notes_files;
create policy notes_files_insert on public.notes_files for insert to authenticated
  with check (public.notes_access(note_id) = 'edit' and path like 'notes/' || note_id || '/%');
drop policy if exists notes_files_delete on public.notes_files;
create policy notes_files_delete on public.notes_files for delete to authenticated
  using (public.notes_access(note_id) = 'edit');

-- links: you see a link only if you can open BOTH the page and the task
drop policy if exists notes_task_links_select on public.notes_task_links;
create policy notes_task_links_select on public.notes_task_links for select to authenticated
  using (public.notes_access(note_id) is not null
         and exists (select 1 from public.tasks t where t.id = task_id));
drop policy if exists notes_task_links_insert on public.notes_task_links;
create policy notes_task_links_insert on public.notes_task_links for insert to authenticated
  with check (public.notes_access(note_id) is not null
              and exists (select 1 from public.tasks t where t.id = task_id)
              and (select department_id from public.notes_pages where id = note_id)
                  = (select department_id from public.tasks where id = task_id));
drop policy if exists notes_task_links_delete on public.notes_task_links;
create policy notes_task_links_delete on public.notes_task_links for delete to authenticated
  using (public.notes_access(note_id) is not null
         and exists (select 1 from public.tasks t where t.id = task_id)
         and (created_by = auth.uid() or public.notes_access(note_id) = 'edit'));

-- ---------- File storage -------------------------------------------------
drop policy if exists "notes files: read" on storage.objects;
create policy "notes files: read" on storage.objects for select to authenticated
  using (bucket_id = 'workspace-files' and public.notes_file_ok(name, false));
drop policy if exists "notes files: upload" on storage.objects;
create policy "notes files: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'workspace-files' and public.notes_file_ok(name, true));
drop policy if exists "notes files: delete" on storage.objects;
create policy "notes files: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'workspace-files' and public.notes_file_ok(name, true));

-- ---------- Permissions -------------------------------------------------
revoke all on public.notes_pages, public.notes_shares, public.notes_files, public.notes_task_links
  from anon, authenticated;
grant select, insert, update, delete on public.notes_pages            to authenticated;
grant select, insert, update, delete on public.notes_shares      to authenticated;
grant select, insert, delete         on public.notes_files to authenticated;
grant select, insert, delete         on public.notes_task_links  to authenticated;
grant usage on all sequences in schema public to authenticated;

revoke execute on function public.notes_pages_before()         from public, anon, authenticated;
revoke execute on function public.notes_files_before() from public, anon, authenticated;
revoke execute on function public.notes_shares_after()    from public, anon, authenticated;
revoke execute on function public.notes_pages_deleted()        from public, anon, authenticated;

-- ---------- Report (read-only): anything here that isn't part of Workspace ----------
-- Workspace never changes these. They are listed so you know what else is in this project
-- (for example tables left by an older app). No rows = nothing else found.
select 'table' as kind, t.tablename as name,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.tablename), false, true, '')))[1]::text || ' rows' as detail
from pg_tables t
where t.schemaname = 'public'
  and t.tablename <> all (array[
    'departments','profiles','platform_admins','apps','department_apps','app_members','department_features',
    'notifications','tasks','task_comments','task_activity','task_helpers','task_checklist','task_attachments',
    'time_blocks','daily_notes','notes_pages','notes_shares','notes_files','notes_task_links'])
union all
select 'file bucket', b.id, case when b.public then 'public' else 'private' end
from storage.buckets b
where b.id <> 'workspace-files'
union all
select 'file rule', p.policyname, coalesce(p.qual, p.with_check)
from pg_policies p
where p.schemaname = 'storage' and p.tablename = 'objects'
  and p.policyname not like 'tasks files:%' and p.policyname not like 'notes files:%'
order by 1, 2;
