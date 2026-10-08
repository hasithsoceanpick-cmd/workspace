# Workspace

One website for the whole organisation. Each **department** gets its own private
space; **apps** (Tasks and Notes so far) are switched on per department and, if you
want, per person. **You are the only administrator**: you can move between
departments and control who sees what. No one else can.

Runs on **Supabase** (database + logins) and **Vercel** (hosting), both on free tiers.

---

## Who can do what

| | Admin (you) | Manager | Senior Executive | Member |
|---|---|---|---|---|
| Departments they can see | All (switcher in the top bar) | Own only | Own only | Own only |
| Approve people, set department & role | ✓ | — | — | — |
| Turn apps / features on for a department or person | ✓ | — | — | — |
| **Tasks:** see | Everything in the department being viewed | Whole department | Own + Members' | Own |
| **Tasks:** assign to | Anyone in that department | Anyone in own department | Self + Members | Self |
| **Tasks:** add helpers | Anyone in that department | Anyone in own department | Self + Members | — |
| **Today:** look at someone's day (read-only) | Anyone | Anyone in own department | Members | — |
| **Notes:** read | Every page, including private ones | Own + shared with them | Own + shared with them | Own + shared with them |
| **Sign off finished work** | Work they gave (any department) | Work they gave + anyone's in the department | Work they gave | Work they gave |
| **Who's on what, Reports (weekly summary, trends)** | ✓ | ✓ | ✓ (self + Members) | — |
| **Month-end declaration** (where switched on) | Manage the list | Manage, review, **approve** | Manage, **review** | Tick own lines |
| **Compliance calendar** (where switched on) | Add / change obligations | Add / change obligations | Add / change obligations | See it; own their tasks |
| **Phone alerts** | Set up (Admin → Phone alerts) | Turn on per phone | Turn on per phone | Turn on per phone |

Your admin login is your normal account. You're also Finance's Manager, and the
department switcher lets you step into any other department. Being admin is set in the
database only: no screen in the app can make someone else an admin.

**How departments are kept apart.** Every record carries its department, and the
database itself refuses to return another department's data. That holds even if
someone pokes at the API directly. 300+ automated checks cover this (`tests/`).
Files and screenshots sit in private storage behind the same rules (10 MB per file).

---

## On phones (install it like an app)

- Open the Workspace link on the phone → tap your picture (top right) → **Install app**.
  Android/Chrome installs it straight away; on **iPhone** use Safari → **Share** → **Add to Home Screen**.
  It then opens full-screen from its own icon, and once opened it still starts when the signal drops.
- **Phone alerts**: in the same menu, **Phone alerts on this device** → On. From then on, whatever lands in
  your bell also pops up on that phone (tapping it opens the task). On iPhone this works once the app is on the
  Home Screen (iOS 16.4 or later). Signing out stops alerts on that phone.
- The admin sets phone alerts up once in **Admin console → Phone alerts** (it shows each step).

## The Tasks app

- **Today** (opens first): plan your day on a 07:00–20:30 timeline. Drag tasks in from the left (or press **+**),
  click an empty slot to add your own block (Lunch, a meeting…), drag blocks to move them and pull the
  bottom edge to resize. Any day can be opened to plan ahead or look back. Managers and senior
  executives can pick a person to see their day (read-only).
- **Who's on what** (Managers, Senior Executives): a column per person with the work they're carrying,
  overdue first; drag a card to someone else to hand it over. Switch to *Table* for the numbers.
- **Reports** (Managers, Senior Executives):
  - **Weekly summary**: per person for any week, what was finished (on time / late), whose deadlines moved,
    and what's overdue now. Managers get a bell alert every Monday. Export to Excel.
  - **Trends**: month by month per person — on time %, finished, missed, deadlines moved, sent back, and how
    long they take to open new work — colour-coded, with a department total. Export to Excel.
- **Tasks**: lists grouped Overdue / Today / Tomorrow / This week / Next week / Later. Tick to finish. Quick-add bar.
- **Sign-off (maker → checker)**: when someone finishes a task **you gave them**, it comes back to you under
  **Waiting for your sign-off**. **Sign off** (one tick) or **Send back** with what needs fixing. Managers can sign off
  anything in their department. Per task you can choose *Sign-off: Not needed*. Repeating tasks create the next one
  when signed off. Finished-but-waiting work doesn't count as late.
