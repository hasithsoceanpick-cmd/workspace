// Database tests for round 7: mini tasks on the Today page (private), daily / weekday repeating tasks.
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
const isoDow = iso => { const w = new Date(iso + 'T00:00:00Z').getUTCDay(); return w === 0 ? 7 : w; };
const system = async (sql, p = []) => {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.system','on',true)");
    const r = await c.query(sql, p);
    await c.query('commit');
    return r.rows;
  } finally { c.release(); }
};
const check = () => su('select public.run_deadline_check()');
const task = id => su('select * from tasks where id=$1', [id]).then(r => r[0]);

await su(`truncate notifications, task_activity, task_comments, task_helpers, task_checklist, task_attachments, time_blocks,
          notes_task_links, notes_files, notes_shares, notes_pages, tasks, daily_notes, app_members, department_apps,
          department_features, task_reminders, task_follows, task_minis restart identity cascade`);
await su(`delete from platform_admins; delete from profiles; delete from departments; delete from auth.users`);

const H = await signup('h@x.lk', 'Hasith'), N = await signup('n@x.lk', 'Nadeesha'), K = await signup('k@x.lk', 'Kasun'),
      A = await signup('a@x.lk', 'Amaya'), P = await signup('p@x.lk', 'Priya'), O = await signup('o@x.lk', 'Oshan');
const depts = (await as(H, `insert into departments (name) values ('Finance'), ('HR'), ('Stores') returning id, name`)).rows;
const FIN = depts.find(d => d.name === 'Finance').id, HR = depts.find(d => d.name === 'HR').id, ST = depts.find(d => d.name === 'Stores').id;
await as(H, `insert into department_apps (department_id, app_key) values ($1,'tasks'), ($2,'tasks')`, [FIN, HR]);
await as(H, `update profiles set department_id=$1, role='manager' where id=$2`, [FIN, H]);
await as(H, `update profiles set department_id=$1, role='senior', active=true where id=$2`, [FIN, N]);
await as(H, `update profiles set department_id=$1, role='member', active=true where id = any($2)`, [FIN, [K, A]]);
await as(H, `update profiles set department_id=$1, role='manager', active=true where id=$2`, [HR, P]);
await as(H, `update profiles set department_id=$1, role='member', active=true where id=$2`, [ST, O]);   // Stores has no Tasks app
const newTask = async (by, title, to, dueDate, repeat = null) =>
  (await as(by, `insert into tasks (title, assignee_id, due_date, repeat) values ($1, $2, $3, $4) returning *`, [title, to, dueDate, repeat]));

// =====================================================================
console.log('Mini tasks');
let r = await as(K, `insert into task_minis (body) values ('  Call the bank  ') returning *`);
const m1 = r.rows[0];
ok(m1 && m1.user_id === K && m1.department_id === FIN && m1.day === today && m1.body === 'Call the bank', 'a member adds a mini task for today (trimmed, in his department)');
r = await as(K, `insert into task_minis (body, user_id) values ('For Amaya', $1) returning user_id`, [A]);
ok(r.error?.includes('only give mini tasks to people in your team'), "a member can't put one on a colleague's list (round 9: leads can give them)");
r = await as(K, `insert into task_minis (body, day) values ('Plan for tomorrow', $1) returning day`, [addDays(today, 1)]);
ok(r.rows[0]?.day === addDays(today, 1), 'one can be added for another day');
ok((await as(K, `insert into task_minis (body) values ('   ')`)).error, 'an empty one is refused');
ok((await as(K, `insert into task_minis (body) values ($1)`, ['x'.repeat(301)])).error, 'a very long one is refused');

ok((await as(K, 'select id from task_minis')).rows.length === 2, 'he sees his own');
ok((await as(A, 'select id from task_minis')).rows.length === 0, 'a colleague in the same team sees none of them');
ok((await as(N, 'select id from task_minis')).rows.length === 0, 'his senior executive sees none of them');
ok((await as(H, 'select id from task_minis')).rows.length === 0, 'his manager (the admin) sees none of them — they are private');
ok((await as(P, 'select id from task_minis')).rows.length === 0, 'another department sees none of them');
ok((await as(null, 'select id from task_minis')).error, 'signed-out visitors are refused');

ok((await as(A, `update task_minis set body='hijack' where id=$1`, [m1.id])).count === 0, "a colleague can't change it");
ok((await as(H, `delete from task_minis where id=$1`, [m1.id])).count === 0, "the manager can't delete it");
ok((await as(P, `delete from task_minis where id=$1`, [m1.id])).count === 0, "another department can't delete it");

