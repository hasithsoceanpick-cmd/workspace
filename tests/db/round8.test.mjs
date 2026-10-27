// Database tests for round 8: daily updates on tasks (who switches them on, who writes them, the morning catch-up),
// "other work" lines, ticked mini tasks in someone's output, the 4:30 pm reminder and the managers' morning summary.
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
/** as the database itself, with every trigger off (to set up history on earlier days) */
async function raw(sql, p = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("set local session_replication_role = replica");
    const r = await c.query(sql, p);
    await c.query('commit');
    return r.rows;
  } finally { c.release(); }
}
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
const signup = async (email, name) => (await su(`insert into auth.users (email, raw_user_meta_data) values ($1,$2) returning id`, [email, { full_name: name }]))[0].id;
const notices = (u, kind) => su('select kind, message, ref_id from notifications where user_id=$1 and ($2::text is null or kind=$2) order by id', [u, kind ?? null]);
const today = (await su(`select public.app_today()::text as d`))[0].d;
const one = async (sql, p = []) => (await su(sql, p))[0];
const prevWork = (await one(`select public.task_prev_workday(public.app_today())::text as d`)).d;
const nextWork = (await one(`select public.task_repeat_day(public.app_today() + 1, 'weekdays')::text as d`)).d;
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const task = id => one('select * from tasks where id=$1', [id]);

await su(`truncate notifications, task_activity, task_comments, task_helpers, task_checklist, task_attachments, time_blocks,
          notes_task_links, notes_files, notes_shares, notes_pages, tasks, daily_notes, app_members, department_apps,
          department_features, task_reminders, task_follows, task_minis, task_work_log restart identity cascade`);
await su(`delete from platform_admins; delete from profiles; delete from departments; delete from auth.users`);

const H = await signup('h@x.lk', 'Hasith'), N = await signup('n@x.lk', 'Nadeesha'), K = await signup('k@x.lk', 'Kasun'),
      A = await signup('a@x.lk', 'Amaya'), N2 = await signup('s@x.lk', 'Sanduni'), P = await signup('p@x.lk', 'Priya'), D = await signup('d@x.lk', 'Dilan');