- **Got it**: new work someone gives you shows **New** until you open it and press **Got it** (or start it). Whoever
  gave it sees *Not opened yet* / *opened 09:12*. Next morning there's a reminder for anything still unopened.
- **Early reminder**: per task, *remind me 1 day … 1 month before* the deadline.
- **Search everything**: the magnifier in the top bar, or **Ctrl+K**. Finds words in task titles, notes, comments,
  checklist steps and note pages — only what you could already open.
- **Calendar**: Month view, and a Week view laid out as *people × days*. Drag a task to move its deadline, or into someone else's row to hand it over.
- **Day review**: any date, past or present: who completed, started or moved what, comments, and what was due and missed.
- **Team**: workload per person (open, overdue, due today, done this week).
- **Deadline history on the card**: a task whose deadline was moved shows **Moved 2×** and its first
  deadline struck through; click it to see who moved it, when, and from/to which date.
- **Repeating tasks**: set *Repeat* to every week / month / 3 months / year. When it's marked done, the next
  one is created on schedule with the same owner, helpers and checklist.
- **Export to Excel** (Tasks list): every task you can see, plus a sheet of deadline moves. Also a backup.
- **Inside a task**: a **checklist** of steps with progress (e.g. 3/5), **files, screenshots and links**
  (paste a screenshot with Ctrl+V anywhere in the task), comments and history.
- **Helpers**: a task has one owner and can have helpers. Managers and senior executives add them.
  Helpers see the task under *Helping on* and on their calendar, get its alerts, and can comment,
  tick steps and add files. Only the owner (or the person who assigned it) marks it done or moves the deadline.
- **Notifications**: assigned to you, added as a helper, deadline moved, deadline missed (checked every morning at 7:00), due today, coming up (early reminder), not opened yet, finished — please sign off, signed off, sent back, waiting, comments.

## The Notes app

- Pages with **sub-pages**, headings, bullets, numbered lists, **tickboxes**, simple **tables**, links,
  pasted **screenshots** and attached **files**. Saves as you type.
- Each page is **Private** until its owner shares it with the **whole department** or **chosen people**,
  as *can view* or *can edit*. Sub-pages follow their top-level page.
- **Link pages to tasks**: from the page, or from a task's *Notes pages* section.
- If two people edit the same page at once, the second save is stopped and they choose whose version to keep.
- Off until you turn it on: **Admin console → Departments & apps → Notes** (whole department or chosen people).

**Department-only features** (off until you tick them for a department):
- **Month-end declaration** (for Finance): a master list of lines (MEC, CMP or any category) with an owner and
  a due day. Each month a senior executive or the manager starts the month, which copies the list. Owners tick
  their own lines and add remarks; when every line is ticked a senior executive marks it **reviewed** and the
  manager **approves**, which locks the month. Reminders on the due date and when overdue. Export to Excel.
- **Compliance calendar** (for Finance): every recurring statutory deadline (VAT, EPF/ETF, renewals …) with its owner,
  next deadline, days left and an on-time track record; *Next 12 months* shows the whole year. Each obligation is a
  high-priority repeating task with an early reminder, so finishing it schedules the next. You enter the dates.
- **Daily notes**: an end-of-day note per person, shown in Day review.

---

## Setup (about 25 minutes, no coding)

### 1. Supabase (the database)
1. supabase.com → **New project** → name `workspace`, region **Singapore** → create.
2. **SQL Editor → New query**. Paste and **Run** each file from the `supabase` folder, **in order**:
   1. `01_platform.sql`
   2. `02_app_tasks.sql`
   3. `03_feature_daily_notes.sql`
   4. `04_daily_check.sql`. If it complains about `pg_cron`, enable **Integrations → Cron**, then run it again.
   5. `05_app_notes.sql`
   6. `06_feature_month_end.sql`
   7. `07_push.sql` (phone alerts)
   8. `08_feature_compliance.sql`
3. **Authentication → Sign In / Providers → Email** → turn **Confirm email** OFF → Save.
4. Click **Connect** and copy the **Project URL** and the **Publishable key** (`sb_publishable_…`).

