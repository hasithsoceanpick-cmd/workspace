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
| `test_first_run.py` | brand-new install: first sign-up becomes admin |

Needs Node 20+, `psql`, and Python 3 with `pip install playwright pillow` then
`playwright install chromium`. Screenshots are saved in `tests/e2e/shots/`.

**Note on the stand-in:** it supports only the parts of Supabase this app uses. If you add
a new kind of query (for example embedded joins) and a test fails with "unsupported
filter" or "not mocked", extend `mock-supabase.mjs` rather than changing the app.
