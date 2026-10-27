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
| **Quick reminders** for | Self + anyone in the department | Self + anyone in own department | Self + Members | Self |
| Opens the app on | Home | Home | Home | Today |

Your admin login is your normal account. You're also Finance's Manager, and the
department switcher lets you step into any other department. Being admin is set in the
database only: no screen in the app can make someone else an admin.

**How departments are kept apart.** Every record carries its department, and the
database itself refuses to return another department's data. That holds even if
someone pokes at the API directly. 350+ automated checks cover this (`tests/`).
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

- **Home** (Managers, Senior Executives — where they land): sign-offs waiting for you, overdue work by person
  (with escalations), work not opened yet, what's due in the next 7 days, your reminders today, and — where
  switched on — compliance deadlines coming up and the month-end declaration status.
- **New**: work someone gives you waits here (with a count on the tab) until you press **Got it**; only then does
  it join your lists, Today and calendar. *Got it for all* clears the lot.
- **Quick reminders** (the clock button in the top bar, on every page): type a line, tap *In 1 hour / Today 5 pm /
  Tomorrow 9 am* or pick a time, optionally repeat (every day / weekday / week / month). At that time it pops up in
  the bell and on your phone. Snooze, mark done, or turn it into a task. Managers and senior executives can set
  one for someone in their team ("Reminder from Hasith: …"). From a task: **⏰ Remind** sets one about that task.
  *All reminders* lists what's due, coming up, repeating, and what you set for others. **Change** (on any reminder that's
  yours or that you set for someone) edits the words and picks a new **date** and **time**; *Snooze* also offers
  **Pick date & time…** next to 10 min / 1 hour / Tomorrow 9 am.
- **Focus timer (Pomodoro)** (the 🍅 button in the top bar, on every page): pick a task you're working on (or none),
  press **Start focus**. The button turns into a running clock (also shown in the browser tab) and keeps going while you
  move around the app. When a slot ends there's a chime and a pop-up: *Start break* / *Skip break*, then *Break's over —
  Start focus*. Pause, Stop, or *Break now* at any time. **Lengths**: one tap for 25/5, 50/10 or 90/20, or type your own
  focus, short break, long break and how many focus slots before the long break; saved for you on every device. Each
  focus slot is recorded (stopped early keeps the minutes done) and shows on **My output** — total focus time, per task,
  each session — so managers see it like the rest of My output. If the app was closed when a slot ended, it's recorded
  and the pop-up shows the next time you open it.
- **Escalation**: a task still not finished **3 days after its deadline** goes to the department's managers (the
  owner is told too) and carries a red **Escalated** flag on its card, the board and the calendar, until it's
  finished or given a new deadline.
