// Database tests for deadline history, repeating tasks, first sign-in of older logins,
// the Monday summary alert and the Month-end declaration feature.
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

await su(`truncate notifications, task_activity, task_comments, task_helpers, task_checklist, task_attachments, time_blocks,
          notes_task_links, notes_files, notes_shares, notes_pages, tasks, daily_notes, app_members, department_apps,
          department_features, month_end_entries, month_end_periods, month_end_items restart identity cascade`);
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

console.log('Deadline history');
const t1 = (await as(H, `insert into tasks (title, assignee_id, due_date) values ('VAT return', $1, $2) returning id, original_due, due_moves`, [K, addDays(today, 3)])).rows[0];
ok(t1.original_due === addDays(today, 3) && t1.due_moves === 0, 'a new task remembers its first deadline');
await as(K, `update tasks set due_date=$2 where id=$1`, [t1.id, addDays(today, 5)]);
await as(K, `update tasks set due_date=$2 where id=$1`, [t1.id, addDays(today, 6)]);
let r = (await su(`select original_due, due_moves from tasks where id=$1`, [t1.id]))[0];
ok(r.original_due === addDays(today, 3) && r.due_moves === 2, 'each move is counted; the first deadline is kept');
r = await as(K, `update tasks set due_moves=0, original_due=$2 where id=$1 returning due_moves, original_due`, [t1.id, addDays(today, 6)]);
ok(r.rows[0].due_moves === 2 && r.rows[0].original_due === addDays(today, 3), "nobody can rewrite the history from the browser");
await as(K, `update tasks set title='VAT return (Sept)' where id=$1`, [t1.id]);
ok((await su(`select due_moves from tasks where id=$1`, [t1.id]))[0].due_moves === 2, 'other edits do not count as moves');

console.log('Repeating tasks');
const anchor = '2026-01-31';
const rt = (await as(H, `insert into tasks (title, assignee_id, due_date, repeat) values ('WHT schedule', $1, $2, 'monthly') returning id, repeat_anchor`, [K, anchor])).rows[0];
ok(rt.repeat_anchor === anchor, 'a repeating task starts its series on its deadline');
await as(H, `insert into task_checklist (task_id, body, position) values ($1, 'Collect certificates', 1), ($1, 'Upload to RAMIS', 2)`, [rt.id]);
await as(H, `insert into task_helpers (task_id, user_id) values ($1, $2)`, [rt.id, A]);
await as(K, `update task_checklist set done=true where task_id=$1`, [rt.id]);
await su('delete from notifications');
r = await as(K, `update tasks set status='done' where id=$1 returning next_task_id`, [rt.id]);
const n1 = (await su(`select next_task_id from tasks where id=$1`, [rt.id]))[0].next_task_id;
const next1 = (await su(`select * from tasks where id=$1`, [n1]))[0];
ok(!!next1 && next1.due_date === '2026-02-28' && next1.status === 'todo' && next1.assignee_id === K && next1.department_id === FIN,
   'completing it creates the next one (31 Jan → 28 Feb)');
ok(next1.created_by === H && next1.repeat === 'monthly' && next1.repeat_n === 1, 'the next one keeps who assigned it and the schedule');
const steps = await su(`select body, done from task_checklist where task_id=$1 order by position`, [n1]);
ok(steps.length === 2 && steps.every(s => !s.done), 'its checklist is copied, unticked');
ok((await su(`select count(*)::int n from task_helpers where task_id=$1 and user_id=$2`, [n1, A]))[0].n === 1, 'helpers are copied too');
ok((await notices(A, 'helper')).length === 0, 'without a fresh "added as helper" alert');
ok((await su(`select count(*)::int n from task_activity where task_id=$1 and kind='repeated'`, [n1]))[0].n === 1, 'the history says where it came from');
await as(K, `update tasks set status='todo' where id=$1`, [rt.id]);
await as(K, `update tasks set status='done' where id=$1`, [rt.id]);
ok((await su(`select count(*)::int n from tasks where title='WHT schedule'`))[0].n === 2, 'reopening and finishing again does not create a duplicate');
await as(K, `update tasks set due_date='2026-03-05' where id=$1`, [n1]);
await as(K, `update tasks set status='done' where id=$1`, [n1]);
const n2 = (await su(`select next_task_id from tasks where id=$1`, [n1]))[0].next_task_id;
ok((await su(`select due_date from tasks where id=$1`, [n2]))[0].due_date === '2026-03-31', 'a moved deadline does not shift the schedule (→ 31 Mar)');
const wk = (await as(K, `insert into tasks (title, assignee_id, due_date, repeat) values ('Petty cash', $1, '2026-10-05', 'weekly') returning id`, [K])).rows[0].id;
await as(K, `update tasks set status='done' where id=$1`, [wk]);
ok((await su(`select t2.due_date from tasks t join tasks t2 on t2.id = t.next_task_id where t.id=$1`, [wk]))[0]?.due_date === '2026-10-12', 'weekly works');
r = await as(A, `update tasks set repeat='weekly' where id=$1`, [n2]);
ok(r.count === 0, 'a helper cannot change the repeat');

