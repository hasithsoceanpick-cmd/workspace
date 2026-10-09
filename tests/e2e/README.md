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