- **Pin & follow** (in a task's panel): ☆ **Pin** keeps a task at the top of your list; **Follow** gives you its
  alerts (comments, deadline moves, finished, escalated) even if it isn't yours. *Following* is a filter in Tasks.

- **Today** (opens first): only that day's work — **mini tasks**, tasks **due today**, tasks **planned for today** on the
  timeline, and one folded **Overdue** line (tap *show*). *+ Plan a task due later…* pulls other work into the day.
  Plan on a 07:00–20:30 timeline: drag tasks in from the left (or press **+**), click an empty slot to add your own
  block (Lunch, a meeting…), drag blocks to move them and pull the bottom edge to resize. Any day can be opened to
  plan ahead or look back. Managers and senior executives can pick a person to see their day (read-only).
- **Mini tasks** (top of Today): quick to-dos for the day — type and press Enter, tick them off, click one to change
  it, **→ Task** to turn it into a real task, ✕ to delete. They're **private** (not even managers see them). One not
  ticked by the end of the day waits next morning under **Left from earlier**: *Do today*, *Make task* (a task for you,
  due today, opened so you can change the owner, deadline or steps) or *Delete*.
- **My output** (tab, everyone): one day at a time — tasks finished that day (with *on time / early / late* and
  sign-off status), daily updates written, mini tasks and checklist steps ticked, and **other work**: free-text lines
  for work that isn't a task (*Processed 12 supplier payments*), added for today only, and **focus time** from the focus
  timer. Managers see anyone in their
  department and senior executives their members (pick a person); members see their own. Ticked mini tasks show here
  to the person's managers; unticked ones stay private.
- **Daily update needed** (in a task): whoever gave the task, or a manager, switches it to *Every weekday* (the owner
  only on a task they made themselves). From the next weekday the owner writes a short **Daily update** in the task each
  weekday while it's open — it shows in the comments, on their output and in the giver's bell. *Update due* shows on the
  row; at **4:30 pm** there's one reminder for anything still missing. If a weekday's update was never written, the next
  morning **the app doesn't open** until it is (no skipping — "On leave" is an update too).
- **+ New task → Task · Mini task · Project**: one panel, three kinds of work.
  - **Mini task**: one line for a day — for yourself, or (managers and senior executives) for someone in your team. It
    lands on their Today list marked *from Hasith* and they get one alert; your Today shows **Given to others**, ticked
    or not. You can change or take back one until it's ticked; only they can tick it.
  - **Project**: one big task with **dated stages**. Each stage has a name, a date and a person (empty = the project
    owner). Projects don't repeat; their deadline is the **End date**.
- **Projects** (tab): every project with its status flag, progress (stages done), overdue stages, the next stage and the
  end date; *Open / Finished*; **+ New project**. The **project page** shows progress, a **timeline** of the stages (done /
  to do / overdue, today and the end date), the **status flag** — *On track / At risk / Off track* with a note, set by
  the owner, whoever gave it or a manager, with its history — the stages (tick, re-date, hand to someone else) and the
  notes and files. *Details, comments & history* opens the usual task panel.
- **Project stages**: someone given a stage gets one alert, can open the project (they're added as a helper quietly) and
  can tick **only their own** stages. Their stages show under **Your project stages** in Tasks and on Today when due.
  A stage past its date alerts the stage person and the project owner the next morning (once). At risk / Off track
  alerts whoever gave the project and the managers. Projects show in the normal lists with *◆ Project*, the flag and
  *◆ 2/5*.
- **Follow-ups — people outside the app** (tab): people without a login that you give work to — a bank officer, a
  supplier, a colleague elsewhere. **+ Add person** (name, company / role, phone, email, note), or pick *Given to someone
  outside the app → + Add someone new…* inside any task. The task's owner (you, or whoever you choose) follows up; the
  card shows *Given to Sampath Perera · DFCC Bank — you follow up*. The Follow-ups page shows each person with their open
  and overdue work, the last note from the comments, tap-to-call / email, and **Show finished** for the record.
  *I follow up* / *Everyone's* (managers and senior executives). **Remove** takes someone off the list but keeps their
  tasks; managers delete people no task mentions. Everyone in the department shares the list. Also a column in the
  Excel export. (They are not app users — Admin → People is only for logins.)
- **Managers' morning summary**: every weekday morning each manager (and senior executive, for members) gets one alert
  with what each person did on the last weekday, and who missed a daily update. Tapping it opens My output for that day.
- **Assigned by**: a task someone gave to someone else shows a line at the top of its card and of the opened task —
  the owner sees *Assigned by Hasith*, whoever gave it sees *Assigned by you → Kasun*, others see *Hasith → Kasun*.
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
- **Repeating tasks**: set *Repeat* to every day / weekdays (Mon–Fri) / every week / month / 3 months / year, with
  the same owner, helpers and checklist each time. Weekly and longer: the next one is created on schedule when this
  one is done (signed off). **Every day / Weekdays**: a new one appears each morning even if the last one isn't
  finished, so a missed day stays overdue and visible (no *Due today* or early-reminder alerts for these — they're due
  every day). To stop a series, set *Repeat* back to *Doesn't repeat* on the latest one.
- **Export to Excel** (Tasks list): every task you can see, plus a sheet of deadline moves. Also a backup.
- **Inside a task**: a **checklist** of steps with progress (e.g. 3/5), **files, screenshots and links**
  (paste a screenshot with Ctrl+V anywhere in the task), comments and history.
- **Helpers**: a task has one owner and can have helpers. Managers and senior executives add them.
  Helpers see the task under *Helping on* and on their calendar, get its alerts, and can comment,
  tick steps and add files. Only the owner (or the person who assigned it) marks it done or moves the deadline.
- **Notifications**: assigned to you, added as a helper, deadline moved, deadline missed (checked every morning at 7:00), due today, coming up (early reminder), not opened yet, finished — please sign off, signed off, sent back, waiting, comments, daily updates (and the 4:30 pm reminder), the managers' morning summary.

## The Notes app

- Pages with **sub-pages**, headings, bullets, numbered lists, **tickboxes**, simple **tables**, links,
  pasted **screenshots** and attached **files**. Saves as you type.
- Each page is **Private** until its owner shares it with the **whole department** or **chosen people**,
  as *can view* or *can edit*. Sub-pages follow their top-level page.
- **Link pages to tasks**: from the page, or from a task's *Notes pages* section.
- **→ Task**: put the cursor on a line (e.g. in meeting notes), press **→ Task**, pick who and when — the line
  becomes a task, links to it ("→ Task #18", Ctrl+click opens it) and shows under *Linked tasks*.
- If two people edit the same page at once, the second save is stopped and they choose whose version to keep.
- Off until you turn it on: **Admin console → Departments & apps → Notes** (whole department or chosen people).

## Messages

Open it with the **chat button** in the top bar (the number on it = unread messages).
- **Announcements**: managers post, everyone in the department is alerted (bell and phone) and presses **Got it**;
  the person who posted (and managers) see *Got it: 3 of 5* and who hasn't yet. Others can read but not post.
- **Team chat**: the whole department. Type **@** and a name to alert someone (only they get an alert; everyone else
  just sees it as unread).
- **One-to-one** (**+ New message**): private to the two people — managers and the administrator can't read them.
  Each new message alerts the other person's phone and shows on the chat button.
- **Ticks** on your messages: ✓ sent, ✓✓ grey = reached their app, ✓✓ blue = seen. In the team chat, tap the ticks
  to see who has seen it.
- **Reply** to a message, **edit** or **delete** your own within 15 minutes, **copy** text. Paste a screenshot straight
  into the box, or 📎 attach files and pictures (10 MB each).
- **Work in messages**: 📎 → *Task / Reminder / Note* attaches one as a card (attaching your private note can share it,
  view only, with the people in the chat). **Send as ▾** turns what you typed into a task, mini task or reminder for
  someone you can give work to, and sends it as a card. On any message, **⋯ → Make it a task / mini task / reminder**.
  Cards open the work for anyone allowed to see it; others see the title only (reminders offer **Remind me too**).
- **Ctrl+K** search finds words in conversations you're in.
- Switched on automatically for every department that has Tasks (update 10); turn it off or limit it to chosen people
  in **Admin console → Departments & apps → Messages**.

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
   9. `09_app_messages.sql`
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
2. App dropdown → **Admin console → Departments & apps** → add `Finance` (Tasks and Messages switch on automatically).
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
| `005_reminders_home_escalation.sql` | Quick reminders, pin & follow, escalation (includes 003 and 004) |
| `006_mini_tasks_daily_repeats.sql` | Mini tasks on Today, daily / weekday repeats (includes 003, 004 and 005) |
| `007_daily_updates_output.sql` | Daily updates on tasks, My output, other work, managers' morning summary (includes 003–006) |
| `008_follow_ups.sql` | People outside the app and the Follow-ups page (includes 003–007) |
| `009_projects_mini_tasks.sql` | Projects with stages, mini tasks for your team (includes 003–008) |
| `010_messages.sql` | Messages: announcements, team chat, one-to-one chats, work cards (includes 003–009) |
| `011_focus_timer.sql` | Focus timer (Pomodoro) and focus time on My output (includes 003–010 — run only this one) |

From update 5 on, each update includes all the earlier ones (built with `tools/compose_update.py`), so only the
newest needs running.

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
