# Workspace — handoff notes

Everything someone (a person or Claude in another account) needs to carry on with
this app without the original chat. Read this first, then `CLAUDE.md` (the rules for
changing the code) and `README.md` (setup and admin guide).

Last updated: 7 October 2026 (round 5).

---

## 1. What this is

**Workspace** is a small internal web app for Hasith, a finance manager, and his
organisation. One website, several **departments**, each fully private from the others.
Inside, people use **apps** picked from a dropdown: today **Tasks** and **Notes**. It installs on phones
as an app (PWA) and can send phone alerts (web push).

- Hasith is the only **platform admin**. It is his normal login (also Finance's Manager).
  Only he can switch departments, approve sign-ups, and turn apps on per department or per person.
- Roles inside a department: **Manager → Senior Executive → Member**.
- Stack: React 19 + Vite 7 + TypeScript (no UI library) on **Vercel**; **Supabase** for logins,
  Postgres with row-level security, file storage and the daily cron job. Free tiers.
- Hasith does not code. He deploys by uploading files to GitHub in the browser and pasting
  SQL into the Supabase SQL Editor. Everything must be handed to him click-by-click.

## 2. Where it lives (his accounts)

| Piece | Where | Notes |
|---|---|---|
| Code | GitHub, private repo **workspace** | Uploaded through the GitHub website (no git on his PC) |
| Website | Vercel project **workspace** (team *OP-Finance*) | Builds automatically on every GitHub change |
| Database, logins, files | Supabase project **workspace**, region Singapore | Email confirmation is **off** |
| Vercel environment variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Values from Supabase → Connect. (He once typed the URL into the Key box; the *Key* is the variable name.) |
| Morning alerts | Supabase pg_cron job `workspace-daily-check` | `30 1 * * *` UTC = 07:00 Colombo |
| Phone alerts sender | Supabase Edge Function **workspace-push** (Verify JWT **off**) | Code in `supabase/functions/workspace-push/index.ts`; deployed by pasting it in the dashboard editor. Keys live in `workspace_push_config` (no app access). |
| Time zone | `Asia/Colombo` | `app_tz()` in `01_platform.sql`; dates are `YYYY-MM-DD` strings |

## 3. State at handoff — check these first

1. **Database.** Steps 01–04 and update `001_delete_people.sql` were run on the live database.
   His first attempt at **U2** (`002_helpers_checklist_files_today_notes.sql`) failed with
   `foreign key constraint "note_shares_note_id_fkey" cannot be implemented … bigint and uuid`:
   the live project already holds a **`notes` table with uuid ids from an older app**. Supabase
   rolled the whole script back. U2 was then rebuilt so every Notes object is named `notes_*`
   (`notes_pages`, `notes_shares`, `notes_files`, `notes_task_links`) and files use a new bucket
   `workspace-files`; it never touches the old table. It ends with a read-only report of anything
   in the database that isn't Workspace's. To check U2 has run:
   `select to_regclass('public.notes_pages');` → not null means done. **U2 ran successfully on 6 Oct.**
   **Update 3 (`003_history_repeat_month_end.sql`, U3)** was delivered on 7 Oct: deadline history,
   repeating tasks, Monday summary alert, `ensure_profile()` for older logins, and the Month-end
   declaration feature. To check it has run: `select to_regclass('public.month_end_items');` → not null.
   After running it he ticks **Month-end declaration** for Finance in Admin → Departments & apps.
   **Update 4 (`004_alerts_signoff_compliance_search.sql`, U4)** was delivered on 7 Oct (round 5). It
   **includes all of U3**, so it works whether or not U3 was run. To check it has run:
   `select to_regclass('public.compliance_items');` → not null. After it: deploy the `workspace-push` Edge
   Function (Verify JWT off), Admin → **Phone alerts** → Turn on → test, and tick **Compliance calendar**
   for Finance. Tested on copies of the post-U2 and post-U3 schema with older-app tables present: run twice,
   data kept, older app's tables/rules byte-for-byte unchanged.
   Leave the old `notes` table (and any old `attachments` bucket) alone unless he decides otherwise.
2. **Code on GitHub.** An earlier upload put 48 copies of files loose at the top level of the repo
   (folders flattened); the site kept building from the older `src/` folder. Those loose files are
   harmless — the build only reads `src/`, `index.html` and the config files — so he was told to
   **leave them** and simply upload this project on top, folders kept (tested: builds fine with them
   present). Upload = Add file → Upload files → drag everything from the extracted folder (dragging
   keeps folders; the file picker flattens them) → check paths like `src/apps/notes/…` → Commit.
   Cleaning up the loose files is optional and can wait.
2a. **The Supabase project is shared with his earlier finance-team app** (the single-file
   "hasith-finance" app on Netlify). The U2 report (6 Oct) listed its tables: attachments (59 rows),
   audit_items, bank_accounts, bank_recs, chat_reads, coin_ledger, conversation_members, conversations,
   daily_logs (71), declaration_entries, declaration_items, declarations, holidays, leave_requests,
   log_fields, messages, note_pins, notes (19), payment_recipients, payments, pet_* tables, plan_entries,
   project_members, projects, reminders, … (list continued below the screenshot), plus a storage bucket
   `attachments` whose rules let **any logged-in user read** its files. Consequences:
   - Both apps share the same logins, and Workspace's `handle_new_user` sign-up trigger replaced the old one.
   - **Confirmed 7 Oct: the old app shows nothing.** It used the same table names `tasks`, `profiles` and
     `notifications`; Workspace's clean-slate step 0 (run on 4 Oct to fix the first setup error) dropped
     them. His project is on the **Free plan (no backups)** and he has **no copy** (no Excel tracker, no app
     files, no export), so that data can't be recovered. All the old app's other tables still have their
     data. He chose to **decide later** what to do with the old app. Options to offer when he's ready:
     keep both (move Workspace to its own new Supabase project, rebuild the old app's three tables there),
     or retire it and bring useful data (e.g. the declaration lists in `declaration_items`) into Workspace.
   - His old team's logins still exist; they get a Workspace profile (pending approval) the first time they
     sign in (`ensure_profile()`, update 3). Don't **Decline** them if the old app may be revived:
     declining deletes the login itself.
   - Anyone who signs up on Workspace gets a logged-in session in this project, so the old app's open rules
     could expose its data. Long-term fix: give Workspace its own Supabase project, or retire/lock down
     the old app. Never modify the old app's tables or rules without his explicit go-ahead.
3. **Notes** must be switched on by him: Admin console → Departments & apps → tick Notes
   (everyone, or only selected people). New departments get Tasks only.
4. The copy-paste SQL page (an Artifact in his old Claude account) can be rebuilt with
   `python3 tools/sql-page/build.py` and published again (see §8).

## 4. Everything he asked for (and the decisions made)

### Platform
- Multi-department. Department-specific work must **never leak** into another department,
  now or in future builds. Enforced in the database (RLS) and by the rules in `CLAUDE.md`.
- One admin login (his) that alone moves between departments. No manager gets it.
  Admin rights are set only in SQL (`platform_admins`); the first sign-up becomes admin.
- Only he approves sign-ups and picks their department + role. He can **decline** pending
  sign-ups and **delete** logins (refused while the person still has tasks assigned;
  **Deactivate** keeps history instead).
- Future apps appear in an app dropdown. **He chooses which departments and which people**
  get each app.
- In-app bell notifications only (no email).

### Tasks app
- Managers see and assign to everyone in the department; Senior Executives see/assign their own
  and Members' work; Members see their own.
- Deadlines, status (To do / Doing / Waiting / Done), priority, notes, comments, history.
- **Assignees can move their own deadline**; the assigner is notified.
- Alerts: assigned, deadline moved, deadline missed (07:00 daily check, also run when the app
  opens), due today, completed, waiting, comments, added as helper.
- Calendar: month view, and week view as people × days. Leads filter by person. Drag to move
  a deadline, or into another person's row to hand it over.
- **Day review**: any date, who did what (completed, started, moved, commented, missed).
- **Team** page: workload per person.
- **Today** (first tab, opens by default): time-blocking timeline **07:00–20:30**, 30-minute rows,
  15-minute snapping. Drag tasks in (or press +, which uses the next free hour), click an empty
  slot to add an own block such as "Lunch", drag to move, pull the bottom edge to resize, ✕ to remove,
  double-click own block to rename. Any day can be opened (plan ahead or look back). Leads can pick
  a person and view their day **read-only**; only the owner edits.
- **Helpers** (collaborative tasks): one owner + helpers. **Only Managers and Senior Executives add
  or remove helpers** (seniors: themselves or Members; managers/admin: anyone in the department).
  Helpers see the task under *Helping on*, on their calendar (dashed) and on Today; they get the
  task's alerts (comments, deadline moved/missed, done). Helpers can comment, tick checklist steps
  and add files/links. Helpers **cannot mark done** (his explicit decision) and cannot move the deadline.
- **Sub-tasks = a checklist inside the task**, progress shown (e.g. 3/5). Anyone on the task can tick.
- **Screenshots, files and links** on task details (not on comments). Ctrl+V pastes a screenshot
  anywhere in the task panel. **10 MB per file.** Private storage.

### Notes app
- Its own app in the dropdown; admin enables it per department / person.
- Pages and **sub-pages**; headings, bullets, numbered lists, **tickboxes**, simple **tables**,
  links, pasted **screenshots**, attached files, and **links to tasks** (from either side).
- Pages are **Private** until the owner shares with the **whole department** or **chosen people**,
  each as *can view* or *can edit*. Sub-pages follow their top-level page.
- **Admin can read every page, including private ones** (read-only unless it's his own).
  The label shown is just **"Private"** — he asked that it not mention the admin.
- Autosave. If two people edit at once, the later save is refused and that person chooses
  "Show their version" or "Keep mine" (no live co-editing).

### Round 4 (7 Oct 2026)
- **Deadline history on the task card**: "Moved 2×" pill + first deadline struck through; click for who moved
  it, when, from/to. Also in the task panel. (He did *not* want a required reason for moves.)
- **Who's on what** (replaces the Team tab, leads only): a column per person with their open work (own +
  helping, dashed), overdue first; drag a card to another person to hand it over; Table view keeps the numbers.
- **Repeating tasks**: weekly / monthly / every 3 months / yearly. The next one is created when the current
  one is marked done, on the series' schedule (anchored to the first deadline, so 31 Jan → 28 Feb → 31 Mar),
  copying owner, assigner, helpers and checklist (unticked). Once per occurrence.
- **Export to Excel**: tasks + deadline moves (Tasks list), weekly summary, month-end month. Plain values,
  bold frozen header, real dates — his preference for simple, easy-on-the-eyes spreadsheets.
- **Weekly summary** (leads): per person done / on time / late / moved / new / overdue, plus lists;
  managers get a bell alert every Monday from the daily check.

### Round 5 (7 Oct 2026)
He asked for the app "to be downloaded as a web app too, so that team can use this even on their phones" and for
"real value additions". His picks: **Install + phone alerts**, **Checker sign-off**, **Acknowledge new tasks**,
**Compliance calendar** ("you give me the dates once" → he enters the dates; we only suggest names), **Performance
trends**, **Search everything**.
- **Install (PWA)**: `public/manifest.webmanifest`, icons in `public/icons/`, service worker `public/sw.js`
  (keeps the app's own files for a fast/offline start — network-first page, cache-first hashed assets — and never
  stores anything from Supabase). Account menu → *Install app* (Android prompt; iPhone shows Share → Add to Home
  Screen). App-icon badge shows the unread count where supported.
- **Phone alerts (web push)**: everything that lands in the bell is pushed to the person's devices that have
  *Phone alerts on this device* switched on (account menu). Path: `notifications` insert → statement trigger
  `workspace_push_notify` (07_push.sql) → `pg_net` → Edge Function `workspace-push` → push service → device.
  The function is dependency-free (Web Crypto: RFC 8291 aes128gcm + VAPID ES256), holds no keys (each batch carries
  them from the DB) and only posts to official push hosts. Keys are generated in the admin's browser on
  *Turn on phone alerts* and stored in `workspace_push_config` (RLS on, no grants). Devices whose push service
  says 404/410 are forgotten; unused for 120 days too. Signing out removes that device. Tapping an alert opens
  `#/go?notice=<id>` which opens what the notification is about. iPhone needs the app on the Home Screen (iOS 16.4+).
  Admin → Phone alerts shows set-up steps, test result in plain words (401 → turn off Verify JWT; 404 → not
  deployed), who has alerts on, and recent sends.
- **Checker sign-off (maker-checker)**: new status `review`. When the owner marks a task done that someone else
  gave them, it goes to `review`; whoever gave it (or a department manager, or the admin) **signs off** (→ done)
  or **sends back** with a required reason (`tasks_send_back` RPC; reason kept in history as `sent_back`). The
  owner may take it back. Per task `needs_check` (default on; only the giver/manager can change it). Repeating
  tasks spawn on sign-off. `review` is not overdue / due-today. If the giver left, managers are asked.
  Alerts: review, signed_off, sent_back.
- **Got it (acknowledge)**: `acknowledged_at` — null for work given by someone else until the owner presses
  *Got it* (or changes status / deadline); reset on reassign. Existing tasks were marked seen when added.
  Morning reminder to the owner each day while unopened; one FYI to the giver.
- **Early reminder**: `remind_days` per task (1 day … 1 month before) → `due_soon` alert once per deadline.
- **Compliance calendar** (feature `compliance`, 08_feature_compliance.sql): `compliance_items` linked to a
  repeating task series (`tasks.series_id` = first task of the series). Add obligation = `compliance_add` RPC
  (high-priority monthly/quarterly/… task with early reminder, atomically). List with next deadline, days left,
  owner, status and on-time dots; *Next 12 months* view projects the schedule; export. Leads add/edit/pause;
  members view.
- **Trends** (Reports → Trends, leads): `tasks_trends(dept, months)` (security invoker, RLS applies) per
  person per month: due, on time, late, still open, finished, deadline moves, sent back, tasks given, average
  hours to open. "Finished" means sent for sign-off or done (`submitted_at`, falling back to `completed_at`).
  Weekly summary moved under **Reports** (route `week` kept for the Monday alert).
- **Search** (Ctrl+K / magnifier): `tasks_search` and `notes_search` (security invoker) with a provider list
  in `src/platform/slots.ts` (`SEARCH`); only finds what the person can already open.

### Department-only features
- **`month_end` — Month-end declaration (for Finance)**, "like the old app": master list of lines
  (code, category MEC/CMP/any, title, owner, due day of the following month); a senior or the manager
  **starts** a month (copies the list); **only a line's owner ticks it** (self-declaration) and adds remarks;
  when all are ticked a **senior executive reviews**, then the **manager approves** → month locked
  (manager can reopen; reviewer can send back). Alerts: ready for review, ready for approval, approved,
  due today, overdue. Separate cron job `workspace-month-end-check` (07:05 Colombo).
- **`compliance` — Compliance calendar (for Finance)**: see Round 5 above.
- `daily_notes` (end-of-day note per person, shown in Day review) is the small worked example.

## 5. How the code is organised

See `CLAUDE.md` for the full rules. In short:

```
src/platform/   shell, login, app dropdown, admin department switcher, bell, Search (Ctrl+K), pwa.ts, push.ts,
                notices.ts, files.ts, excel.ts, slots.ts, registry.ts
src/apps/tasks/ Today, list, calendar, day review, who's on what, reports (week, trends); TaskDrawer, store, search.ts
src/apps/notes/ page tree, NotePage, TipTap Editor, ShareDialog, NoteFiles, LinkedTasks, LinkedNotesPanel, search.ts
src/apps/admin/ People, Departments & apps, Phone alerts
src/features/   department-only features (daily-notes, month-end, compliance)
public/         manifest, icons, service worker (sw.js)
supabase/       01–08 setup files, updates/NNN, functions/workspace-push (Edge Function), templates/,
                00_reset.sql (wipes data!)
tests/db/       database security tests (~330 checks)
tests/e2e/      browser tests + a local stand-in for Supabase (incl. pg_net and fake phones)
tests/push/     the Edge Function in real Deno (25 checks)
tools/sql-page/ builds the copy-paste SQL page for Hasith
```

Key technical points (all in `CLAUDE.md` too):
- Every data row has `department_id`, set by a BEFORE trigger, never from the browser.
- Policies: `is_admin() or (department_id = my_dept() and <app access>)`.
- BEFORE UPDATE triggers that pin columns start with `if pg_trigger_depth() > 1 then return new;`
  so foreign-key clean-up (on delete set null) still works.
- Notes access is decided from the row's own columns (`notes_access_row`) because a policy checked
  on `INSERT … RETURNING` can't see the new row through a lookup.
- `notes.updated_at` only changes when the title or content changes (sharing changes don't count),
  which is what the edit-conflict check relies on.
- Files: bucket `workspace-files` (private, 10 MB limit), paths `tasks/<id>/…` and `notes/<id>/…`,
  access via `tasks_file_ok` / `notes_file_ok`. Delete files **before** deleting the record.
- The Notes editor (TipTap 3) is lazy-loaded so the main bundle stays small.
- Links only allow `http(s)://` and `mailto:`.
- Phone alerts never block anything: the push trigger swallows its own errors (`raise warning`), and the
  browser side ignores push failures on app start.
- The service worker must not cache Supabase calls (it only handles same-origin GETs). `vercel.json`
  serves `sw.js` with no-cache so new versions reach phones on the next open.

## 6. How to work with Hasith

- He is not a developer. Give **numbered, click-by-click steps** with the exact button names
  (Supabase: SQL Editor → New query → paste → Run; GitHub: press "." → drag files → Commit & Push).
- SQL is delivered as a **copy-paste page with a Copy button per script** (he asked for "sql pages
  to copy paste" and said **"no text files"** when SQL was dumped into the chat).
  Tell him what result to expect ("Success. No rows returned").
- Only ever ask him to run the **one update script** that's new. Never `00_reset.sql` on the live
  system (it deletes all data); it exists only for broken or brand-new setups.
- He troubleshoots by sending screenshots; answer what the screenshot shows, briefly.
- Before building a new feature round he likes to be asked clarifying questions until the
  requirement is "crystal clear", then he answers in short form (e.g. "1. helpers can't mark done
  2. no, just private 3. timeline is 700-2030").
- Keep replies short and plain. His general preferences: concise; emails short, polite,
  professional, no signature; Excel work with simple formulas.
- **Never push to his GitHub repo or change his live systems yourself** unless he explicitly asks
  for that in so many words. Hand him the files and the steps.

## 7. Release checklist (how every change so far was shipped)

1. Build the feature following `CLAUDE.md`.
2. Database change → new re-runnable `supabase/updates/NNN_name.sql` **and** the same change in the
   numbered setup files (fresh installs must match).
3. Run `tests/db/run.sh` and `tests/e2e/run.sh` against a throwaway local Postgres (never Supabase).
   Also test the update on a copy of the live schema: load the previous setup files + earlier
   updates, add some data, run the new update twice, check the data survived.
4. `npm run build` must pass (Vercel runs the same command).
5. Update README (updates table, feature list) and this file.
6. Rebuild the SQL page (`tools/sql-page/build.py`: new update in `steps_update` with
   `badge='now'`, previous one moved to `steps_done`) and publish it.
7. Zip the project (without `node_modules`, `dist`, `.env*`), send it, and give him the 3–4 steps
   (GitHub's web upload takes at most 100 files at a time; the project is now over 100 files, so he uploads
   in two goes: the `src` folder first, then everything else):
   run the update SQL → upload code via github.dev → wait a minute → switch anything new on in Admin.

## 8. Testing

- `tests/db/run.sh` — 74 isolation + 89 feature + 49 round-4 + 111 round-5 checks (323) on a local Postgres
  with a stand-in for Supabase's `auth`, `storage` and `pg_net`.
- `tests/push/run.sh` — the Edge Function in real Deno (from npm), checked against the reference decoder. 25 checks.
- `tests/e2e/run.sh` — builds the app against `tests/e2e/mock-supabase.mjs` (auth, REST subset,
  storage with real RLS), seeds a Finance + HR demo (`*@demo.lk` / `password1`) and drives Chrome
  through every feature. All 259 browser checks pass (incl. 69 for round 5: install, phone alerts end to end
  with fake phones running the real sender code, sign-off, Got it, compliance, trends, search).
- Local Postgres used during development: Postgres 16 on port 54322, user `postgres`.

## 9. Known limits and ideas not built

- No live co-editing in Notes (conflicts are caught instead). No version history.
- Dragging tasks from the Today list doesn't work on phones (use **+**); blocks can be moved by touch.
- Images removed from a note's text stay in storage until the page is deleted.
- Copying an image from one page into another: people who can't open the first page can't see it.
- Search uses simple word matching (no ranking by relevance, no typo tolerance); 40 tasks / 30 pages max.
- Phone alerts: the browser can't be tested against Google/Apple from here; the encryption is verified with the
  reference decoder. Delivery on iPhone requires the Home Screen app. Alerts show task titles on lock screens.
- Compliance calendar dates come from the repeating task's schedule; a one-off shift is done on that occurrence's task.
- No email notifications; no file previews beyond images.
- Repeating tasks only create the next one when the current one is done/signed off (an unfinished one simply goes overdue).
- Month-end: only the owner can tick a line (reassign it to tick on someone's behalf). The old app's
  declaration lists were not imported (his call, "decide later").
- Supabase Free plan has **no backups**: the Excel exports are his only copy of Workspace data.
- Earlier, separate project (not this app): a single-file HTML + Supabase task app on Netlify
  ("hasith-finance") for his finance team. Don't mix the two; this one replaced it as the new build.

## 10. Moving the hosting accounts too (only if needed)

The app itself doesn't live in Claude; it lives in his GitHub, Vercel and Supabase accounts and
keeps running regardless of which Claude account he uses. Only if those accounts change:
- **GitHub**: Settings → Transfer ownership (or upload this folder to a new private repo).
- **Vercel**: in the new account, Add New → Project → import the repo → add the two environment
  variables → Deploy.
- **Supabase**: either transfer the project to the new organisation (Project Settings → General →
  Transfer project), which keeps logins, data and files; or create a new project, run setup files
  1–5, and migrate data with `pg_dump`/`pg_restore` (logins live in `auth.users`, files in storage —
  both need moving, so prefer the transfer). Update Vercel's two variables if the project changes.