### 2. GitHub (stores the code)
1. github.com → **New repository** → `workspace` → **Private** → Create.
2. **uploading an existing file** → drag in everything inside this folder → **Commit changes**.

### 3. Vercel (puts it online)
1. vercel.com → sign in with GitHub → **Add New… → Project** → import `workspace`.
2. Add **Environment Variables**:
   `VITE_SUPABASE_URL` = Project URL, `VITE_SUPABASE_PUBLISHABLE_KEY` = Publishable key.
3. **Deploy**. You get a link like `workspace-xyz.vercel.app`.

### 4. First run
1. Open the link and **create your account first**. The first person to sign up becomes the admin.
2. App dropdown → **Admin console → Departments & apps** → add `Finance` (Tasks switches on automatically).
3. **People** tab → set yourself to **Finance / Manager**.
4. Share the link. Each sign-up waits in **People → Waiting for approval** until you choose their department and role.

---

## Running it day to day (Admin console)

- **People**: approve or **decline** sign-ups; move someone to another department (they lose access to the old one's data immediately); change roles; set calendar colours. When someone leaves, **Deactivate** keeps their history. **Delete** removes the login completely, and only works once no tasks are assigned to them.
- **Departments & apps**: add or rename departments. For each app, choose **Everyone in the department** or **Only selected people** and tick names. Tick **department-only features** where they belong.
- **Switch department**: top bar, next to the app dropdown. Only you see it.

### Admin by SQL (deliberately not in the app)

```sql
-- add another admin
insert into platform_admins (user_id) select id from profiles where email = 'person@company.com';
-- remove one
delete from platform_admins where user_id = (select id from profiles where email = 'person@company.com');
-- reset a forgotten password
update auth.users set encrypted_password = extensions.crypt('NewPassword123', extensions.gen_salt('bf'))
where email = 'person@company.com';
```

---

## Updating an existing setup

When a change needs a database update, it comes as a file in `supabase/updates/`. Run it once in the SQL Editor (never `00_reset.sql`, which wipes data).

| Update | What it adds |
|---|---|
| `001_delete_people.sql` | Decline / Delete buttons in Admin → People |
| `002_helpers_checklist_files_today_notes.sql` | Helpers, checklists, files & screenshots, Today planner, Notes app |
| `003_history_repeat_month_end.sql` | Deadline history, repeating tasks, Monday summary alert, older logins, Month-end declaration |
| `004_alerts_signoff_compliance_search.sql` | Phone alerts, sign-off, Got it, early reminders, Compliance calendar, Trends, search (includes 003) |

**Phone alerts also need the sender** (once): Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor** →
name it `workspace-push` → paste `supabase/functions/workspace-push/index.ts` (or use *Copy sender code* in
Admin → Phone alerts) → **Deploy** → in the function's **Details**, turn **Verify JWT** off. Then Admin → Phone alerts →
**Turn on phone alerts** → **Send a test**.

Then update the code on GitHub **keeping the folders** (`src/`, `supabase/`, …): repository page →
**Add file → Upload files** → select everything in the extracted project folder and **drag** it into
the box (dragging keeps the folders; the "choose your files" button doesn't) → check the list shows
paths like `src/apps/...` → **Commit changes**. Vercel redeploys by itself.

## Adding things later

- **Something only one department needs** (e.g. a payments checklist for Finance):
  build it as a *department feature* and switch it on for that department only. It stays
  invisible to everyone else, in the screens and in the database.
- **A new app** (e.g. Leave requests): it appears in the app dropdown for the departments
  and people you choose.

The rules for both are in **`CLAUDE.md`**, with ready-to-copy SQL in `supabase/templates/`.
When you ask Claude to build something, point it to this project and it will follow those rules.

---

## For developers

```
npm install
cp .env.example .env.local     # fill in the two values
npm run dev
```

`src/platform` holds the shell, `src/apps/<key>` the apps, `src/features/<key>` the
department features, and `supabase/` the numbered SQL (re-runnable). Database tests:
`tests/README.md`; browser tests: `tests/e2e/README.md`; the phone-alert sender: `tests/push/run.sh`.
Architecture rules: `CLAUDE.md`.
Project history, decisions and how to carry on: `HANDOFF.md`.
