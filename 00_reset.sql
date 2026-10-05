-- =====================================================================
--  WORKSPACE — clean slate (only if an earlier setup attempt is in the way)
--  Removes every table, rule and scheduled job this app (or the earlier
--  "Team Tasks" version) created, so 01–04 can run fresh.
--  ⚠ Deletes all app data in this project. Use it on a new project only.
-- =====================================================================

drop trigger if exists on_auth_user_created on auth.users;

drop table if exists
  public.daily_notes, public.task_activity, public.task_comments, public.tasks,
  public.notifications, public.app_members, public.department_features,
  public.department_apps, public.apps, public.platform_admins,
  public.comments, public.activity, public.profiles, public.departments
  cascade;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'app_tz','app_today','is_admin','is_admin_user','my_dept','my_role','dept_of','role_of',
      'name_of','fmt_date','in_my_dept','user_has_app','has_app','has_feature','manager_ids',
      'admin_ids','notify','handle_new_user','profiles_guard','profiles_after','can_see_task',
      'can_assign_to','can_assign_task','tasks_before','tasks_after','tasks_deleted',
      'comments_after','task_comments_after','run_deadline_check','daily_notes_before'])
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;

  -- old scheduled jobs, if Cron was set up before
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobname) from cron.job
    where jobname in ('team-tasks-daily-check', 'workspace-daily-check');
  end if;
end $$;
