-- Empties the throwaway test database (never run this on Supabase).
truncate notifications, task_activity, task_comments, time_blocks, task_helpers, task_checklist, task_attachments,
  notes_task_links, notes_files, notes_shares, notes_pages, tasks, daily_notes, app_members, department_apps,
  department_features restart identity cascade;
delete from storage.objects;
delete from platform_admins;
delete from profiles;
delete from departments;
delete from auth.users;
