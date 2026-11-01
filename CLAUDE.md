# Workspace — rules for changing this codebase

Read this before making any change. It exists so that work done for one
department never leaks into another, and so new apps slot in cleanly.
**New here? Read `HANDOFF.md` first** — who the app is for, what's live, every decision
made so far, and how to ship changes to Hasith (who doesn't code).

## How it's built

```
src/platform/      shared shell: sign-in, app dropdown, admin-only department switcher,
                   notifications bell, user menu. Knows nothing about any department.
src/apps/<key>/    one folder per app (today: tasks, notes, messages, admin). Default export = the app.
src/platform/slots.ts  places where one app shows a panel inside another (e.g. Notes inside a task).
src/platform/files.ts  upload / open / delete files in the private "workspace-files" bucket.
src/platform/excel.ts  plain Excel downloads (bold frozen header, real dates, no formulas) for any app.
src/platform/pwa.ts, push.ts, public/sw.js  installing as an app, and phone alerts on this device.
src/platform/Search.tsx  Ctrl+K search; each app adds a provider to SEARCH in slots.ts.
src/platform/slots.ts also has TOP_BAR: small buttons an app puts in the top bar (Tasks: focus timer, quick reminders;
                   Messages: the chat button), and GATES:
                   screens that must be dealt with before anything else (Tasks: yesterday's daily updates), and
                   MESSAGE_CARDS / MESSAGE_ATTACH / MESSAGE_WORK: tasks, notes, reminders and mini tasks inside
                   messages (cards, "Attach", "Send as" / "Make it a …"), lazy-loaded so they cost the main bundle nothing.
src/features/<key>/ department-only features. Registered in src/features/registry.ts.
supabase/          numbered SQL files, run in order in the Supabase SQL Editor.
supabase/functions/workspace-push/  the Edge Function that delivers phone alerts (pasted into the dashboard).
supabase/templates/ copy these for a new app or a new department feature.
tests/db/          database isolation tests (see tests/README.md).
tests/e2e/         browser tests against a local stand-in for Supabase (see tests/e2e/README.md).
tests/push/        the Edge Function run in real Deno.
tools/sql-page/    builds the copy-paste SQL page Hasith uses to run SQL in Supabase.
```

- One Supabase project, one website. Every department's data sits in the same
  tables, separated by `department_id` and enforced by row-level security.
- The **platform admin** is listed in `platform_admins`. Only someone with SQL
  Editor access can add or remove an admin. The app never offers this.
- Admin sees every department (switcher in the top bar). Everyone else is locked
  to their own department, enforced in the database (`my_dept()`).
- App access: `department_apps` (on/off per department, `everyone` or not) +
  `app_members` (the selected people when `everyone = false`).
- Department features: a row in `department_features` = feature ON for that department.

## Golden rules

1. **Never put a department name or id in code or SQL.** If something should exist
   for only one department, build it as a feature module and switch it on for that
   department in Admin console → Departments & apps.
2. **Every table holding department data** has `department_id uuid not null`,
   set by a BEFORE trigger from the creator's / assignee's department
   (`dept_of(...)`). Never trust a department id sent from the browser, and
   never let an UPDATE change it.
3. **Every policy on such a table** checks
   `is_admin() or (department_id = my_dept() and <access check>)` where the access check is
   `user_has_app(auth.uid(), '<app>', department_id)` for an app, or
   `has_feature(department_id, '<feature>')` for a department feature.
   Copy `supabase/templates/*.sql` — don't hand-roll policies.
4. **Feature UI only appears through `useFeatures(app)`** and the slots in
   `src/features/registry.ts` (`pages`, `dayReview`, `taskPanel`, `homePanel`). Gate in both
   places: the UI (feature list) AND the database (`has_feature`).
5. **Don't edit shared app code to add a department-specific tweak.** If a feature
   needs a new place to plug in, add a *generic* slot to the registry (usable by any
   department), then use it from the feature module.
6. **Apps don't import each other.** They talk to the platform only via `usePlatform()`.
   Notifications go through `public.notify(...)` with the department and app key.
   When an app needs to show something inside another app, register a component in
   `src/platform/slots.ts`; it only appears for people who have that app. Keep slot components
   small (no heavy libraries): they load with the main bundle.
7. **Never add a way to grant admin from the app**, and never weaken a policy to
   make something work — fix the query or the trigger instead.
8. **References to `profiles`:** personal data → `on delete cascade`; history columns
   (created_by, author, actor) → `on delete set null`; ownership of live work (assignee) →
   leave as restrict so the admin can't delete someone who still has work. BEFORE UPDATE
   triggers that pin columns must let the database's own clean-up through
   (`if pg_trigger_depth() > 1 then return new; end if;`).
9. **Changes to a live database** go into the numbered setup files, then build the next cumulative
   `supabase/updates/NNN_name.sql` with `python3 tools/compose_update.py NNN_name "title"` (it includes every
   earlier update, so Hasith only runs the newest). If you change a file that isn't in its PARTS list, add it.
10. **SQL files must stay re-runnable** (`create table if not exists`,
   `create or replace function`, `drop policy if exists` before `create policy`).
11. Run the database tests (tests/README.md) after any SQL change, and add a test
   for each new table proving another department can't read or write it.
12. **Files** live in the private bucket `workspace-files` under `<app>/<record id>/…`. Storage policies
   decide access from that path with a security-definer function (`tasks_file_ok`, `notes_file_ok`).
   Delete the stored files *before* deleting their record: once the record is gone nobody may touch
   its folder any more. 10 MB per file (bucket limit + checked in the browser).
13. **Policies that must pass on `INSERT … RETURNING`** can't look the new row up by id inside a
   STABLE function (it can't see it yet). Decide access from the row's own columns instead
   (see `notes_access_row` in 05_app_notes.sql).
14. **Never change the live systems yourself** (his GitHub repo, Vercel, Supabase) unless he
   explicitly asks for that. Hand him files and click-by-click steps instead.
15. **Name every table, function, trigger and index after its app** (`tasks`, `task_*`,
   `notes_*`, `<key>_*`). The live Supabase project also holds tables from an older app (for
   example a `notes` table with uuid ids) — `create table if not exists` silently skips an
   existing table, and `create or replace function` would overwrite someone else's function.
   Never alter, drop or add policies to tables this app didn't create. Update 002 ends with a
   report listing anything in the database that isn't Workspace's.
16. **Phone alerts come free with notifications.** Anything inserted into `notifications` (through `notify(...)`)
   is pushed to that person's devices by the `workspace_push_notify` trigger. Never call `pg_net` or the
   Edge Function from app code. A new notification kind should get a short title in `workspace_push_title`
   (07_push.sql) and a dot colour in styles.css (`.notice-row.k-<kind>`).
17. **The service worker must never cache Supabase calls** or anything user-specific: it only handles
   same-origin GETs (the page and hashed `/assets/`). Bump `VERSION` in `public/sw.js` only if its caching changes.
18. **Task status:** `review` means the owner finished and it waits for sign-off. Use `finished()` / `isLate()`
   from `src/apps/tasks/labels.ts` instead of comparing with `'done'`: finished-but-waiting work isn't late and
   isn't the owner's open workload. When the owner finished is `submitted_at` (falls back to `completed_at`).
19. **"New" work:** a task someone else gave me that I haven't acknowledged (`inInbox(t)` in the Tasks store) appears
   only in the New tab — leave it out of my lists, Today and calendar. Other people's views are unaffected.
20. **Per-person tables** (`task_reminders`, `task_minis`, `task_work_log`, `task_focus`) are the exception to rule 3: their policies
   decide from the person, not the department alone. Reminders: only the person and whoever set it. Mini tasks: only the
   person, except **ticked** ones, which their managers can read (`task_sees_work_of`). Other-work lines: the person and
   whoever `task_sees_work_of` allows (managers: the department; seniors: members; the admin). The BEFORE trigger still
   sets the department, and inserts still check the department and the Tasks app.
21. **Daily updates** are `task_comments` rows with `daily_for` set (only the owner, only for today or the last weekday,
   `created_at` always now — "written next morning" depends on it). Whether one is needed: `task_update_required(t, day)`.
   The morning catch-up screen is `src/apps/tasks/DailyUpdateGate.tsx`, shown over every app through the platform slot
   `GATES` (slots.ts); a gate must never lock anyone out because its own check failed.
22. **Repeating tasks** are created only by `task_repeat_spawn(id, due, actor)` (02_app_tasks.sql) — on done in
   `tasks_after`, and each morning in `run_deadline_check` for `daily` / `weekdays`. Use `task_repeat_next_due(t)` for
   the next deadline; never insert occurrences elsewhere.
23. **People outside the app** live in `task_contacts` (a shared list per department, no login) and are linked with
   `tasks.contact_id`; the task's `assignee_id` is still an app user, who follows up. Never make profiles or logins for
   them. A task's contact must be on its own department's list (checked in `tasks_before`). Taking someone off the list
   is `active = false` (the FK is `on delete restrict`, so people on tasks can't be deleted).
24. **Projects** are `tasks` with `nature = 'project'` (never repeating). Their stages are `task_checklist` rows with
   `due_date` and `assignee_id` (empty = the project owner); `task_stage_rules` lets only whoever runs the project change
   stages (and only give them to people they could give work to), and a stage person tick only their own;
   `task_stage_after` adds the stage person as a helper (quietly, under `app.system`) and alerts them. Ordinary tasks'
   steps never keep a date or person. Status flag: `health` / `health_note` (history = `task_activity` kind `health`).
25. **Mini tasks given to someone** set `task_minis.created_by` (empty or the person = their own). Only people you could
   give work to (`can_assign_task`); the giver sees and can change / take back theirs until ticked, never ticks them.

26. **Messages** (09_app_messages.sql, src/apps/messages/) uses only `msg_*` names — the live project also has an older
   chat app's `messages`, `conversations`, `conversation_members` and `chat_reads`; never touch those (09 stops itself if
   it finds `msg_*` objects it didn't make). One-to-one chats (`kind = 'direct'`) are readable **only by the two people**
   (not managers, not the admin — `msg_can_see`); team chat and announcements by the department's people with Messages and
   the admin; only managers (and the admin) post announcements. Messages are never deleted: "delete" blanks the words
   within 15 minutes (`msg_messages_before`), same window for edits. Ticks come from `msg_reads` (`msg_sync` = delivered,
   `msg_seen` = seen, which also marks the conversation's bell alerts read). Alerts: direct → `message` (phone and chat
   button, kept out of the bell list), team → `mention` only for @mentioned people, announcements → `announce` to everyone.
   Work in a message is a `msg_items` row (`attached` / `sent` by the author, `made` by anyone in the chat) with a copy of
   its title; opening it still needs the viewer's own rights in that app. Messages doesn't import Tasks or Notes — their
   cards and forms come through the MESSAGE_* slots. It polls (5 s list / 4 s open chat); there is no realtime.

27. **Focus timer (Pomodoro)** — `src/apps/tasks/focus.ts` + `FocusButton.tsx` (TOP_BAR). The running clock lives in the
   browser (localStorage, shared by tabs; one 1-second tick); each focus slot becomes one `task_focus` row when it ends
   (finished, or stopped / skipped after a minute; a slot that ended while the app was closed is recorded on the next
   open). Rows are never updated; the person may delete today's. `task_focus_before` pins person and department, moves a
   fast device clock back to "now", caps minutes at the time that passed, and checks the task is one they can see;
   `client_start` (the device's start) is unique per person so two tabs record once. Readers: `task_sees_work_of`
   (My output). Each person's lengths: `task_focus_settings` (own row only, saved with `task_focus_save`).
   Reminders can be changed (words, date, time) by the person reminded **or whoever set them** (`ReminderEdit` in
   Reminders.tsx); only the person reminded marks them done or snoozes.

28. **Work given without a deadline** — `tasks.due_date` may be empty, but only while a one-off task given to someone
   else (never your own, a project, a repeat or a finished one) waits for its owner's **Got it**: the owner must pick a
   date to accept it (`tasks_before`), no later than `latest_by` if whoever gave it set one (only they or a manager
   change `latest_by`; the owner's later moves stay within it too). Picking is the task's first deadline (`original_due`,
   no move counted), logged as activity `date_set` and alerted as `date_set` to whoever gave it. In the app, `Task`
   always has a date; `UndatedTask` / `AnyTask` / `hasDate` (types.ts) cover the rest, and the store keeps them apart
   (`tasks` = dated, `undated`, `findTask`). Only the New tab, the lists' "No date yet" group, the Who's on what board
   and table, the task panel and the Excel export handle undated work — everything else (Today, calendar, reports,
   SQL checks) simply never sees it. Anything reading `tasks` straight from the database must allow a null date.

## Adding a new app

1. Copy `supabase/templates/new_app.sql` → `supabase/0X_app_<key>.sql`, adapt, run it.
2. Create `src/apps/<key>/index.tsx` (default export receives `{ page, params }`).
   Use `usePlatform()` for `me`, `dept`, `deptPeople`, `userHasApp`, `toast`.
   Always filter queries by `.eq('department_id', dept.id)` (the admin can read all).
3. Add it to `APPS` in `src/platform/registry.ts` (`refParam` = the URL parameter that opens one
   item from a notification; `defaultOn` only for apps every new department should get;
   `inMenu: false` for an app opened another way, like Messages from its top-bar button;
   wrap large apps in `lazy(() => import(...))` so they download only when opened).
4. Admin console → Departments & apps → switch it on (everyone or selected people).

## Adding a department-only feature

1. Copy `supabase/templates/new_department_feature.sql` (if it needs data), adapt, run it.
2. Create `src/features/<key>/…` and add an entry to `FEATURES` in
   `src/features/registry.ts` (key must match the SQL `has_feature` key).
3. Admin console → Departments & apps → tick it for the department that asked for it.
   It stays OFF everywhere else.

`daily_notes` is the small worked example of a department feature; `month_end` (06_feature_month_end.sql,
src/features/month-end/) is the full one: master list → monthly copy → owner ticks → review → approve.
`compliance` (08_feature_compliance.sql, src/features/compliance/) shows a feature built on the Tasks app's own data:
it links rows to repeating task series and uses the Tasks store (`useTaskApp`) for what the person can see.
A feature's alerts use `notify(..., app_key = the app it extends, kind = its own kind)`; list that kind in
the feature's `noticeKinds` so the bell opens its page. App pages opened from alerts go in `kindPages`.

## Writing triggers

- The session flag `app.system` (`set_config('app.system','on',true)`) marks the database's own
  housekeeping (the daily check, creating the next repeating task). Task triggers skip their user rules and
  alerts while it is on; always switch it back off in the same function.

## Search

Each app that wants to be searchable adds a small provider (`src/apps/<key>/search.ts`) to `SEARCH` in
`src/platform/slots.ts`, backed by a `<key>_search(q, dept)` SQL function **without** `security definer`, so
row-level security decides what can be found. Escape `%`, `_` and `\` in the pattern (see `tasks_search`).

## Conventions

- React + TypeScript + Vite, no UI library; styles in `src/styles.css` (CSS variables, light/dark).
- Dates for tasks are `YYYY-MM-DD` strings in the org time zone (`app_tz()` in 01_platform.sql).
- Keep it simple: plain functions, no global state library, hash routing `#/<app>/<page>?…`.
