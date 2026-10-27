# Workspace — handoff notes

Everything someone (a person or Claude in another account) needs to carry on with
this app without the original chat. Read this first, then `CLAUDE.md` (the rules for
changing the code) and `README.md` (setup and admin guide).

Last updated: 25 October 2026 (round 12).

---

## 1. What this is

**Workspace** is a small internal web app for Hasith, a finance manager, and his
organisation. One website, several **departments**, each fully private from the others.
Inside, people use **apps** picked from a dropdown: today **Tasks** and **Notes**, plus **Messages** (opened from the
chat button in the top bar). It installs on phones
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
   **Update 5 (`005_reminders_home_escalation.sql`, U5)** was delivered on 9 Oct (round 6). It **includes U3 and
   U4** (built with `tools/compose_update.py`), so it is the only one he needs to run, whatever he ran before.
   To check it has run: `select to_regclass('public.task_reminders');` → not null. Tested on copies of the post-U2,
   post-U3 and post-U4 schema (older-app tables present): run twice each, data kept, older app untouched, work
   that was already 3+ days late flagged quietly (no flood of escalation alerts). It schedules the every-minute
   reminders job `workspace-reminders` when pg_cron is on (it is, from step 4).
   **Update 6 (`006_mini_tasks_daily_repeats.sql`, U6)** was delivered on 13 Oct (round 7). It **includes U3, U4 and
   U5**, so it is the only one to run. To check it has run: `select to_regclass('public.task_minis');` → not null.
   Tested on a copy of the post-U5 schema: run twice, all database tests pass afterwards.
   **Update 7 (`007_daily_updates_output.sql`, U7)** was delivered on 15 Oct (round 8). It **includes U3–U6**, so it is
   the only one to run. To check it has run: `select to_regclass('public.task_work_log');` → not null. Tested on a copy
   of the post-U6 schema with the older app's `notes` table present: run twice, all database tests pass, older table
   untouched. The 4:30 pm reminder rides on the existing every-minute `workspace-reminders` job and the morning summary
   on `run_deadline_check`, so no new cron job is needed.
   **Update 8 (`008_follow_ups.sql`, U8)** was delivered on 16 Oct (round 9). It **includes U3–U7**, so it is the only one
   to run. To check it has run: `select to_regclass('public.task_contacts');` → not null. Tested on a copy of the post-U7
   schema with the older app's `notes` table: run twice, all database tests pass, older table untouched.
   **Update 9 (`009_projects_mini_tasks.sql`, U9)** was delivered on 20 Oct (round 10). It **includes U3–U8**. To check it
   has run: `select column_name from information_schema.columns where table_name='tasks' and column_name='nature';` → one
   row. Tested on a copy of the post-U8 schema with the older app's `notes` table: run twice, all database tests pass.
   **Update 10 (`010_messages.sql`, U10)** was delivered on 22 Oct (round 11). It **includes U3–U9**. It adds the Messages
   app and **switches it on for every department that has Tasks** (first run only). To check it has run:
   `select to_regclass('public.msg_threads');` → not null. Everything is named `msg_*`; the older app's `messages`,
   `conversations`, `conversation_members` and `chat_reads` are never touched, and the Messages part stops itself (before
   changing anything of its own) if it finds `msg_*` objects it didn't make. Tested on a copy of the post-U9 schema with
   older-app tables of those names present: run twice, all database tests pass, older tables untouched.
   **Update 11 (`011_focus_timer.sql`, U11)** was delivered on 25 Oct (round 12). It **includes U3–U10** (so it also brings
   Messages if U10 was skipped). Adds the focus timer's tables. To check it has run:
   `select to_regclass('public.task_focus');` → not null. Tested on a copy of the post-U10 schema (older-app tables
   present): run twice, all database tests pass. The reminder changes in round 12 need no database change.
   **Code uploads (16 Oct):** the live app was still on the U5 code (Pin/Remind, but no "Assigned by" line). His next
   attempt dragged the *contents* of `src` (paths showed `/apps/...`); he was told to drag the `src` folder itself so
   paths read `src/apps/...`. If the screens don't change after an upload, check that first.
   Leave the old `notes` table (and any old `attachments` bucket) alone unless he decides otherwise.
