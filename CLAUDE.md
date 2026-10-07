# Workspace — rules for changing this codebase

Read this before making any change. It exists so that work done for one
department never leaks into another, and so new apps slot in cleanly.
**New here? Read `HANDOFF.md` first** — who the app is for, what's live, every decision
made so far, and how to ship changes to Hasith (who doesn't code).

## How it's built

```
src/platform/      shared shell: sign-in, app dropdown, admin-only department switcher,
                   notifications bell, user menu. Knows nothing about any department.
src/apps/<key>/    one folder per app (today: tasks, notes, admin). Default export = the app.
src/platform/slots.ts  places where one app shows a panel inside another (e.g. Notes inside a task).
src/platform/files.ts  upload / open / delete files in the private "workspace-files" bucket.
src/platform/excel.ts  plain Excel downloads (bold frozen header, real dates, no formulas) for any app.
src/features/<key>/ department-only features. Registered in src/features/registry.ts.
supabase/          numbered SQL files, run in order in the Supabase SQL Editor.
supabase/templates/ copy these for a new app or a new department feature.
tests/db/          database isolation tests (see tests/README.md).
tests/e2e/         browser tests against a local stand-in for Supabase (see tests/e2e/README.md).
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
   `src/features/registry.ts` (`pages`, `dayReview`, `taskPanel`). Gate in both
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
9. **Changes to a live database** go in `supabase/updates/NNN_name.sql` (re-runnable), and the
   same change goes into the numbered setup files so fresh installs match.
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

## Adding a new app

1. Copy `supabase/templates/new_app.sql` → `supabase/0X_app_<key>.sql`, adapt, run it.
2. Create `src/apps/<key>/index.tsx` (default export receives `{ page, params }`).
   Use `usePlatform()` for `me`, `dept`, `deptPeople`, `userHasApp`, `toast`.
   Always filter queries by `.eq('department_id', dept.id)` (the admin can read all).
3. Add it to `APPS` in `src/platform/registry.ts` (`refParam` = the URL parameter that opens one
   item from a notification; `defaultOn` only for apps every new department should get;
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
A feature's alerts use `notify(..., app_key = the app it extends, kind = its own kind)`; list that kind in
the feature's `noticeKinds` so the bell opens its page. App pages opened from alerts go in `kindPages`.

## Writing triggers

- The session flag `app.system` (`set_config('app.system','on',true)`) marks the database's own
  housekeeping (the daily check, creating the next repeating task). Task triggers skip their user rules and
  alerts while it is on; always switch it back off in the same function.

## Conventions

- React + TypeScript + Vite, no UI library; styles in `src/styles.css` (CSS variables, light/dark).
- Dates for tasks are `YYYY-MM-DD` strings in the org time zone (`app_tz()` in 01_platform.sql).
- Keep it simple: plain functions, no global state library, hash routing `#/<app>/<page>?…`.
