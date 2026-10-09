// Database tests for round 6: quick reminders (me or my team), pin & follow, escalation of long-overdue work.
// Run against a THROWAWAY local database only (see tests/README.md).
import pg from 'pg';
pg.types.setTypeParser(1082, v => v);
pg.types.setTypeParser(20, v => Number(v));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:54322/postgres' });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const su = async (sql, p = []) => (await pool.query(sql, p)).rows;
async function as(uid, sql, p = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(uid ? 'set local role authenticated' : 'set local role anon');
    if (uid) await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    const r = await c.query(sql, p);
    await c.query('commit');
    return { rows: r.rows, count: r.rowCount };
  } catch (e) { await c.query('rollback'); return { error: e.message, rows: [], count: 0 }; } finally { c.release(); }
}
const signup = async (email, name) => (await su(`insert into auth.users (email, raw_user_meta_data) values ($1,$2) returning id`, [email, { full_name: name }]))[0].id;
const notices = (u, kind) => su('select kind, message, ref_id from notifications where user_id=$1 and ($2::text is null or kind=$2) order by id', [u, kind ?? null]);
const today = (await su(`select public.app_today()::text as d`))[0].d;
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const housekeeping = (sql) => su(`do $$ begin perform set_config('app.system','on',true); ${sql}; perform set_config('app.system','off',true); end $$`);
const due = () => su('select public.task_reminders_due() as n');

await su(`truncate notifications, task_activity, task_comments, task_helpers, task_checklist, task_attachments, time_blocks,
          notes_task_links, notes_files, notes_shares, notes_pages, tasks, daily_notes, app_members, department_apps,
          department_features, task_reminders, task_follows restart identity cascade`);
await su(`delete from platform_admins; delete from profiles; delete from departments; delete from auth.users`);

const H = await signup('h@x.lk', 'Hasith'), N = await signup('n@x.lk', 'Nadeesha'), K = await signup('k@x.lk', 'Kasun'),
      A = await signup('a@x.lk', 'Amaya'), P = await signup('p@x.lk', 'Priya'), D = await signup('d@x.lk', 'Dilan');
const depts = (await as(H, `insert into departments (name) values ('Finance'), ('HR') returning id, name`)).rows;
const FIN = depts.find(d => d.name === 'Finance').id, HR = depts.find(d => d.name === 'HR').id;
await as(H, `insert into department_apps (department_id, app_key) values ($1,'tasks'), ($2,'tasks')`, [FIN, HR]);
await as(H, `update profiles set department_id=$1, role='manager' where id=$2`, [FIN, H]);
await as(H, `update profiles set department_id=$1, role='senior', active=true where id=$2`, [FIN, N]);
await as(H, `update profiles set department_id=$1, role='member', active=true where id = any($2)`, [FIN, [K, A]]);
await as(H, `update profiles set department_id=$1, role='manager', active=true where id=$2`, [HR, P]);
await as(H, `update profiles set department_id=$1, role='member', active=true where id=$2`, [HR, D]);
const newTask = async (by, title, to, dueDate = addDays(today, 5)) =>
  (await as(by, `insert into tasks (title, assignee_id, due_date) values ($1, $2, $3) returning *`, [title, to, dueDate])).rows[0];
const remind = (by, body, to, at = "now() - interval '1 minute'", extra = '') =>
  as(by, `insert into task_reminders (body, user_id, remind_at${extra ? ', ' + extra.split('=')[0] : ''}) values ($1, $2, ${at}${extra ? ', ' + extra.split('=')[1] : ''}) returning *`, [body, to]);

// =====================================================================
console.log('Quick reminders');
let r = await remind(K, 'Call Sampath bank about the charges', K);
const r1 = r.rows[0];
ok(r1 && r1.department_id === FIN && r1.created_by === K && r1.sent_at === null, 'a member saves a reminder for himself');
const later = (await remind(K, 'Later one', K, "now() + interval '2 hours'")).rows[0];
await su('delete from notifications');
await due();
let n = await notices(K, 'reminder');
ok(n.length === 1 && n[0].message === 'Reminder: Call Sampath bank about the charges', 'at its time it pops up in his bell (and phone)');
await due();
ok((await notices(K, 'reminder')).length === 1, 'only once');
ok((await su('select sent_at from task_reminders where id=$1', [later.id]))[0].sent_at === null, 'a reminder for later waits');
r = await as(K, `update task_reminders set remind_at = now() - interval '1 second' where id=$1 returning sent_at`, [r1.id]);
ok(r.rows[0].sent_at === null, 'snoozing makes it due again');
await due();
ok((await notices(K, 'reminder')).length === 2, 'and it pops up again at the new time');
r = await as(K, `update task_reminders set done_at = now(), remind_at = now() - interval '1 second' where id=$1 returning done_at`, [r1.id]);
await due();
ok(r.rows[0].done_at && (await notices(K, 'reminder')).length === 2, 'once done it stays quiet');

