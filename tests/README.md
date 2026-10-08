# Tests

`tests/db/isolation.test.mjs` proves the security rules hold — for example that HR
can't read Finance tasks, that only the admin can change app access, that a
department feature switched off can't be read even through the API, and that a task
can't jump departments. 70+ checks.

`tests/db/features.test.mjs` covers helpers, checklists, files (storage rules), Today time
blocks and Notes (private / department / chosen people, sub-pages, admin read-only,
links to tasks). 80+ checks.

`tests/db/round3.test.mjs` covers deadline history, repeating tasks, first sign-in of older logins, the
Monday summary alert and the Month-end declaration feature (isolation, self-declaration, review/approve,
locking, reminders). ~50 checks.

`tests/db/round5.test.mjs` covers checker sign-off (send back with a reason, managers, who can't), "Got it" and its
reminders, early reminders, repeating series, the Compliance calendar feature (isolation, leads only), search
(tasks, comments, steps, notes — only what you can open), performance trends, and phone alerts (keys never readable,
devices only your own, alerts batched to the Edge Function, gone devices forgotten, sending can never break the app).
~110 checks. `mock_supabase.sql` includes a small stand-in for `pg_net` that records the calls.

Run it against a **throwaway local Postgres** (never your live Supabase project):

```
npm install
DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch ./tests/db/run.sh
```

`mock_supabase.sql` creates a minimal stand-in for Supabase's `auth` schema and roles
so the real SQL files can be loaded unchanged. When you add a table, add checks here
showing another department can't read or write it.

## The phone-alert sender

`tests/push/run.sh` runs `supabase/functions/workspace-push/index.ts` in real Deno (the runtime Supabase uses):
type-checks it as deployed, encrypts alerts and has the reference decoder (`http_ece`) read them back, checks
the VAPID signature, and checks it only ever sends to official push services. 25 checks.

## Browser tests

`tests/e2e/` drives the real app in Chrome against a local stand-in for Supabase.
See `tests/e2e/README.md` (one command: `./tests/e2e/run.sh`).
