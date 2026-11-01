// Database tests for round 13: work given without a deadline — the owner picks the date when they press Got it,
// optionally no later than a "latest date" set by whoever gave it.
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
const fmt = async d => (await su('select public.fmt_date($1::date) as f', [d]))[0].f;
const one = async (sql, p = []) => (await su(sql, p))[0];

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
const give = (by, title, to, extra = {}) => {
  const cols = ['title', 'assignee_id', ...Object.keys(extra)];
  return as(by, `insert into tasks (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, [title, to, ...Object.values(extra)]);
};
const upd = (by, id, set, p = []) => as(by, `update tasks set ${set} where id = $1 returning *`, [id, ...p]);

// =====================================================================
console.log('Giving work without a deadline');
const latest = addDays(today, 10);
let r = await give(H, 'Prepare the October VAT workings', K, { latest_by: latest });
const t1 = r.rows[0];
ok(t1 && t1.due_date === null && t1.latest_by === latest && t1.acknowledged_at === null, 'Hasith gives Kasun a task with no deadline (latest date in 10 days)');
ok((await notices(K, 'assigned'))[0]?.message === `Hasith assigned you "Prepare the October VAT workings" — pick your own date (by ${await fmt(latest)})`,
  'Kasun is told to pick his own date, and by when');
r = await give(H, 'Open-ended', A);
const t2 = r.rows[0];
ok(t2 && t2.due_date === null && t2.latest_by === null && (await notices(A, 'assigned'))[0]?.message.endsWith('— pick your own date'), 'or with no limit at all');
ok((await give(H, 'My own thing', H)).error?.includes('Pick a deadline'), "not for your own work (you'd just pick the date)");
ok((await give(H, 'Big job', K, { nature: 'project' })).error?.includes('Pick a deadline'), 'not for a project');
ok((await give(H, 'Monthly', K, { repeat: 'monthly' })).error?.includes('Pick a deadline'), 'not for a repeating task');
ok((await give(H, 'Late limit', K, { latest_by: addDays(today, -1) })).error?.includes('past'), "the latest date can't be in the past");
r = await give(H, 'Fixed', K, { due_date: addDays(today, 3), latest_by: latest });
ok(r.rows[0]?.latest_by === null, 'a task with a deadline has no latest date');
ok(!(await give(N, 'Scan the GRNs', A)).error, 'a senior executive can give one to a member');
ok((await give(K, 'For Amaya', A)).error, 'members still only make tasks for themselves');
ok((await as(P, 'select id from tasks where id = $1', [t1.id])).rows.length === 0, "HR can't see it");

console.log('Got it needs a date');
ok((await upd(K, t1.id, `acknowledged_at = now()`)).error?.includes('Pick a date'), "Kasun can't press Got it without picking a date");
ok((await upd(K, t1.id, `status = 'doing'`)).error?.includes('Pick a date'), 'nor start it');
ok((await upd(K, t1.id, `due_date = $2, acknowledged_at = now()`, [addDays(latest, 1)])).error?.includes('on or before'), 'nor pick a date after the latest date');
ok((await upd(K, t1.id, `due_date = $2, acknowledged_at = now()`, [addDays(today, -1)])).error?.includes('today or a later'), 'nor a date in the past');
ok((await upd(K, t1.id, `latest_by = $2`, [addDays(latest, 20)])).error, "he can't move the latest date himself");
const picked = addDays(today, 6);
r = await upd(K, t1.id, `due_date = $2, acknowledged_at = now()`, [picked]);
ok(r.rows[0]?.due_date === picked && r.rows[0].acknowledged_at && r.rows[0].original_due === picked && r.rows[0].due_moves === 0,
  'he picks a date and presses Got it: that is the deadline (its first one, not a move)');
ok((await notices(H, 'date_set'))[0]?.message === `Kasun set the deadline for "Prepare the October VAT workings": ${await fmt(picked)}`,
  'Hasith is told the date Kasun picked');
ok((await notices(H, 'due_moved')).length === 0 && (await notices(N, 'date_set')).length === 0, "no 'deadline moved' alerts, and nobody else is told");
ok((await su(`select kind from task_activity where task_id = $1 order by id`, [t1.id])).map(x => x.kind).join() === 'created,acknowledged,date_set'
   || (await su(`select kind from task_activity where task_id = $1 order by id`, [t1.id])).map(x => x.kind).join() === 'created,date_set,acknowledged',
  'history shows it was given, accepted and the date set');

console.log('After the date is set');
ok((await upd(K, t1.id, `due_date = $2`, [addDays(latest, 2)])).error?.includes('on or before'), 'moving it later stays within the latest date for Kasun');
r = await upd(K, t1.id, `due_date = $2`, [addDays(today, 8)]);
ok(r.rows[0]?.due_moves === 1 && (await notices(H, 'due_moved')).length === 1, 'a later move is an ordinary deadline move (counted, Hasith told)');
ok(!(await upd(H, t1.id, `due_date = $2`, [addDays(latest, 5)])).error, 'Hasith himself can set any date');
ok((await upd(K, t1.id, `due_date = null`)).error, "the deadline can't be taken off an accepted task");

console.log('Before it is accepted');
r = await upd(H, t2.id, `latest_by = $2`, [addDays(today, 4)]);
ok(r.rows[0]?.latest_by === addDays(today, 4) && (await notices(A, 'edited')).at(-1)?.message.includes('latest date'), 'Hasith can set a latest date later (Amaya is told)');
r = await upd(H, t2.id, `assignee_id = $2`, [K]);
ok(r.rows[0]?.assignee_id === K && r.rows[0].due_date === null && (await notices(K, 'assigned')).at(-1)?.message.includes('pick your own date'),
  'given to someone else instead, it still waits for their date');
ok((await upd(H, t2.id, `assignee_id = $2`, [H])).error?.includes('Pick a deadline'), "taken back by Hasith himself, it needs a date");
r = await upd(H, t2.id, `due_date = $2`, [addDays(today, 2)]);
ok(r.rows[0]?.due_date === addDays(today, 2) && r.rows[0].acknowledged_at === null && (await notices(K, 'date_set')).at(-1)?.message.startsWith('Hasith set the deadline'),
  'Hasith can set the date himself after all (Kasun is told; it still waits for his Got it)');
r = await upd(H, t2.id, `due_date = null`);
ok(r.rows[0]?.due_date === null && (await notices(K, 'due_moved')).at(-1)?.message.includes('left the date of "Open-ended" to you'),
  'and leave it to Kasun again, while he has not accepted it');
const t3 = (await give(H, 'Fixed for Kasun', K, { due_date: addDays(today, 3) })).rows[0];
ok((await upd(K, t3.id, `due_date = null`)).error, "Kasun can't take the deadline off work given with one");

console.log('Everything else ignores it until dated');
await su(`do $$ begin perform public.run_deadline_check(); end $$`);
ok((await su(`select count(*)::int n from notifications n join tasks t on t.id = n.ref_id where t.due_date is null and n.kind in ('overdue','due_today','escalated')`))[0].n === 0,
  'the morning check never calls an undated task late or due');
ok(!(await as(H, 'select * from public.tasks_trends($1, 6)', [FIN])).error, 'trends still work');
r = await as(H, `select * from public.tasks_search('workings', $1)`, [FIN]);
ok(r.rows.length === 1, 'search finds it');
r = await as(H, `insert into task_helpers (task_id, user_id) values ($1, $2) returning *`, [t2.id, A]);
ok((await notices(A, 'helper')).at(-1)?.message.endsWith('— no date yet'), 'a helper is told it has no date yet');

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
