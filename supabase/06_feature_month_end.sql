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
