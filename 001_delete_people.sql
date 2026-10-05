-- =====================================================================
--  WORKSPACE — update 1: decline / delete people
--  For a database that was set up BEFORE this update. Run once in the
--  SQL Editor. Safe to run again. (Fresh installs already include it.)
-- =====================================================================

-- ---------- Removing people (admin only) --------------------------------
-- Deletes someone's login completely: used to decline a sign-up or remove a wrong account.
-- Refuses while they still have work assigned in an app; deactivate them instead to keep history.
create or replace function public.admin_delete_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only the administrator can delete people.' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'You can''t delete your own account.';
  end if;
  if public.is_admin_user(p_user) then
    raise exception 'Administrators can only be removed in the Supabase SQL Editor.';
  end if;
  begin
    delete from auth.users where id = p_user;
  exception when foreign_key_violation then
    raise exception 'This person still has tasks assigned. Reassign or delete them first, or use Deactivate to keep their history.';
  end;
end $$;

revoke execute on function public.admin_delete_user(uuid) from public, anon;
grant  execute on function public.admin_delete_user(uuid) to authenticated;

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