console.log('Older logins');
const Z = await signup('zumra@x.lk', 'Zumra');
await su(`delete from profiles where id=$1`, [Z]);        // a login made for an older app in the same project
await su('delete from notifications');
await as(Z, `select public.ensure_profile()`);
r = (await su(`select active, department_id from profiles where id=$1`, [Z]))[0];
ok(r && r.active === false && r.department_id === null, 'first sign-in creates a profile waiting for approval');
ok((await notices(H, 'signup')).length === 1, 'the admin is told');
await as(Z, `select public.ensure_profile()`);
ok((await notices(H, 'signup')).length === 1, 'signing in again does nothing more');
await as(K, `select public.ensure_profile()`);
ok((await su(`select role from profiles where id=$1`, [K]))[0].role === 'member', "existing people aren't touched");

console.log('Monday summary alert');
const isMonday = (await su(`select extract(isodow from public.app_today())::int d`))[0].d === 1;
await su('delete from notifications');
await as(K, `select public.run_deadline_check()`);
await as(K, `select public.run_deadline_check()`);
const weekly = await su(`select user_id from notifications where kind='weekly'`);
if (isMonday) ok(weekly.length === 2 && weekly.every(w => [H, P].includes(w.user_id)), 'on Mondays each manager gets one weekly-summary alert');
else ok(weekly.length === 0, 'no weekly-summary alert on other days');

console.log('Month-end declaration');
r = await as(N, `insert into month_end_items (code, category, title, owner_id) values ('MEC-01','MEC','Bank recs done',$1)`, [K]);
ok(!!r.error, "can't add lines while the feature is off");
await as(H, `insert into department_features (department_id, feature_key) values ($1, 'month_end')`, [FIN]);
r = await as(N, `insert into month_end_items (code, category, title, owner_id, due_day, position) values
   ('MEC-01','MEC','All bank accounts reconciled',$1,10,1), ('MEC-02','MEC','Petty cash counted',$2,15,2),
   ('CMP-01','CMP','VAT return filed',$1,31,3) returning department_id`, [K, A]);