2. **Code on GitHub.** On 12 Oct the round-6 code was uploaded but the live app still showed the old screens:
   Vercel built fine, the new `index.html`, manifest and icons were live, but the **`src` folder** from the zip never
   landed (or landed in the wrong place), so the build used the old `src`. He was told to drag the `src` folder
   itself onto GitHub's upload page and check the paths start with `src/`. To verify a code upload landed, look on
   GitHub for a file that only exists in the newest round (round 7: `src/apps/tasks/MiniTasks.tsx`), or open the app:
   Today should show **Mini tasks** at the top.
   An earlier upload put 48 copies of files loose at the top level of the repo
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

### Round 6 (9 Oct 2026)
**Hasith:** "add reminder option. I need to be able to save quick reminders. also I think we added acknowledge option to
the assigned tasks. So until tasks are acknowledged they need to appear in a separate tab! what else can you think of to
improve the app". Answers: reminders **for me or my team**; unacknowledged work **only in a New tab**; extras chosen:
**Manager home screen** (managers land on it), **Escalate long-overdue**, **Notes → tasks**, **Pin & follow tasks**. He did
not pick the other ideas offered (recycle bin/backup, @mentions, templates, bulk actions, out-of-office cover, dependencies,
email digest, audit request list, approval requests, Outlook calendar feed, workload warning, reconciliation tracker,
working-day/Poya-aware deadlines, close calendar by working day, "waiting on" register, proof needed to finish,
review points, time spent) — they remain options for later.
- **Quick reminders**: `task_reminders` (02_app_tasks.sql). Personal: only the person reminded and whoever set it can see
  it (not even managers). Leads can set them for whoever they could give work to (`can_assign_task`). Sent by
  `task_reminders_due()` every minute (pg_cron job `workspace-reminders`; the app also calls it every minute while open)
  as a `reminder` notification → bell + phone. Repeat daily / weekdays / weekly / monthly (moves to the next time, no
  catch-up flood); snooze resets the sent mark. Top-bar clock button (platform slot `TOP_BAR`), page `#/tasks/reminders`,
  "⏰ Remind" in a task. "Make it a task" turns one into a task.
- **New tab**: `inInbox(t)` = given to me by someone else, not acknowledged, not finished. Shown only in `#/tasks/new`
  (tab with a count + a banner elsewhere); left out of my list, Today and calendar. Got it / Got it for all.
- **Home** (`#/tasks/home`, managers/seniors/admin; they land there once per app open; members land on Today): tiles
  (sign-offs waiting, overdue, escalated, not opened, due in 7 days) and panels; features add panels via `homePanel`
  (compliance next 30 days, month-end status).
- **Escalation**: `tasks.escalated_at`; the daily check escalates work not finished 3+ days after its deadline, once per
  deadline, to the department's managers + the owner + followers (`escalated`); a new deadline clears it. Red flag on
  rows, board and calendar. Existing late work was flagged quietly when the column was added.
- **Pin & follow**: `task_follows` (your own marks only). Followers get a task's alerts while they can still see it
  (`task_follower_ids`, `task_visible_to`). Pinned group on top of My tasks; "Following" filter.
- **Notes → tasks**: "→ Task" in the note toolbar turns the line (or selection) into a task for someone you could give
  work to, links it (`notes_task_links`) and appends "→ Task #N" (an internal `#/tasks/list?task=N` link; Ctrl+click opens).

