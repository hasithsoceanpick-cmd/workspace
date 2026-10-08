-- =====================================================================
--  WORKSPACE — clean slate (only if an earlier setup attempt is in the way)
--  Removes every table, rule and scheduled job this app (or the earlier
--  "Team Tasks" version) created, so 01–08 can run fresh. Tables from other
--  apps (for example an older "notes" table) are left alone.
--  ⚠ Deletes all app data in this project. Use it on a new project only.
-- =====================================================================

drop trigger if exists on_auth_user_created on auth.users;

drop table if exists
  public.compliance_items, public.workspace_push_log, public.workspace_push_config, public.workspace_push_subscriptions,
  public.month_end_entries, public.month_end_periods, public.month_end_items,
  public.notes_task_links, public.notes_files, public.notes_shares, public.notes_pages,
  public.time_blocks, public.task_attachments, public.task_checklist, public.task_helpers,
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
      'comments_after','task_comments_after','run_deadline_check','daily_notes_before',
      'admin_delete_user','is_task_helper','helper_ids','can_manage_helper','can_run_task','tasks_file_ok',
      'task_children_before','task_helpers_rules','task_helpers_after','tasks_owner_not_helper',
      'task_checklist_rules','task_checklist_after','task_attachments_rules','time_blocks_before',
      'notes_access','notes_access_row','notes_file_ok','notes_pages_before','notes_files_before',
      'notes_shares_after','notes_pages_deleted','ensure_profile',
      'month_end_on','month_end_lead','month_end_items_before','month_end_periods_before',
      'month_end_entries_before','month_end_label','month_end_entries_after','month_end_periods_after',
      'month_end_start','month_end_check',
      'can_check_task','task_checker_ids','tasks_send_back','tasks_search','tasks_trends','notes_search',
      'workspace_push_endpoint_ok','workspace_push_title','workspace_push_post','workspace_push_cleanup',
      'workspace_push_notify','workspace_push_public_key','workspace_push_save','workspace_push_forget',
      'workspace_push_setup','workspace_push_enable','workspace_push_status','workspace_push_test','workspace_push_result',
      'compliance_on','compliance_lead','compliance_items_before','compliance_add'])
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;

  -- file rules (the files themselves stay in Storage)
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    drop policy if exists "tasks files: read" on storage.objects;
    drop policy if exists "tasks files: upload" on storage.objects;
    drop policy if exists "tasks files: delete" on storage.objects;
    drop policy if exists "notes files: read" on storage.objects;
    drop policy if exists "notes files: upload" on storage.objects;
    drop policy if exists "notes files: delete" on storage.objects;
  end if;

  -- old scheduled jobs, if Cron was set up before
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobname) from cron.job
    where jobname in ('team-tasks-daily-check', 'workspace-daily-check', 'workspace-month-end-check');
  end if;
end $$;