r = await as(K, `update task_minis set done_at=now() where id=$1 returning done_at`, [m1.id]);
ok(r.rows[0]?.done_at, 'he ticks it off');
r = await as(K, `update task_minis set user_id=$2, department_id=$3, done_at=null where id=$1 returning user_id, department_id`, [m1.id, A, HR]);
ok(r.rows[0]?.user_id === K && r.rows[0]?.department_id === FIN, "owner and department can't be changed");
const left = (await as(K, `insert into task_minis (body, day) values ('Yesterday''s left-over', $1) returning *`, [addDays(today, -1)])).rows[0];
r = await as(K, `update task_minis set day=$2 where id=$1 returning day`, [left.id, today]);
ok(r.rows[0]?.day === today, '"Do today" moves a left-over to today');
ok((await as(K, `delete from task_minis where id=$1`, [left.id])).count === 1, 'he deletes his own');

ok((await as(O, `insert into task_minis (body) values ('no app')`)).error, "someone without the Tasks app can't add any");
const before = (await su('select count(*)::int as n from task_minis'))[0].n;
await su(`delete from auth.users where id=$1`, [A]);
ok((await su('select count(*)::int as n from task_minis'))[0].n === before, 'removing a person only removes their own (Amaya had none)');

// =====================================================================
console.log('Daily and weekday repeats');
const A2 = await signup('a2@x.lk', 'Amali');
await as(H, `update profiles set department_id=$1, role='member', active=true where id=$2`, [FIN, A2]);
ok(!(await newTask(K, 'Bank balances', K, today, 'daily')).error, '"Every day" is accepted');
ok(!(await newTask(K, 'Cash book', K, today, 'weekdays')).error, '"Weekdays" is accepted');
ok((await newTask(K, 'Bad', K, today, 'hourly')).error, 'an unknown repeat is refused');

const dow = (d, rep) => su('select public.task_repeat_day($1::date, $2)::text as d', [d, rep]).then(x => x[0].d);
ok(await dow('2026-10-17', 'weekdays') === '2026-10-19' && await dow('2026-10-18', 'weekdays') === '2026-10-19'
   && await dow('2026-10-16', 'weekdays') === '2026-10-16', 'weekdays: Saturday and Sunday move to Monday, Friday stays');
ok(await dow('2026-10-17', 'daily') === '2026-10-17', 'every day: Saturday stays');

// on time: finishing today's makes tomorrow's
const d1 = (await newTask(K, 'Daily bank balance', K, today, 'daily')).rows[0];
await as(K, `insert into task_checklist (task_id, body) values ($1, 'Download statements')`, [d1.id]);
await as(K, `update tasks set status='done' where id=$1`, [d1.id]);
const d1x = await task(d1.id);
const d2 = await task(d1x.next_task_id);
ok(d2 && d2.due_date === addDays(today, 1) && d2.repeat === 'daily' && d2.series_id === d1.id && d2.repeat_n === 1,
  `finishing today's makes tomorrow's (${d2?.due_date})`);
ok((await su('select count(*)::int as n from task_checklist where task_id=$1', [d2.id]))[0].n === 1, 'with the same steps');
await check();
ok((await su('select count(*)::int as n from tasks where series_id=$1', [d1.id]))[0].n === 2, "the morning check doesn't add another one when tomorrow's is already there");

// missed: yesterday's still open → today's appears anyway, yesterday's stays overdue
const g = (await newTask(H, 'Post receipts', K, addDays(today, -1), 'daily')).rows[0];
await su('delete from notifications');
await check();
const gx = await task(g.id);
const gToday = gx.next_task_id && await task(gx.next_task_id);
ok(gToday && gToday.due_date === today && gToday.status === 'todo' && gx.status === 'todo',
  "missed day: today's task appears and yesterday's stays open");
