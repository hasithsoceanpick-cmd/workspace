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

`tests/db/round6.test.mjs` covers quick reminders (sent once at their time, snooze, repeat without catch-up, weekdays,
for whom they may be set, private to the two people involved, about a visible task only), pin & follow (own marks only;
followers get alerts only while they can see the task) and escalation (3 days, once, managers + owner + followers, cleared
by a new deadline, HR stays HR). 45 checks.

`tests/db/round7.test.mjs` covers mini tasks (always your own, private even from managers and the admin, other
departments and people without the Tasks app shut out, owner/department can't be changed, "Do today") and daily /
weekday repeats (next one after an on-time finish, today's copy appears when yesterday's was missed — once, even if the
check runs twice — a late finish doesn't bring back skipped days, Friday → Monday, weekly unchanged, no "due today" /
"coming up" alerts for daily work, nothing for people switched off, HR stays HR, switching repeat off stops it, the
copy-maker can't be called from the browser). 45 checks.

`tests/db/round8.test.mjs` covers daily updates (who can switch them on/off, a new owner restarts them, only the owner
writes one, only for today or the last weekday, the time can't be faked, alerts to whoever gave the task, the morning
catch-up list, weekdays only, repeating copies keep it), other-work lines (today only, own only, who can read them),
ticked mini tasks visible to managers only, the managers' morning summary (counts, quiet days, missed updates, seniors
hear about members only, HR stays HR, once a day) and the 4:30 pm reminder (not before, once, only to people who owe one).
70 checks.

`tests/db/round9.test.mjs` covers people outside the app: always added to your own department (the admin may choose),
each department sees only its own list, who can edit and delete, a task's person must be on its department's list,
changes logged, repeating copies keep the person, and removing someone on a task keeps the record. 27 checks.

`tests/db/round10.test.mjs` covers projects (never repeat, stages with dates and people, the stage person added as a helper
with one alert, members can't hand stages to colleagues, stage people tick only their own and change nothing else, other
departments shut out, ordinary steps never keep a date/person, the status flag: who sets it, alerts only on At risk /
Off track, history), missed-stage alerts (once, stage person + owner, not when ticked or finished) and mini tasks given to
someone (who may give to whom, one alert, the giver sees / changes / takes back until ticked, never ticks). 46 checks.

`tests/db/round11.test.mjs` covers Messages: the team chat and announcements made once per department, nobody without
the app (or from another department) sees or writes them, one-to-one chats (only with people in your department who use
Messages; readable and writable only by the two — not their senior, not the manager, not the admin), alerts (one-to-one →
the other person, team → only real @mentions, announcements → everyone with Messages), delivered / seen ticks (only
forwards, nobody marks someone else's, opening a chat clears its bell alerts), announcements only by managers and Got it
only on announcements, work cards (attached / sent only by the author, made by anyone in the chat, titles kept), files
only in the chat's own folder, replies stay in their chat, edit / delete only by the author within 15 minutes (delete
wipes the words, rows are never removed), and search finding only what you can read. 68 checks.

`tests/db/round12.test.mjs` covers the focus timer: sessions are always the person's own (department set from them), a
slot is recorded once even from two tabs, stopped early keeps only the minutes done, no claiming more minutes than
passed, a fast device clock still records, old or impossible times refused, only tasks you can see, managers / senior
executives read them like My output (HR doesn't), never changed afterwards, today's removable by the person only, a
deleted task keeps the time; each person's lengths (saved, limits, private) — and changing reminders: the person reminded
or whoever set it can change the words, date and time (it alerts again), nobody else, never handed to someone else. 30 checks.

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