const depts = (await as(H, `insert into departments (name) values ('Finance'), ('HR') returning id, name`)).rows;
const FIN = depts.find(d => d.name === 'Finance').id, HR = depts.find(d => d.name === 'HR').id;
await as(H, `insert into department_apps (department_id, app_key) values ($1,'tasks'), ($2,'tasks')`, [FIN, HR]);
await as(H, `update profiles set department_id=$1, role='manager' where id=$2`, [FIN, H]);
await as(H, `update profiles set department_id=$1, role='senior', active=true where id = any($2)`, [FIN, [N, N2]]);
await as(H, `update profiles set department_id=$1, role='member', active=true where id = any($2)`, [FIN, [K, A]]);
await as(H, `update profiles set department_id=$1, role='manager', active=true where id=$2`, [HR, P]);
await as(H, `update profiles set department_id=$1, role='member', active=true where id=$2`, [HR, D]);
const newTask = async (by, title, to, extra = {}) => {
  const cols = ['title', 'assignee_id', 'due_date', ...Object.keys(extra)];
  const vals = [title, to, addDays(today, 5), ...Object.values(extra)];
  return as(by, `insert into tasks (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, vals);
};
const update = (by, id, text, day = today) => as(by, `insert into task_comments (task_id, body, daily_for) values ($1, $2, $3) returning *`, [id, text, day]);

// =====================================================================
console.log('Daily update needed: switching it on and off');
const t1 = (await newTask(H, 'Supplier payments run', K, { daily_update: true })).rows[0];
ok(t1.daily_update && t1.daily_update_from === nextWork, `whoever gives a task can ask for daily updates, starting next weekday (${t1.daily_update_from})`);
ok((await as(K, `update tasks set daily_update=false where id=$1`, [t1.id])).error?.includes('Only the person who gave this task'), "the owner can't switch it off");
ok((await as(N, `update tasks set daily_update=false where id=$1`, [t1.id])).error, "a senior executive who didn't give it can't either");
ok((await as(A, `update tasks set daily_update=false where id=$1`, [t1.id])).count === 0, 'a colleague who can\'t see it changes nothing');
let r = await as(H, `update tasks set daily_update=false where id=$1 returning daily_update, daily_update_from`, [t1.id]);
ok(r.rows[0].daily_update === false && r.rows[0].daily_update_from === null, 'whoever gave it switches it off');
r = await as(H, `update tasks set daily_update=true where id=$1 returning daily_update_from`, [t1.id]);
ok(r.rows[0].daily_update_from === nextWork, 'and on again (starts next weekday)');
const nt = (await newTask(N, "Nadeesha's request", K)).rows[0];
r = await as(H, `update tasks set daily_update=true where id=$1 returning daily_update`, [nt.id]);
ok(r.rows[0]?.daily_update === true, 'a manager can switch it on for any task in the department');
const own = (await newTask(K, 'My own long job', K)).rows[0];
r = await as(K, `update tasks set daily_update=true where id=$1 returning daily_update`, [own.id]);
ok(r.rows[0]?.daily_update === true, 'the owner can switch it on for a task they made themselves');
ok((await one(`select count(*)::int as n from task_activity where task_id=$1 and kind='edited' and new_value like '%daily updates%'`, [t1.id])).n >= 1,
  'switching it shows in the history');
// a new owner starts fresh
await raw(`update tasks set daily_update_from = $2 where id=$1`, [t1.id, addDays(today, -10)]);
r = await as(H, `update tasks set assignee_id=$2 where id=$1 returning daily_update_from`, [t1.id, A]);
ok(r.rows[0].daily_update_from === nextWork, 'handing it to someone else restarts it from the next weekday');
await as(H, `update tasks set assignee_id=$2 where id=$1`, [t1.id, K]);

// =====================================================================
console.log('Writing daily updates');
r = await update(K, t1.id, 'Batch 1 of 3 approved; waiting on Sampath bank limits');
ok(!r.error && r.rows[0].daily_for === today, 'the owner writes today\'s update');
const act = await one(`select kind, old_value, new_value from task_activity where task_id=$1 and kind='daily_update' order by id desc limit 1`, [t1.id]);
ok(act && act.old_value === today && act.new_value.startsWith('Batch 1 of 3'), 'it is in the history as a daily update');
let hn = await notices(H, 'daily_update');
ok(hn.length === 1 && hn[0].message.startsWith(`Kasun's daily update on "Supplier payments run": Batch 1`) && hn[0].ref_id === t1.id,
  'whoever gave the task gets it in the bell');
ok((await notices(K, 'daily_update')).length === 0 && (await notices(K, 'comment')).length === 0, 'the owner gets no alert about their own update');
ok((await update(A, t1.id, 'not mine')).error, 'someone else can\'t write it');
ok((await update(H, t1.id, 'manager writes')).error?.includes('Only the owner'), 'not even whoever gave it');
ok((await update(K, own.id, 'x', addDays(today, -9))).error?.includes('today or the last working day'), 'only for today or the last working day');
ok(!(await update(K, own.id, 'Caught up', prevWork)).error, 'the last working day is allowed (the morning catch-up)');
const plain = (await newTask(H, 'No updates needed', K)).rows[0];
ok((await update(K, plain.id, 'x')).error?.includes("doesn't need daily updates"), 'not on a task that doesn\'t need them');
r = await as(K, `insert into task_comments (task_id, body, daily_for, created_at) values ($1, 'backdated', $2, now() - interval '2 days') returning created_at > now() - interval '1 minute' as fresh`, [own.id, today]);
ok(r.rows[0]?.fresh, "the time it was written can't be faked");
r = await as(K, `insert into task_comments (task_id, body) values ($1, 'ordinary comment') returning daily_for`, [t1.id]);
ok(!r.error && r.rows[0].daily_for === null, 'ordinary comments still work');

// =====================================================================
console.log('The morning catch-up (the app waits until yesterday\'s updates are written)');
ok((await one(`select public.task_prev_workday('2026-10-12')::text as a, public.task_prev_workday('2026-10-17')::text as b,
                public.task_prev_workday('2026-10-18')::text as c, public.task_prev_workday('2026-10-15')::text as d`))
   .a === '2026-10-09', 'last working day: Monday → Friday');
const pw = await one(`select public.task_prev_workday('2026-10-17')::text as b, public.task_prev_workday('2026-10-18')::text as c, public.task_prev_workday('2026-10-15')::text as d`);
ok(pw.b === '2026-10-16' && pw.c === '2026-10-16' && pw.d === '2026-10-14', 'Saturday and Sunday → Friday; Thursday → Wednesday');

const g1 = (await newTask(H, 'VAT return workings', K, { daily_update: true })).rows[0];
const g2 = (await newTask(H, 'Debtor follow-ups', K, { daily_update: true })).rows[0];
const g3 = (await newTask(H, 'Finished on the day', K, { daily_update: true })).rows[0];
const g4 = (await newTask(H, 'Amaya task', A, { daily_update: true })).rows[0];
await raw(`update tasks set daily_update_from = $2 where id = any($1)`, [[g1.id, g2.id, g3.id, g4.id], addDays(prevWork, -3)]);
await raw(`update tasks set status='review', submitted_at = ($2::date + time '15:00') at time zone 'Asia/Colombo' where id=$1`, [g3.id, prevWork]);
let owed = (await as(K, 'select * from public.tasks_updates_owed()')).rows;
ok(owed.length === 2 && owed.every(o => o.day === prevWork) && owed.some(o => o.task_id === g1.id) && owed.some(o => o.task_id === g2.id),
  `Kasun is asked for yesterday's update on his two open tasks (${owed.length})`);
ok(!owed.some(o => o.task_id === g3.id), 'not for a task he finished that day');
ok(!owed.some(o => o.task_id === t1.id), 'not for a task switched on today (it starts next weekday)');
ok((await as(A, 'select * from public.tasks_updates_owed()')).rows.every(o => o.task_id === g4.id), 'each person only sees their own');
ok((await as(H, 'select * from public.tasks_updates_owed()')).rows.length === 0, 'nothing for the manager who gave them');
await update(K, g1.id, 'Reconciled input VAT for September', prevWork);
await update(K, g2.id, 'On leave', prevWork);
ok((await as(K, 'select * from public.tasks_updates_owed()')).rows.length === 0, 'once written (even "On leave"), the app opens');
const wk = await one(`select public.task_update_required(t, '2030-01-05') as sat, public.task_update_required(t, '2030-01-04') as fri
                      from tasks t where id=$1`, [g1.id]);
ok(wk.sat === false && wk.fri === true, 'weekdays only (no update needed for a Saturday)');
r = await as(H, `update tasks set daily_update=false where id=$1`, [g4.id]);
ok((await as(A, 'select * from public.tasks_updates_owed()')).rows.length === 0, 'switched off: nothing owed');

// repeating tasks keep it
const rp = (await newTask(K, 'Weekly bank rec', K, { daily_update: true, repeat: 'weekly' })).rows[0];
await as(K, `update tasks set status='done' where id=$1`, [rp.id]);
const rpn = await task((await task(rp.id)).next_task_id);
ok(rpn?.daily_update === true && rpn.daily_update_from === nextWork, 'the next copy of a repeating task still needs daily updates');

// =====================================================================
console.log('Other work (free text, today only)');
r = await as(K, `insert into task_work_log (body, day, user_id) values ('  Processed 12 supplier payments  ', $1, $2) returning *`, [addDays(today, -1), A]);
const w1 = r.rows[0];
ok(w1 && w1.user_id === K && w1.department_id === FIN && w1.day === today && w1.body === 'Processed 12 supplier payments',
  'a line is always his own, for today (an earlier day or someone else can\'t be chosen)');
ok((await as(K, `insert into task_work_log (body) values ('   ')`)).error, 'an empty line is refused');
await raw(`insert into task_work_log (department_id, user_id, day, body) values ($1, $2, $3, 'Old line')`, [FIN, K, addDays(today, -1)]);
const old = await one(`select id from task_work_log where body='Old line'`);
ok((await as(K, `update task_work_log set body='changed' where id=$1`, [old.id])).count === 0, "yesterday's lines can't be changed");
ok((await as(K, `delete from task_work_log where id=$1`, [old.id])).count === 0, "or deleted");
ok((await as(K, `update task_work_log set body='Processed 14 supplier payments' where id=$1`, [w1.id])).count === 1, "today's can");
ok((await as(K, 'select id from task_work_log')).rows.length === 2, 'he sees his own');
ok((await as(H, 'select id from task_work_log where user_id=$1', [K])).rows.length === 2, 'his manager sees them');
ok((await as(N, 'select id from task_work_log where user_id=$1', [K])).rows.length === 2, 'his senior executive sees them');
ok((await as(A, 'select id from task_work_log where user_id=$1', [K])).rows.length === 0, "a colleague doesn't");
ok((await as(P, 'select id from task_work_log where user_id=$1', [K])).rows.length === 0, "another department doesn't");
await as(N, `insert into task_work_log (body) values ('Bank meeting')`);
ok((await as(N2, 'select id from task_work_log where user_id=$1', [N])).rows.length === 0, "a senior executive doesn't see another senior's");
ok((await as(H, 'select id from task_work_log where user_id=$1', [N])).rows.length === 1, 'the manager sees the senior\'s');
ok((await as(A, `update task_work_log set body='x' where id=$1`, [w1.id])).count === 0 && (await as(H, `delete from task_work_log where id=$1`, [w1.id])).count === 0,
  "nobody else can change or delete them");

// =====================================================================
console.log('Mini tasks in the output: ticked ones only');
await as(K, `insert into task_minis (body) values ('Call Sampath bank'), ('Private thought')`);
await as(K, `update task_minis set done_at = now() where body = 'Call Sampath bank'`);
ok((await as(H, 'select body from task_minis where user_id=$1', [K])).rows.map(x => x.body).join() === 'Call Sampath bank', 'his manager sees only the ticked one');
ok((await as(N, 'select body from task_minis where user_id=$1', [K])).rows.length === 1, 'so does his senior executive');
ok((await as(A, 'select body from task_minis where user_id=$1', [K])).rows.length === 0, 'a colleague sees none');
ok((await as(P, 'select body from task_minis where user_id=$1', [K])).rows.length === 0, 'another department sees none');
ok((await as(H, `update task_minis set body='x' where user_id=$1`, [K])).count === 0, "the manager still can't change them");

// =====================================================================
console.log('Managers\' morning summary');
// what Kasun did on Monday 12 Oct
const mon = '2026-09-14', tue = '2026-09-15';   // a fixed Monday/Tuesday well before any test day
const at = (d, t) => `('${d}'::date + time '${t}') at time zone 'Asia/Colombo'`;
const s1 = (await newTask(H, 'Summary task A', K)).rows[0];
const s2 = (await newTask(H, 'Summary task B', K, { daily_update: true })).rows[0];
const s3 = (await newTask(H, 'Amaya flagged', A, { daily_update: true })).rows[0];
await raw(`update tasks set status='done', completed_at=${at(mon, '11:00')}, submitted_at=${at(mon, '11:00')} where id=$1`, [s1.id]);
await raw(`update tasks set daily_update_from='2026-09-01' where id = any($1)`, [[s2.id, s3.id]]);
await raw(`insert into task_minis (department_id, user_id, day, body, done_at) values ($1, $2, $3, 'Mon mini', ${at(mon, '09:00')})`, [FIN, K, mon]);
await raw(`insert into task_checklist (task_id, department_id, body, done, done_by, done_at) values ($1, $2, 'Mon step', true, $3, ${at(mon, '10:00')})`, [s2.id, FIN, K]);
await raw(`insert into task_comments (task_id, author_id, body, daily_for, created_at) values ($1, $2, 'Mon update', $3, ${at(mon, '17:00')})`, [s2.id, K, mon]);
await raw(`insert into task_work_log (department_id, user_id, day, body) values ($1, $2, $3, 'Mon other')`, [FIN, K, mon]);
const cnt = (await one(`select * from public.task_output_counts($1, $2, $3)`, [K, FIN, mon]));
ok(cnt.finished === 1 && cnt.minis === 1 && cnt.steps === 1 && cnt.updates === 1 && cnt.other === 1, `Monday's counts for Kasun (${JSON.stringify(cnt)})`);
await su('delete from notifications');
await su(`select public.task_output_summary($1)`, [tue]);
const hs = await notices(H, 'output_summary');
const msg = hs[0]?.message ?? '';
ok(hs.length === 1 && msg.startsWith('Mon 14 Sep — '), `the manager gets one summary for the last weekday (${msg.slice(0, 40)}…)`);
ok(msg.includes('Kasun 1 task finished, 1 update, 2 small items, 1 other'), 'with what each person did');
ok(msg.includes('Amaya nothing recorded') && msg.includes('Nadeesha') && msg.includes('Sanduni'), 'everyone in the department, including quiet days');
ok(msg.includes('Missed daily updates: Amaya') && !msg.includes('Missed daily updates: Kasun'), 'and who missed a daily update');
ok(!msg.includes('Hasith'), 'not about himself');
const ns = (await notices(N, 'output_summary'))[0]?.message ?? '';
ok(ns.includes('Kasun') && ns.includes('Amaya') && !ns.includes('Sanduni') && !ns.includes('Hasith'), 'a senior executive hears about members only');
ok((await notices(K, 'output_summary')).length === 0, 'members get none');
ok((await notices(P, 'output_summary'))[0]?.message.includes('Dilan') && !(await notices(P, 'output_summary'))[0]?.message.includes('Kasun'), 'HR\'s manager hears about HR only');
// an update written the next morning still counts as missed in the summary
await raw(`update task_comments set created_at = ${at(tue, '08:00')} where body = 'Mon update'`);
await su('delete from notifications');
await su(`select public.task_output_summary($1)`, [tue]);
ok((await notices(H, 'output_summary'))[0]?.message.includes('Missed daily updates: Amaya, Kasun'), 'an update written the next morning counts as missed');
// run by the morning check: once per day
await su('delete from notifications');
const isWeekday = (await one(`select extract(isodow from public.app_today()) < 6 as w`)).w;
await su('select public.run_deadline_check()'); await su('select public.run_deadline_check()');
ok((await notices(H, 'output_summary')).length === (isWeekday ? 1 : 0), isWeekday ? 'the morning check sends it once a day' : 'no summary on a weekend');

// =====================================================================
console.log('4:30 pm reminder');
await su('delete from notifications');
const weekday = (await one(`select extract(isodow from public.app_today()) < 6 as w`)).w;
await raw(`update tasks set daily_update_from = public.app_today() where id = any($1)`, [[g1.id, g2.id]]);
await raw(`update tasks set daily_update = false where id = any($1)`, [[s2.id, s3.id]]);   // the summary's test tasks
const at1615 = `(public.app_today() + time '16:15') at time zone 'Asia/Colombo'`, at1645 = `(public.app_today() + time '16:45') at time zone 'Asia/Colombo'`;
await su(`select public.run_update_reminder(${at1615})`);
ok((await notices(K, 'update_due')).length === 0, 'nothing before 4:30 pm');
await su(`select public.run_update_reminder(${at1645})`); await su(`select public.run_update_reminder(${at1645})`);
const ud = await notices(K, 'update_due');
ok(weekday ? ud.length === 1 && ud[0].message.includes('"Debtor follow-ups"') && ud[0].message.includes('"VAT return workings"') : ud.length === 0,
  weekday ? 'after 4:30 pm, one alert (only once) lists the tasks still needing today\'s update' : 'nothing at a weekend');
ok((await notices(H, 'update_due')).length === 0 && (await notices(A, 'update_due')).length === 0, 'only to people who still owe one');
await su('delete from notifications'); await su('select public.task_reminders_due()');
const lateNow = (await one(`select (now() at time zone 'Asia/Colombo')::time >= time '16:30' as l`)).l;
ok((await notices(K, 'update_due')).length === (weekday && lateNow ? 1 : 0), 'the every-minute reminder check sends it at the right time');
await update(K, g1.id, 'done today'); await update(K, g2.id, 'done today');
await su('delete from notifications'); await su(`select public.run_update_reminder(${at1645})`);
ok((await notices(K, 'update_due')).length === 0, 'nothing when every update is written');

// =====================================================================
console.log('Locked doors');
for (const [f, args] of [['task_output_summary', `'${tue}'::date`], ['task_output_counts', `'${K}'::uuid, '${FIN}'::uuid, '${mon}'::date`], ['run_update_reminder', 'now()']]) {
  r = await as(K, `select public.${f}(${args})`);
  ok(r.error && /permission denied/.test(r.error), `${f} can't be called from the browser`);
}
ok((await as(null, 'select * from public.tasks_updates_owed()')).error, 'signed-out visitors are refused');

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