ok(!r.error && r.rows.every(x => x.department_id === FIN), 'a senior builds the master list');
r = await as(K, `insert into month_end_items (title) values ('sneaky')`);
ok(!!r.error, 'a member cannot change the master list');
r = await as(N, `insert into month_end_items (title, owner_id) values ('wrong owner', $1)`, [D]);
ok(/owner must be/.test(r.error || ''), 'line owners must be in the department');
r = await as(K, `select public.month_end_start($1, '2026-09-01')`, [FIN]);
ok(!!r.error, 'a member cannot start a month');
const pid = (await as(N, `select public.month_end_start($1, '2026-09-15') as id`, [FIN])).rows[0]?.id;
const ents = await su(`select * from month_end_entries where period_id=$1 order by position`, [pid]);
ok(ents.length === 3 && ents[0].due_date === '2026-10-10' && ents[2].due_date === '2026-10-31', 'starting September copies the list, due in October');
ok((await as(N, `select public.month_end_start($1, '2026-09-01') as id`, [FIN])).rows[0].id === pid, 'starting it again opens the same month');
ok((await as(D, `select * from month_end_entries`)).rows.length === 0 && (await as(P, `select * from month_end_periods`)).rows.length === 0, 'HR cannot see Finance declarations');
r = await as(P, `select public.month_end_start($1, '2026-09-01')`, [HR]);
ok(!!r.error, 'HR (feature off) cannot start one');
ok((await as(A, `select * from month_end_entries`)).rows.length === 3, 'members see the whole month');
const [e1, e2, e3] = ents;
r = await as(A, `update month_end_entries set done=true where id=$1`, [e1.id]);
ok(r.count === 0 && !(await su(`select done from month_end_entries where id=$1`, [e1.id]))[0].done, "nobody can tick someone else's line");
r = await as(H, `update month_end_entries set done=true where id=$1`, [e1.id]);
ok(/Only Kasun/.test(r.error || ''), 'not even the manager');
r = await as(K, `update month_end_entries set done=true, remarks='All 6 accounts', title='changed' where id=$1 returning done, done_by, title, remarks`, [e1.id]);
ok(r.rows[0]?.done && r.rows[0].done_by === K && r.rows[0].title === e1.title && r.rows[0].remarks === 'All 6 accounts', 'the owner ticks and adds remarks (but cannot rename the line)');
r = await as(N, `update month_end_periods set status='reviewed' where id=$1`, [pid]);
ok(/not ticked/.test(r.error || ''), "can't review while lines are open");
await as(A, `update month_end_entries set done=true where id=$1`, [e2.id]);
await su('delete from notifications');
await as(K, `update month_end_entries set done=true where id=$1`, [e3.id]);
ok((await notices(N, 'month_end')).length === 1 && (await notices(H, 'month_end')).length === 1 && (await notices(A, 'month_end')).length === 0,
   'last tick → the senior and manager are told it is ready for review');
r = await as(K, `update month_end_periods set status='reviewed' where id=$1`, [pid]);
ok(r.count === 0 || !!r.error, 'a member cannot review');
r = await as(N, `update month_end_periods set status='approved' where id=$1`, [pid]);
ok(!!r.error, "can't skip the review");
r = await as(N, `update month_end_periods set status='reviewed' where id=$1 returning reviewed_by`, [pid]);
ok(r.rows[0]?.reviewed_by === N, 'the senior reviews');
r = await as(K, `update month_end_entries set done=false where id=$1`, [e1.id]);
ok(/signed off/.test(r.error || ''), 'reviewed months are locked');
r = await as(N, `update month_end_periods set status='approved' where id=$1`, [pid]);
ok(/Only the manager/.test(r.error || ''), 'only the manager approves');
await su('delete from notifications');
r = await as(H, `update month_end_periods set status='approved' where id=$1 returning approved_by`, [pid]);
ok(r.rows[0]?.approved_by === H, 'the manager approves');
ok((await notices(K, 'month_end')).length === 1 && (await notices(A, 'month_end')).length === 1, 'line owners hear it was approved');
r = await as(N, `update month_end_periods set status='open' where id=$1`, [pid]);
ok(!!r.error, 'a senior cannot reopen an approved month');
r = await as(H, `update month_end_periods set status='open' where id=$1 returning reviewed_by, approved_by`, [pid]);
ok(r.rows[0] && r.rows[0].reviewed_by === null && r.rows[0].approved_by === null, 'the manager can reopen it');
r = await as(H, `update month_end_periods set department_id=$2, period='2026-08-01' where id=$1 returning department_id, period`, [pid, HR]);
ok(r.rows[0]?.department_id === FIN && r.rows[0].period === '2026-09-01', "a month can't change department or date");

console.log('Month-end reminders');
const oct = (await as(N, `select public.month_end_start($1, '2026-10-01') as id`, [FIN])).rows[0].id;
await su(`update month_end_entries set due_date = public.app_today() where period_id=$1 and code='MEC-01'`, [oct]);
await su(`update month_end_entries set due_date = public.app_today() - 1 where period_id=$1 and code='MEC-02'`, [oct]);
await su('delete from notifications');
await as(K, `select public.month_end_check()`);
await as(K, `select public.month_end_check()`);
ok((await notices(K, 'month_end')).filter(n => /due today/.test(n.message)).length === 1, 'owner reminded once on the due date');
ok((await notices(A, 'month_end')).filter(n => /overdue/.test(n.message)).length === 1, 'overdue line → owner told once');
ok((await notices(N, 'month_end')).filter(n => /overdue/.test(n.message)).length === 1, '… and the senior');

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
