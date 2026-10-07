# Tests

`tests/db/isolation.test.mjs` proves the security rules hold — for example that HR
can't read Finance tasks, that only the admin can change app access, that a
department feature switched off can't be read even through the API, and that a task
can't jump departments. 70+ checks.

`tests/db/features.test.mjs` covers helpers, checklists, files (storage rules), Today time
blocks and Notes (private / department / chosen people, sub-pages, admin read-only,
links to tasks). 80+ checks.

Run it against a **throwaway local Postgres** (never your live Supabase project):

```
npm install
DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch ./tests/db/run.sh
```

`mock_supabase.sql` creates a minimal stand-in for Supabase's `auth` schema and roles
so the real SQL files can be loaded unchanged. When you add a table, add checks here
showing another department can't read or write it.

## Browser tests

`tests/e2e/` drives the real app in Chrome against a local stand-in for Supabase.
See `tests/e2e/README.md` (one command: `./tests/e2e/run.sh`).
