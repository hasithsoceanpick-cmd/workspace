# Browser tests (end to end)

These drive the real app in a headless Chrome against a **local** Postgres and
`mock-supabase.mjs`, a small stand-in for Supabase (logins, the REST API and file
storage) that enforces the same database rules. Nothing touches your live project.

```
DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch ./tests/e2e/run.sh
```

What it does: loads `tests/db/mock_supabase.sql` and the `supabase/*.sql` files, runs the
database security tests, builds the app pointed at the stand-in, seeds a two-department
demo (`seed.mjs`: Finance and HR, logins `*@demo.lk` / `password1`), then runs:

| File | Covers |
|---|---|
| `test_platform.py` | departments kept apart, admin switcher, app access per person, bell hops department |
| `test_tasks.py` | quick add, deadline moves, calendar drag (date and person), notifications |
| `test_delete_people.py` | decline sign-ups, delete logins, refusal when tasks are assigned |
| `test_admin_notes.py` | admin turns Notes on for chosen people |
| `test_new_features.py` | Today planner, helpers, checklists, screenshots/files/links, Notes (sharing, sub-pages, links to tasks, edit conflicts), phone layout |
| `test_round3.py` | deadline history on cards, repeating tasks, Who's on what board, weekly summary, Excel exports (opened with openpyxl), older logins, Month-end declaration end to end |
| `test_round5.py` | install as an app (manifest, icons, service worker, offline start, iPhone steps), phone alerts end to end (admin set-up, test alert, a member's phone gets a real encrypted alert, tapping opens the task, sign-out stops alerts), Got it, sign-off and send back, Compliance calendar (add, year view, export, members/HR), Trends (+ export), Ctrl+K search, phone layout |
| `test_round6.py` | managers land on Home (tiles, panels), escalation (bell, red flags), the New tab (hidden from lists/Today/calendar until Got it), quick reminders (for self and a team member, due → bell, snooze, make it a task), pin & follow (+ alerts), notes → task, phone layout |
| `test_round7.py` | Today shows only the day's work (due today, planned, folded overdue, plan a later task), mini tasks (add, tick, edit, → Task, delete, saved), left-overs (Do today / Make task / Delete), privacy from a senior viewing the day, "Assigned by" on cards, drawer and board, Every day / Weekdays repeats (menu, note, today's copy after a missed day), phone layout |
| `test_round8.py` | the morning catch-up screen (blocks the app, no skip, saves both updates), the Daily update box and row badges, My output (tasks finished, updates, minis, other work add/edit/delete, the last weekday read-only), the manager's morning summary in the bell (opens that day), manager / senior / member views, switching daily updates on, phone layout |
| `test_round9.py` | people outside the app: Admin → People pointer, + Add person, + Task for them, adding someone new from inside a task, the "Given to" line, last note, I follow up / Everyone's, finished record, edit, remove, Excel column, member and HR views, phone layout |
| `test_round10.py` | + New with Task · Mini task · Project; giving a mini task (alert, "from", Given to others, ticked, change, take back); a project with three stages; Projects tab; a stage person's list, tick and limits; status flag with note, history and alert; badges in lists; drawer link to the page; handing a stage over; missed stage alert and Today; phone |
| `test_round11.py` | Messages: chat button (not in the Apps menu), announcements and Got it (who has / not yet), team chat with @mentions (suggestions, highlight, alert only the person, bell), one-to-one chats (private even from the admin, delivered and seen ticks), reply / edit / delete and the 15-minute limit, pictures, Send as task / mini task / reminder, Remind me too, Make it a mini task, attach a task (locked for others) and a note (shared view-only on attaching), Ctrl+K search, HR kept apart and switched off, phone |
| `test_round12.py` | Focus timer (with a fast-forwarded browser clock): top-bar button, 25:00 default, own tasks to pick, lengths (presets, typed, limits, saved), focus → pop-up → break → focus → long break, pause, keeps running across pages and in the tab title, stop early, ended while the app was closed, My output (tile, per task, sessions, manager's view, remove), phone; reminders: Change (words, date, time), Snooze → Pick date & time (past refused), changing one set for a team member |
| `test_round13.py` | Tasks given without a deadline: "Kasun picks the date" (not for your own task or a project), latest date, No date yet group, board card and table column, Excel row, the owner's alert, New tab date box (Got it disabled until picked, Got it for all, past the limit refused), picking in the task panel, the giver's alert and history, setting the date yourself after all, phone |
| `test_first_run.py` | brand-new install: first sign-up becomes admin |

Needs Node 20+, `psql`, and Python 3 with `pip install playwright pillow openpyxl` then
`playwright install chromium`. Screenshots are saved in `tests/e2e/shots/`.

**Phone alerts in the tests:** headless Chrome can't reach Google's push service, so test devices get a stand-in
subscription with real keys. The stand-in runs the **real** Edge Function code on each `pg_net` call, and the
fake push service decrypts what it receives with the reference decoder (`http_ece`) — so the database trigger,
the sender's encryption and signing, and the app's handling are all exercised; only the last hop to Google is skipped.

**Note on the stand-in:** it supports only the parts of Supabase this app uses. If you add
a new kind of query (for example embedded joins) and a test fails with "unsupported
filter" or "not mocked", extend `mock-supabase.mjs` rather than changing the app.
