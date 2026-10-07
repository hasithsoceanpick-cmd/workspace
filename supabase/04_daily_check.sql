-- =====================================================================
--  WORKSPACE — morning deadline check (step 4 of 6)
--
--  Every morning at 7:00 am Sri Lanka time it:
--    • sends "Missed deadline" alerts for anything not done by its due date
--    • sends each person one "Due today" reminder
--  (The app also runs the same check whenever someone opens it, so alerts
--   still go out even if this step is skipped.)
-- =====================================================================

-- If this line errors, turn Cron on instead from Supabase → Integrations → Cron,
-- then run the rest of this file.
create extension if not exists pg_cron with schema pg_catalog;

-- 01:30 UTC = 07:00 in Colombo. Running this again just updates the job.
select cron.schedule(
  'workspace-daily-check',
  '30 1 * * *',
  $$ select public.run_deadline_check(); $$
);

-- To check it's there:   select jobname, schedule from cron.job;
-- To remove it:          select cron.unschedule('workspace-daily-check');