ok(gToday.acknowledged_at !== null && gToday.created_by === H && gToday.assignee_id === K, 'same giver and owner, no "Got it" needed');
ok((await notices(K, 'overdue')).some(n => n.ref_id === g.id), 'the missed one still raises a missed-deadline alert');
ok(!(await notices(K, 'assigned')).some(n => n.ref_id === gToday.id), 'no "assigned you" alert for the routine copy');
await check();
ok((await su('select count(*)::int as n from tasks where series_id=$1', [g.id]))[0].n === 2, 'running the check again adds nothing');
await as(K, `update tasks set status='done' where id=$1`, [g.id]);
await as(H, `update tasks set status='done' where id=$1`, [g.id]);   // given by Hasith: he signs it off
ok((await task(g.id)).status === 'done' && (await su('select count(*)::int as n from tasks where series_id=$1', [g.id]))[0].n === 2,
  "finishing yesterday's late doesn't add another (today's is already there)");

// late finish when the morning check never ran: the next one is today, not the skipped days
const late = (await newTask(K, 'Petty cash count', K, addDays(today, -3), 'daily')).rows[0];
await as(K, `update tasks set status='done' where id=$1`, [late.id]);
const lateNext = await task((await task(late.id)).next_task_id);
ok(lateNext?.due_date === today, `finishing a 3-day-old one makes today's, not the skipped days (${lateNext?.due_date})`);

// weekdays: Friday's → Monday's
const fri = '2026-12-04';
const w = (await newTask(K, 'Weekday cash book', K, fri, 'weekdays')).rows[0];
await as(K, `update tasks set status='done' where id=$1`, [w.id]);
ok((await task((await task(w.id)).next_task_id))?.due_date === '2026-12-07', "weekdays: finishing Friday's makes Monday's");

// the morning check only adds weekday ones on weekdays
const wy = (await newTask(K, 'Weekday bank rec', K, addDays(today, -1), 'weekdays')).rows[0];
await check();
const wyNext = (await task(wy.id)).next_task_id;
ok(isoDow(today) >= 6 ? wyNext === null : (await task(wyNext))?.due_date === today,
  isoDow(today) >= 6 ? 'weekdays: nothing is added on a weekend' : "weekdays: today's appears on a weekday");

// weekly is unchanged
const wk = (await newTask(K, 'Weekly payroll check', K, '2026-12-01', 'weekly')).rows[0];
await as(K, `update tasks set status='done' where id=$1`, [wk.id]);
ok((await task((await task(wk.id)).next_task_id))?.due_date === '2026-12-08', 'weekly still lands 7 days later');

// no "due today" / "coming up" alerts for daily work
const dd = (await newTask(K, 'Daily VAT log', K, today, 'daily')).rows[0];
const nd = (await newTask(K, 'One-off report', K, today)).rows[0];
const soon = (await as(K, `insert into tasks (title, assignee_id, due_date, repeat, remind_days) values ('Daily soon', $1, $2, 'daily', 2) returning *`, [K, addDays(today, 1)])).rows[0];
await system(`update tasks set created_at = now() - interval '2 days' where id = any($1)`, [[dd.id, nd.id, soon.id]]);
await su('delete from notifications');
await check();
const dueToday = (await notices(K, 'due_today')).map(n => n.message).join(' ');
ok(dueToday.includes('One-off report') && !dueToday.includes('Daily VAT log'), '"Due today" skips daily work (it is due every day)');
ok(!(await notices(K, 'due_soon')).some(n => n.ref_id === soon.id), 'no "coming up" alert for daily work');

// someone who left: no new copies
const gone = (await newTask(H, 'Left person daily', A2, addDays(today, -1), 'daily')).rows[0];
await as(H, `update profiles set active=false where id=$1`, [A2]);
await check();
ok((await task(gone.id)).next_task_id === null, 'no new daily copies for someone who has been switched off');

// another department's series stays there
const hr = (await newTask(P, 'HR daily attendance', P, addDays(today, -1), 'daily')).rows[0];
await check();
const hrNext = await task((await task(hr.id)).next_task_id);
ok(hrNext?.department_id === HR, "an HR daily task's copy stays in HR");
ok((await as(K, 'select id from tasks where id=$1', [hrNext.id])).rows.length === 0, "Finance can't see it");

// stopping a series: switching repeat off
const stop = (await newTask(K, 'Stop me', K, addDays(today, -1), 'daily')).rows[0];
await as(K, `update tasks set repeat=null where id=$1`, [stop.id]);
await check();
ok((await task(stop.id)).next_task_id === null, 'switching "Repeats" off stops new copies');

// nobody can make copies by hand
r = await as(K, 'select public.task_repeat_spawn($1, $2::date, null)', [hr.id, today]);
ok(r.error && /permission denied/.test(r.error), "the copy-maker can't be called from the browser");

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
