-- =====================================================================
--  WORKSPACE — Tasks app (step 2 of 4)
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
  kind           text not null,  -- created | status | due_date | assignee | edited | comment
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

create index if not exists tasks_dept_idx          on public.tasks (department_id, due_date);
create index if not exists tasks_assignee_idx      on public.tasks (assignee_id);
create index if not exists task_comments_task_idx  on public.task_comments (task_id);
create index if not exists task_activity_day_idx   on public.task_activity (department_id, created_at);
create index if not exists task_activity_task_idx  on public.task_activity (task_id);

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
      perform public.notify(array[new.created_by], d, 'tasks', new.id, 'done',
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
    perform public.notify(array[new.assignee_id, new.created_by] || public.manager_ids(d),
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
  perform public.notify(array[t.assignee_id, t.created_by], t.department_id, 'tasks', t.id, 'comment',
    format('%s commented on "%s": %s', public.name_of(new.author_id), t.title, left(new.body, 120)),
    new.author_id);
  return null;
end $$;

drop trigger if exists task_comments_after on public.task_comments;
create trigger task_comments_after after insert on public.task_comments
  for each row execute function public.task_comments_after();

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
    cross join lateral unnest(array[m.assignee_id, m.created_by] || public.manager_ids(m.department_id)) as r(uid)
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

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (public.can_see_task(department_id, assignee_id, created_by));

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

-- ---------- Permissions -------------------------------------------------
revoke all on public.tasks, public.task_comments, public.task_activity from anon, authenticated;
grant select, insert, update, delete on public.tasks         to authenticated;
grant select, insert                 on public.task_comments to authenticated;
grant select                         on public.task_activity to authenticated;
grant usage on all sequences in schema public to authenticated;

revoke execute on function public.tasks_before()        from public, anon, authenticated;
revoke execute on function public.tasks_after()         from public, anon, authenticated;
revoke execute on function public.tasks_deleted()       from public, anon, authenticated;
revoke execute on function public.task_comments_after() from public, anon, authenticated;
revoke execute on function public.run_deadline_check()  from public, anon;
grant  execute on function public.run_deadline_check()  to authenticated;
