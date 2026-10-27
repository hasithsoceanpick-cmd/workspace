// Database tests for round 12: the focus timer (Pomodoro) — sessions recorded for My output, each person's lengths —
// and changing a reminder's words, date and time (the person reminded, or whoever set it).
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
const today = (await su(`select public.app_today()::text as d`))[0].d;
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

await su(`truncate notifications, task_activity, task_comments, task_helpers, task_checklist, task_attachments, time_blocks,
          notes_task_links, notes_files, notes_shares, notes_pages, tasks, daily_notes, app_members, department_apps,
          department_features, task_reminders, task_follows, task_minis, task_work_log, task_contacts, task_focus,
          task_focus_settings restart identity cascade`);
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

const kTask = (await as(H, `insert into tasks (title, assignee_id, due_date) values ('Bank rec', $1, $2) returning id`, [K, addDays(today, 2)])).rows[0].id;
const aTask = (await as(H, `insert into tasks (title, assignee_id, due_date) values ('WHT schedule', $1, $2) returning id`, [A, addDays(today, 2)])).rows[0].id;
const focus = (uid, mins, planned, done, task = null, startedAgo = mins) => as(uid,
  `insert into task_focus (task_id, started_at, ended_at, planned_min, minutes, completed)
   values ($1, date_trunc('second', now()) - make_interval(mins => $2::int), now(), $3, $4, $5) returning *`, [task, startedAgo, planned, mins, done]);

// =====================================================================
console.log('Focus sessions');
let r = await focus(K, 25, 25, true, kTask);
const f1 = r.rows[0];
ok(f1 && f1.user_id === K && f1.department_id === FIN && f1.completed && f1.minutes === 25, 'Kasun records a finished 25-minute focus on his task');
ok((await as(K, `insert into task_focus (task_id, started_at, planned_min, minutes, completed) values ($1, $2, 25, 25, true)`, [kTask, f1.started_at])).error,
  'the same session can\'t be recorded twice (two open tabs)');
r = await focus(K, 10, 25, true, null, 12);
ok(r.rows[0]?.minutes === 10 && r.rows[0].completed === false, 'stopped early: 10 of 25 minutes, not counted as finished');
r = await focus(K, 50, 50, true, null, 20);
ok(r.rows[0]?.minutes <= 22 && r.rows[0].completed === false, "can't claim more minutes than the time gone by");
ok((await focus(K, 25, 25, true, aTask, 30)).error?.includes("isn't one you can see"), "can't attach a session to a task he can't see");
r = await as(K, `insert into task_focus (user_id, started_at, planned_min, minutes) values ($1, now() - interval '30 minutes', 25, 25) returning user_id`, [A]);
ok(r.rows[0]?.user_id === K || r.error, 'a session is always his own (never recorded for someone else)');
ok((await as(K, `insert into task_focus (started_at, planned_min, minutes) values (now() - interval '3 days', 25, 25)`)).error,
  "old days can't be filled in afterwards");
r = await as(K, `insert into task_focus (started_at, ended_at, planned_min, minutes, completed) values (now() - interval '22 minutes', now() + interval '3 minutes', 25, 25, true) returning *`);
ok(r.rows[0] && new Date(r.rows[0].ended_at) <= new Date() && r.rows[0].minutes === 25 && r.rows[0].completed,
  'a device whose clock runs a few minutes fast still records its slot (ending now)');
ok((await as(K, `insert into task_focus (started_at, ended_at, planned_min, minutes) values (now() + interval '1 hour', now() + interval '50 minutes', 25, 25)`)).error,
  "a slot can't start after it ends");
ok((await as(K, `insert into task_focus (started_at, planned_min, minutes) values (now() - interval '5 hours', 300, 300)`)).error,
  'up to 4 hours per session');
await focus(A, 25, 25, true, aTask, 40);
await focus(D, 25, 25, true, null, 40);