const daily = (await remind(K, 'Check bank balances', K, "now() - interval '3 days 1 minute'", "repeat='daily'")).rows[0];
await due();
const nd = (await su('select remind_at > now() as fut, remind_at < now() + interval \'1 day\' as soon from task_reminders where id=$1', [daily.id]))[0];
ok(nd.fut && nd.soon && (await notices(K, 'reminder')).length === 3, 'a daily reminder sends once and moves to its next time (no catch-up flood)');
const fri = (await su(`select (public.task_reminder_next('2026-10-09 09:00+05:30', 'weekdays') at time zone 'Asia/Colombo')::text as t`))[0].t;
ok(fri === '2026-10-12 09:00:00', `weekdays: Friday 9:00 → Monday 9:00 (${fri})`);
const mon = (await su(`select (public.task_reminder_next('2026-01-31 09:00+05:30', 'monthly') at time zone 'Asia/Colombo')::date::text as d`))[0].d;
ok(mon === '2026-02-28', 'monthly: 31 Jan → 28 Feb');

r = await remind(N, 'Send the TT copy', K);
ok(!r.error && r.rows[0].user_id === K && r.rows[0].created_by === N, 'a senior executive sets a reminder for a member');
await su('delete from notifications');
await due();
n = await notices(K, 'reminder');
ok(n.length === 1 && n[0].message === 'Reminder from Nadeesha: Send the TT copy', 'it says who it is from');
const forK = r.rows[0];
ok((await as(N, `select * from task_reminders where id=$1`, [forK.id])).rows.length === 1, 'whoever set it can see it');
ok((await as(K, `select * from task_reminders`)).rows.length === 4, 'he sees all his own');
ok((await as(A, `select * from task_reminders`)).rows.length === 0, "colleagues can't see anyone's reminders");
ok((await as(H, `select * from task_reminders`)).rows.length === 0, "even the manager can't read others' reminders");
r = await remind(K, 'Sneaky', A);
ok(/only set reminders for yourself or people in your team/.test(r.error || ''), 'a member can only remind himself');
r = await remind(N, 'Boss', H);
ok(!!r.error, "a senior can't set one for the manager");
r = await remind(P, 'Cross', K);
ok(!!r.error, "HR's manager can't set one for Finance");
r = await remind(H, 'Admin to HR', D);
ok(!r.error && r.rows[0].department_id === HR, 'the admin can, in any department');
r = await as(A, `update task_reminders set body='x' where id=$1`, [forK.id]);
ok(r.count === 0, "nobody else can change it");
r = await as(A, `delete from task_reminders where id=$1`, [forK.id]);
ok(r.count === 0, "or delete it");
r = await as(K, `update task_reminders set user_id=$2, created_by=$2 where id=$1 returning user_id, created_by`, [forK.id, A]);
ok(r.rows[0]?.user_id === K && r.rows[0]?.created_by === N, "who it's for and who set it can't be changed");
const kt = await newTask(H, 'VAT return', K);
const hrTask = await newTask(P, 'Payroll', D);
r = await remind(K, 'About VAT', K, "now() + interval '1 hour'", `task_id=${kt.id}`);
ok(!r.error && r.rows[0].task_id === kt.id, 'a reminder can be about one of his tasks');
r = await remind(K, 'About HR', K, "now() + interval '1 hour'", `task_id=${hrTask.id}`);
ok(/isn't one you can see/.test(r.error || ''), "but not about a task he can't see");
await as(K, `update task_reminders set remind_at = now() - interval '1 second' where task_id=$1`, [kt.id]);
await su('delete from notifications');
await due();
ok((await notices(K, 'reminder'))[0]?.ref_id === kt.id, 'tapping that one opens the task');
r = await as(K, `delete from task_reminders where id=$1`, [later.id]);
ok(r.count === 1, 'he can delete his own');
await as(H, `update profiles set active=false where id=$1`, [A]);
r = await remind(A, 'Inactive', A);
ok(!!r.error, 'someone deactivated cannot save reminders');
await as(H, `update profiles set active=true where id=$1`, [A]);

// =====================================================================
console.log('Pin & follow');
const ft = await newTask(H, 'Supplier statement', K);
r = await as(N, `insert into task_follows (task_id, following) values ($1, true) returning *`, [ft.id]);
ok(!r.error && r.rows[0].user_id === N && r.rows[0].department_id === FIN, 'a senior follows a member\'s task');
r = await as(A, `insert into task_follows (task_id, following) values ($1, true)`, [ft.id]);
ok(!!r.error, "a colleague can't follow a task she can't see");
r = await as(H, `insert into task_follows (task_id, user_id, pinned) values ($1, $2, true) returning user_id`, [ft.id, K]);
ok(r.rows[0]?.user_id === H, 'you can only pin or follow for yourself');
ok((await as(D, `select * from task_follows`)).rows.length === 0 && (await as(K, `select * from task_follows`)).rows.length === 0,
   "nobody sees other people's pins (not even the owner; not HR)");
await su('delete from notifications');
await as(K, `insert into task_comments (task_id, body) values ($1, 'Statement received')`, [ft.id]);
await as(K, `update tasks set due_date=$2 where id=$1`, [ft.id, addDays(today, 7)]);
await as(K, `update tasks set status='done' where id=$1`, [ft.id]);
await as(H, `update tasks set status='done' where id=$1`, [ft.id]);
const kinds = (await notices(N)).map(x => x.kind);
ok(kinds.includes('comment') && kinds.includes('due_moved') && kinds.includes('signed_off'), `followers get the task's alerts (${kinds.join(', ')})`);
await as(N, `update task_follows set following=false where task_id=$1`, [ft.id]);
await su('delete from notifications');
await as(K, `insert into task_comments (task_id, body) values ($1, 'Another')`, [ft.id]);
ok((await notices(N, 'comment')).length === 0, 'unfollowing stops them');
const ft2 = await newTask(H, 'Petty cash', K);
await as(N, `insert into task_follows (task_id, following) values ($1, true)`, [ft2.id]);
await as(H, `update profiles set role='member' where id=$1`, [N]);
await su('delete from notifications');
await as(K, `insert into task_comments (task_id, body) values ($1, 'Counted')`, [ft2.id]);
ok((await notices(N, 'comment')).length === 0, "someone who can no longer see the task gets nothing");
await as(H, `update profiles set role='senior' where id=$1`, [N]);
r = await as(N, `update task_follows set pinned=true where task_id=$1 returning pinned`, [ft2.id]);
ok(r.rows[0]?.pinned === true, 'pinning is a simple on/off');

// =====================================================================
console.log('Escalation');
const e3 = await newTask(H, 'Bank rec — HNB', K, addDays(today, -3));
const e2 = await newTask(H, 'Two days late', K, addDays(today, -2));
const er = await newTask(H, 'Finished but late', K, addDays(today, -5));
await as(K, `update tasks set status='done' where id=$1`, [er.id]);         // waiting for sign-off
await as(N, `insert into task_follows (task_id, following) values ($1, true)`, [e3.id]);
await su('delete from notifications');
await su('select public.run_deadline_check()');
const hEsc = await notices(H, 'escalated');
ok(hEsc.length === 1 && hEsc[0].ref_id === e3.id && /Escalated: Kasun's "Bank rec — HNB" is 3 days past its deadline/.test(hEsc[0].message),
   '3 days after the deadline the manager is told');
ok((await notices(K, 'escalated'))[0]?.message.startsWith('Escalated to your manager'), 'the owner knows it went up');
ok((await notices(N, 'escalated')).length === 1, 'followers too');
ok((await su('select escalated_at is not null as e from tasks where id=$1', [e2.id]))[0].e === false, 'not before 3 days');
ok((await su('select escalated_at is not null as e from tasks where id=$1', [er.id]))[0].e === false, 'not when it is waiting for sign-off');
await su('select public.run_deadline_check()');
ok((await notices(H, 'escalated')).length === 1, 'only once per deadline');
r = await as(K, `update tasks set escalated_at=null where id=$1 returning escalated_at`, [e3.id]);
ok(r.rows[0].escalated_at !== null, "the flag can't be cleared from the browser");
r = await as(K, `update tasks set due_date=$2 where id=$1 returning escalated_at`, [e3.id, addDays(today, 2)]);
ok(r.rows[0].escalated_at === null, 'a new deadline clears the flag');
const hrLate = await newTask(P, 'HR late', D, addDays(today, -4));
await su('delete from notifications');
await su('select public.run_deadline_check()');
ok((await notices(P, 'escalated')).length === 1 && (await notices(H, 'escalated')).length === 0, "HR's escalation goes to HR's manager only");
void hrLate;

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