### Round 7 (13 Oct 2026)
**Hasith:** "i need mini tasks on today page with the option to turn them into tasks if it is not done within the day or
delete it. Today should show only the mini tasks and scheduled for today items. if task is assigned by a person that person
and the person who it was assigned to should see who assigned it on the top of the task card. also need daily recurring
tasks". Answers: Today keeps **due today + a short Overdue line + the timeline** ("Next 7 days" / "Later" removed);
left-over mini tasks get **Do today / Make task / Delete**; daily repeats = **Every day and Weekdays (Mon–Fri) added to the
existing options**; a missed daily task → **a new one every day anyway** (the missed one stays overdue).
- **Mini tasks**: `task_minis` (02_app_tasks.sql): `user_id`, `day`, `body` (1–300 chars), `done_at`. **Private**: every
  policy is `user_id = auth.uid()` (insert also needs `my_dept()` + the Tasks app), like quick reminders — since round 8,
  **ticked** ones are readable by the person's managers (My output). The BEFORE trigger always sets `user_id = auth.uid()` and the department. UI:
  `src/apps/tasks/MiniTasks.tsx` at the top of Today (own day only; hidden when viewing someone else's day). Left-overs =
  your undone minis from earlier days (any age), shown only on today's view. *Make task* creates a task for you due
  today (or the mini's own later day), deletes the mini and opens the task.
- **Today list** (`pages/TodayPage.tsx`): *Due today*, *Planned for today* (tasks with a time block that day, any
  deadline), a folded *Overdue* line (`.late-toggle`), and a *+ Plan a task due later…* picker so later work can still
  be planned in. New (un-acknowledged) work stays out (rule 19).
- **Assigned by**: `src/apps/tasks/AssignedBy.tsx` — top line on `TaskRow`, Today plan items, *Who's on what* cards and
  (bigger, full names) at the top of the task drawer, whenever `created_by` ≠ `assignee_id`. Replaces the old
  "from X" meta.
- **Daily repeats**: `repeat` now allows `daily` and `weekdays` (constraint `tasks_repeat_check` dropped and re-added).
  Next-occurrence logic moved into `task_repeat_next_due(t)` + `task_repeat_spawn(id, due, actor)` (used by `tasks_after`
  on done, and by `run_deadline_check`). Daily/weekdays: next = the working day after this one's scheduled day
  (`task_repeat_sched`: `repeat_anchor` for the first, `original_due` after) but never before today, so a late finish
  doesn't bring back skipped days. `run_deadline_check` (07:00 and whenever someone opens the app) first creates today's
  copy for every daily/weekdays series whose latest occurrence is from an earlier day (weekdays: Mon–Fri only; skipped
  for people switched off / without the Tasks app). The spawn locks the row and is once per occurrence (no duplicates if
  two people open the app at once). Daily work gets no *Due today* or *Coming up* alerts; missed-deadline and escalation
  alerts still apply. `task_repeat_spawn` can't be called from the browser. The compliance calendar doesn't offer daily
  frequencies.

### Round 8 (15 Oct 2026)
**Hasith:** "Malshi needs a way to monitor her own output. What she has done each day." Answers: count **tasks finished,
mini tasks + steps, and work outside the app**; **not just for her — for every user**, and **managers and senior
executives see their subordinates'**; **one day at a time**; ticked mini tasks **visible to managers** (unticked stay
private); outside work as **free text**; a new **My output** tab; extras: **manager's morning summary**, and (his own
addition) **"I need to be able to mark task as daily updates needed. No one is able to start a day without logging an
update if they haven't done it before ending the day before."** Then: the update is **a Daily update note** in the task;
**Mon–Fri**; a day off is **no skip** (they write "On leave"); **4:30 pm reminder**. Decided without asking (told him):
only the owner writes updates (not helpers); the first one is due the weekday after it's switched on; the morning screen
covers the whole app incl. Notes; other-work lines are today-only (he didn't pick "log past days").
- **Daily update needed**: `tasks.daily_update` + `daily_update_from` (set by `tasks_before`: next weekday when switched
  on or when the owner changes). Switched by whoever gave it / a manager (`can_check_task`) or the creator (so an owner can
  flag their own task); the owner of a given task can't switch it off. Copied to the next repeating occurrence.
- **Daily updates** = `task_comments.daily_for` (see CLAUDE.md rule 21): `task_comments_before` allows only the owner, a
  flagged task and today / `task_prev_workday(today)`, and pins `created_at`. `task_comments_after` logs `daily_update`
  activity and alerts the giver + followers (`daily_update`). Drawer: a Daily update box for the owner, badges in the
  comments ("written later"); rows: *Update due* / *✓ Updated today* / *Daily update*.
- **Morning catch-up**: `tasks_updates_owed()` (security invoker) → `DailyUpdateGate` over the whole platform via the new
  `GATES` slot. Re-checks when the day changes while the app is open. Sign out is the only other way out.
- **4:30 pm**: `run_update_reminder(p_now)` called from `task_reminders_due()` (every minute); weekdays, once per person per
  day (advisory lock), kind `update_due` → opens My output.
- **Morning summary**: `task_output_summary(today)` from `run_deadline_check` on weekdays, once per lead per day; counts
  via `task_output_counts(user, dept, day)`; "missed" = needed that day and not written *that day*. Kind `output_summary`
  → opens My output on the last weekday (`noticeParams` on the app definition in `src/platform/registry.ts`).
- **My output** (`pages/OutputPage.tsx`, tab `output`): tasks finished (from `submitted_at`/`completed_at`), daily updates
  (`daily_for` = day), ticked minis and steps (`done_at` in the day), other work (`task_work_log`, today-only lines,
  editable/deletable on the day). Visibility: `task_sees_work_of(user, dept)`.

### Round 9 (16 Oct 2026)
**Hasith** (on Admin → People): "need to be able to add new users here?" — then: "these are not exactly users of the app.
these are people to whom i assign work. I need to have a record for those tasks to follow up. so that is my requirement.
do what you think is best." (An earlier pick, "create with a starting password", was superseded by this.)
- Built **people outside the app**, not logins: `task_contacts` (department, name, organisation, phone, email, note,
  active, created_by) + `tasks.contact_id` (CLAUDE.md rule 23). Shared list per department: anyone with Tasks adds and
  uses them; the creator, managers, seniors and the admin edit; managers delete only unused ones; otherwise "Remove" =
  `active=false`. The admin may add to the department being viewed; others always to their own.
- Task panel: **Given to someone outside the app** select with **+ Add someone new…** (inline `ContactForm`); note
  "You follow up with … · phone · email". `OutsideWith` line on task rows, board cards, Today, My output and the drawer.
- **Follow-ups** tab (`pages/FollowUpsPage.tsx`): a card per person — open / overdue counts, last comment across their
  tasks ("last note"), open tasks, **Show N finished** (the record), Edit / Remove / **+ Task for X**; *I follow up* vs
  *Everyone's* for leads; removed people with nothing open folded at the bottom ("Put back on the list").
- Excel export: new column 4 "Given to (outside the app)". Admin → People has a pointer card to Follow-ups.

### Round 10 (20 Oct 2026)
**Hasith:** "I want task nature list. Task, mini Task, Projects". Answers: a project is **"one big task with stages"**
(dated milestones, no separate tasks); the choice is a **switch in the New panel**; mini tasks can be **given to the team**;
the project page shows **progress, timeline, status flag, notes and files**; each **stage can have its own person**;
projects show in a **Projects tab and in the task lists**; a given mini task sends **one alert**; the **owner sets the flag
and the giver / managers are alerted** on At risk / Off track. Decided and told him: a stage person can open the whole
project but tick only their own stages; projects don't repeat; the giver can change / take back a mini task until it's
ticked. Then "build".
- See CLAUDE.md rules 24–25. New pages: `pages/ProjectsPage.tsx` (tab `projects`), `pages/ProjectPage.tsx` (route
  `project?id=`), components `Stages.tsx` (`useStages`), `ProjectStatus.tsx`, `StageRow.tsx`, `MiniGiveForm.tsx`. The
  drawer's **Task · Mini task · Project** switch (`kind`) — mini renders `MiniGiveForm` instead of the task form.
- Store: steps now load whole rows (`stagesOf`, `stageOwner`, `myStages`, `toggleStage`).
- Alerts: `mini`, `stage`, `stage_overdue` (morning check, once per stage date, stage person + owner), `health`.
- Excel: two columns at the end, *Type* and *Project status*.
- Less-used Tasks pages (calendar, day review, team, reports, trends, output, follow-ups, projects, project) now load on
  demand (`lazy`), keeping the main bundle under Vite's 700 kB warning.

### Round 11 (22 Oct 2026)
**Hasith:** "I need to be able to message via the app to the team and the individuals and they should be able to open
tasks, notes and reminders from my messages. A mini task or a bigger one. Ask questions and give me suggestions before
developments". Answers: **team chat + one-to-one + announcements**; anyone may message anyone in the department; work in
messages = **attach** a task / note / reminder, **Send as** task / mini task / reminder, and **turn a message into work**;
alerts for **one-to-one messages and @mentions** (team chat otherwise just a badge), **announcements alert everyone**; a
**chat button in the top bar**; **screenshots and files, reply / edit / delete, WhatsApp-like delivered and seen ticks**;
one-to-one chats **private between the two (not even the admin / managers)**; add @mentions. He then accepted suggestion 3
(**messages in Ctrl+K search**) and said "build".
- Decided and built: edit / delete for 15 minutes (delete leaves "This message was deleted"); announcements have **Got it**
  with *Got it: n of m* and who hasn't; on a computer the team chat opens straight away unless something is unread;
  one-to-one alerts go to the phone and the chat button but not the bell list (mentions and announcements do go in the
  bell); attaching your own private note offers to share it view-only with the chat; cards for work a viewer can't open
  show the title and a lock (task) or **Remind me too** (reminder); a mini task card can be ticked in the chat by its owner.
- Database `09_app_messages.sql` (rule 26). Tables `msg_threads` (team / announce / direct), `msg_messages`, `msg_items`,
  `msg_files` (bucket path `messages/<thread>/…`), `msg_reads` (ticks), `msg_acks` (Got it). Functions `msg_sync` (list +
  unread + delivered), `msg_seen`, `msg_direct`, `msg_search`. Alerts `message`, `mention`, `announce` (push titles in
  07_push.sql). Switched on for departments with Tasks the first time it runs; `defaultOn` for new departments.
- App `src/apps/messages/` (lazy; `inMenu: false`): `index.tsx` (list), `Conversation.tsx`, `Bubble.tsx`, `Composer.tsx`,
  `Card.tsx`, `sync.ts` (one shared poller), `ChatButton.tsx` (TOP_BAR), `search.ts` (SEARCH). Tasks provides
  `MessageCard.tsx`, `MessagePick.tsx`, `MessageWork.tsx`; Notes provides `MessageNote.tsx`, `MessageNotePick.tsx` — all
  through the lazy MESSAGE_* slots in `slots.ts`.

### Round 12 (25 Oct 2026)
Password reset for Hasith by SQL (found through `platform_admins`, so no email needed). Then: "I want a pomodora added to
the app. time slot lengths should be adjustable. also exisiting reminders, when i give another time, i need to be able to
pick time an date". Answers: the timer in the **top bar on every page**; **pick a task and count it in My output**
(managers see it like the rest of My output); when a slot ends: **sound + on-screen pop-up** (no phone alert, no
auto-start); reminders: **Snooze → Pick date & time**, **change the time any time**, **also ones I set for others**, and
**change the words** too.
- Decided: lengths = focus, short break, long break, focus slots before the long break (presets 25/5, 50/10, 90/20; limits
  1–180 / 1–60 / 1–90 / 1–12), saved per person in the database; stopped early still counts the minutes done (a minute or
  more), marked *stopped early*; a slot that ended while the app was closed is recorded on the next open and the pop-up
  says "while you were away"; the person can remove today's mistaken session, nobody can edit one. Reminders: separate
  date and time boxes; a time already gone is refused; only the person reminded ticks Done / snoozes, the setter can
  Change or delete.
- Database (02_app_tasks.sql, rule 27): `task_focus`, `task_focus_settings`, `task_focus_save`. Code: `focus.ts`,
  `FocusButton.tsx` (TOP_BAR, before Reminders), My output "Focus time" tile + section, `ReminderEdit` in Reminders.tsx.
  Shell now keys TOP_BAR buttons by position (two come from Tasks).

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
src/apps/tasks/ Home, Today, New, list, calendar, day review, who's on what, reports (week, trends), reminders;
                TaskDrawer, store, search.ts, ReminderButton and FocusButton + focus.ts (top bar)
src/apps/notes/ page tree, NotePage, TipTap Editor, ShareDialog, NoteFiles, LinkedTasks, LinkedNotesPanel, search.ts
src/apps/messages/ announcements, team chat, one-to-one chats; ChatButton (top bar), search.ts
src/apps/admin/ People, Departments & apps, Phone alerts
src/features/   department-only features (daily-notes, month-end, compliance)
public/         manifest, icons, service worker (sw.js)
supabase/       01–09 setup files, updates/NNN, functions/workspace-push (Edge Function), templates/,
                00_reset.sql (wipes data!)
tests/db/       database security tests (654 checks)
tests/e2e/      browser tests + a local stand-in for Supabase (incl. pg_net and fake phones)
tests/push/     the Edge Function in real Deno (25 checks)
tools/sql-page/ builds the copy-paste SQL page for Hasith
tools/compose_update.py  builds the next cumulative update file from the numbered setup files
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
2. Database change → into the numbered setup files, then `python3 tools/compose_update.py NNN_name "title"` builds the
   cumulative `supabase/updates/NNN_name.sql` (includes all earlier updates; he runs only the newest).
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

- `tests/db/run.sh` — 74 isolation + 89 feature + 49 round-4 + 111 round-5 + 45 round-6 + 45 round-7 + 70 round-8 + 27 round-9 + 46 round-10 + 68 round-11 + 30 round-12 checks (654) on a local
  Postgres with a stand-in for Supabase's `auth`, `storage` and `pg_net`.
- `tests/push/run.sh` — the Edge Function in real Deno (from npm), checked against the reference decoder. 25 checks.
- `tests/e2e/run.sh` — builds the app against `tests/e2e/mock-supabase.mjs` (auth, REST subset,
  storage with real RLS), seeds a Finance + HR demo (`*@demo.lk` / `password1`) and drives Chrome
  through every feature. All 550 browser checks pass (incl. 69 for round 5: install, phone alerts end to end
  with fake phones running the real sender code, sign-off, Got it, compliance, trends, search; 45 for round 6:
  Home, New tab, reminders, escalation, pin & follow, notes → task, phone layout; and 45 for round 7: mini tasks,
  left-overs, privacy, the Today list, Assigned by, daily/weekday repeats, phone layout; and 39 for round 8: the morning
  catch-up screen, the update box and badges, My output (own, manager, senior, member), other work, the morning summary,
  phone layout; 29 for round 9: Follow-ups end to end, adding from a task, the record, remove, Excel, who sees what; and 30
  for round 10: the three-way New panel, giving / ticking / taking back mini tasks, a project with stages, the Projects
  tab, a stage person's view, the status flag and its alert, the project page and timeline, missed stages, phone; and 65
  for round 11: Messages end to end — announcements and Got it, @mentions, private one-to-one chats and their ticks,
  reply / edit / delete, pictures, Send as, Remind me too, Make it a mini task, attached task and note, search, HR apart, phone;
  and 42 for round 12: the focus timer with a fast-forwarded clock — lengths, focus → break → long break, pause, stop
  early, ended while away, My output (own and the manager's), phone — and reminders' Change / Pick date & time).
  Note: some older checks depend on today's date (e.g. which calendar day is empty) — test_tasks now picks an empty day.
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
- Messages refresh by polling (every 4–5 s while open, 20 s elsewhere), not realtime. No group chats other than the
  department's team chat; no reactions, voice notes or forwarding. Files stay in storage if a message is deleted after
  its 15 minutes (it can't be by then). Deleted messages keep their row (words wiped).
- Focus timer: the running clock belongs to one browser (a timer started on the PC doesn't show on the phone); no phone
  alert when a slot ends (he chose sound + pop-up), and browsers may hold back the chime until the page has been
  clicked once. Focus time isn't in the managers' morning summary (only on My output).
- Weekly and longer repeats only create the next one when the current one is done/signed off (an unfinished one simply
  goes overdue). Daily / weekday repeats create one every morning regardless.
- My output shows one day at a time (no week/month totals or Excel export — he chose that). Other-work lines can't be
  added for earlier days. Daily updates ignore public holidays (Mon–Fri only): on a holiday people write "Holiday".
- Mini tasks can't be dragged onto the timeline (click an empty slot to add your own block instead). Done mini tasks
  stay in the database (they only show on their own day).
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