ok((await as(K, 'select id from task_focus')).rows.every(x => true) && (await as(K, 'select user_id from task_focus')).rows.every(x => x.user_id === K), 'Kasun sees only his own');
ok((await as(A, 'select user_id from task_focus')).rows.every(x => x.user_id === A), "Amaya can't see Kasun's");
r = await as(N, 'select distinct user_id from task_focus');
ok(r.rows.length === 2 && r.rows.every(x => [K, A].includes(x.user_id)), "their senior executive sees the members' (My output)");
r = await as(H, 'select distinct department_id from task_focus');
const finAll = (await su('select count(*)::int n from task_focus where department_id = $1', [FIN]))[0].n;
ok(finAll >= 4 && (await as(H, 'select count(*)::int n from task_focus where department_id = $1', [FIN])).rows[0].n === finAll, 'the manager sees the whole department');
ok((await as(P, 'select count(*)::int n from task_focus where department_id = $1', [FIN])).rows[0].n === 0, "HR's manager sees none of Finance's");
ok((await as(K, `update task_focus set minutes = 99 where id = $1`, [f1.id])).error, 'a recorded session never changes');
ok((await as(H, `delete from task_focus where id = $1`, [f1.id])).count === 0, "the manager can't remove Kasun's sessions");
ok((await as(K, `delete from task_focus where id = $1`, [f1.id])).count === 1, "Kasun can remove today's mistaken one");
await as(K, `insert into task_focus (task_id, started_at, planned_min, minutes, completed) values ($1, now() - interval '50 minutes', 25, 25, true)`, [kTask]);
const kBefore = (await su(`select count(*)::int n from task_focus where user_id = $1`, [K]))[0].n;
await su(`delete from tasks where id = $1`, [kTask]);
ok((await su(`select count(*)::int n from task_focus where user_id = $1`, [K]))[0].n === kBefore
   && (await su(`select count(*)::int n from task_focus where user_id = $1 and task_id is not null`, [K]))[0].n === 0,
   'deleting a task keeps the focus time (just without the task)');

console.log('Lengths');
r = await as(K, 'select * from public.task_focus_save(50, 10, 20, 3, false)');
ok(r.rows[0]?.focus_min === 50 && r.rows[0].short_min === 10 && r.rows[0].long_min === 20 && r.rows[0].rounds === 3 && r.rows[0].sound === false, 'Kasun saves his lengths');
r = await as(K, 'select * from public.task_focus_save(45, 10, 20, 3, true)');
ok(r.rows[0]?.focus_min === 45 && (await su('select count(*)::int n from task_focus_settings'))[0].n === 1, 'saving again changes the same row');
ok((await as(K, 'select * from public.task_focus_save(0, 5, 15, 4, true)')).error && (await as(K, 'select * from public.task_focus_save(25, 5, 15, 40, true)')).error,
  'lengths must be sensible (1–180 min focus, 1–12 rounds)');
ok((await as(A, 'select * from task_focus_settings')).rows.length === 0, "nobody else can read his lengths");
ok((await as(A, `update task_focus_settings set focus_min = 1 where user_id = $1`, [K])).count === 0, 'or change them');

// =====================================================================
console.log('Reminders: another date and time, new words');
const at = (h) => `now() + interval '${h} hours'`;
const rk = (await as(K, `insert into task_reminders (body, remind_at) values ('Call Sampath', ${at(2)}) returning *`)).rows[0];
const rh = (await as(H, `insert into task_reminders (body, remind_at, user_id) values ('Send VAT file', ${at(3)}, $1) returning *`, [A])).rows[0];
await su(`update task_reminders set sent_at = now() where id = any($1)`, [[rk.id, rh.id]]);
r = await as(K, `update task_reminders set remind_at = $2, body = 'Call Sampath about the limits' where id = $1 returning remind_at, body, sent_at`,
  [rk.id, `${addDays(today, 3)}T14:30:00+05:30`]);
ok(r.rows[0]?.body === 'Call Sampath about the limits' && new Date(r.rows[0].remind_at).toISOString() === new Date(`${addDays(today, 3)}T14:30:00+05:30`).toISOString()
   && r.rows[0].sent_at === null, 'Kasun moves his reminder to a chosen date and time and changes the words (it will alert again)');
r = await as(H, `update task_reminders set remind_at = ${at(5)}, body = 'Send the VAT file to EY' where id = $1 returning body`, [rh.id]);
ok(r.rows[0]?.body === 'Send the VAT file to EY', 'Hasith changes the one he set for Amaya');
r = await as(A, `update task_reminders set remind_at = ${at(6)} where id = $1 returning id`, [rh.id]);
ok(r.count === 1, 'Amaya can move it too (it is hers)');
ok((await as(N, `update task_reminders set body = 'x' where id = $1`, [rh.id])).count === 0, 'nobody else can');
r = await as(H, `update task_reminders set user_id = $2 where id = $1 returning user_id`, [rh.id, K]);
ok(r.rows[0]?.user_id === A, "changing it never hands it to someone else");
ok((await as(K, `update task_reminders set body = '   ' where id = $1`, [rk.id])).error, 'the words can\'t be left empty');

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
