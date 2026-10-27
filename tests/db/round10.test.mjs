// Database tests for round 10: projects (dated stages with their own people, the status flag, missed stages)
// and mini tasks given to someone in your team.
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
const one = async (sql, p = []) => (await su(sql, p))[0];

await su(`truncate notifications, task_activity, task_comments, task_helpers, task_checklist, task_attachments, time_blocks,
          notes_task_links, notes_files, notes_shares, notes_pages, tasks, daily_notes, app_members, department_apps,
          department_features, task_reminders, task_follows, task_minis, task_work_log, task_contacts restart identity cascade`);
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
const stage = (by, task, body, due, who = null) =>
  as(by, `insert into task_checklist (task_id, body, due_date, assignee_id, position) values ($1, $2, $3, $4, 1) returning *`, [task, body, due, who]);

// =====================================================================
console.log('Projects');
let r = await as(H, `insert into tasks (title, assignee_id, due_date, nature, repeat) values ('DFCC account restructure', $1, $2, 'project', 'weekly') returning *`, [K, addDays(today, 30)]);
const pj = r.rows[0];
ok(pj && pj.nature === 'project' && pj.repeat === null && pj.health === null, 'a project is a task of nature "project" (projects never repeat)');
ok((await as(H, `insert into tasks (title, assignee_id, due_date, nature) values ('x', $1, $2, 'epic')`, [K, today])).error, 'only task or project');

r = await stage(H, pj.id, 'Collect board resolutions', addDays(today, 5), A);
const s1 = r.rows[0];
ok(s1 && s1.due_date === addDays(today, 5) && s1.assignee_id === A, 'Hasith adds a dated stage for Amaya');
ok((await notices(A, 'stage'))[0]?.message === `Hasith gave you a stage in "DFCC account restructure": Collect board resolutions — due ${(await one(`select public.fmt_date($1::date) as f`, [addDays(today, 5)])).f}`,
  'Amaya gets one alert');
ok((await su('select 1 from task_helpers where task_id=$1 and user_id=$2', [pj.id, A])).length === 1
   && (await notices(A, 'helper')).length === 0, 'she can open the project (added as a helper, without a second alert)');
ok((await as(A, 'select id from tasks where id=$1', [pj.id])).rows.length === 1, 'and she does see it');
const s2 = (await stage(H, pj.id, 'Bank sign-off', addDays(today, 10), N)).rows[0];
const s3 = (await stage(K, pj.id, 'Update iConnect', addDays(today, 12))).rows[0];
ok(s3 && s3.assignee_id === null, 'the owner adds a stage for himself');
ok((await stage(K, pj.id, 'For Amaya', addDays(today, 3), A)).error?.includes("can't give work"), "a member owner can't give a stage to a colleague");

ok((await as(A, `update task_checklist set done=true where id=$1 returning done`, [s1.id])).rows[0]?.done === true, 'Amaya ticks her own stage');
ok((await as(A, `update task_checklist set done=true where id=$1`, [s2.id])).error?.includes('you can tick your own'), "but not someone else's");
ok((await as(A, `update task_checklist set body='renamed' where id=$1`, [s1.id])).error, "she can't rename hers");
ok((await as(A, `update task_checklist set due_date=$2 where id=$1`, [s1.id, addDays(today, 40)])).error, "or move its date");
ok((await stage(A, pj.id, 'Extra', today)).error, "or add stages");
ok((await as(A, `delete from task_checklist where id=$1`, [s2.id])).error, 'or delete one');
ok((await as(K, `update task_checklist set due_date=$2 where id=$1 returning due_date`, [s2.id, addDays(today, 11)])).rows[0]?.due_date === addDays(today, 11), 'the owner can move a date');
ok((await as(P, `insert into task_checklist (task_id, body) values ($1, 'hr')`, [pj.id])).error, "another department can't touch it");

const plain = (await as(H, `insert into tasks (title, assignee_id, due_date) values ('Plain task', $1, $2) returning *`, [K, today])).rows[0];
r = await stage(H, plain.id, 'A step', addDays(today, 3), A);
ok(r.rows[0]?.due_date === null && r.rows[0]?.assignee_id === null, "an ordinary task's steps have no date or person");

console.log('Status flag');
r = await as(K, `update tasks set health='at_risk', health_note='Bank wants new board resolution' where id=$1 returning health, health_at is not null as at, health_by`, [pj.id]);
ok(r.rows[0]?.health === 'at_risk' && r.rows[0].at && r.rows[0].health_by === K, 'the owner sets At risk with a note');
const hn = await notices(H, 'health');
ok(hn.length === 1 && hn[0].message === 'Kasun marked "DFCC account restructure" At risk: Bank wants new board resolution', 'whoever gave it (and the managers) get an alert');
ok((await notices(K, 'health')).length === 0, 'not the owner who set it');
ok((await as(N, `update tasks set health='on_track' where id=$1`, [pj.id])).error?.includes('Only the owner'), "a senior executive who didn't give it can't");
ok((await as(A, `update tasks set health='on_track' where id=$1`, [pj.id])).count === 0, "a stage person can't");
await as(K, `update tasks set health_note='Board meets Thursday' where id=$1`, [pj.id]);
ok((await notices(H, 'health')).length === 1, 'a new note on the same flag: no new alert');
await as(K, `update tasks set health='off_track', health_note='Missed the bank date' where id=$1`, [pj.id]);
ok((await notices(H, 'health')).length === 2, 'Off track: another alert');
await as(H, `update tasks set health='on_track', health_note='' where id=$1`, [pj.id]);
ok((await notices(K, 'health')).length === 0 && (await notices(H, 'health')).length === 2, 'back On track: no alert');
const hist = await su(`select old_value, new_value from task_activity where task_id=$1 and kind='health' order by id`, [pj.id]);
ok(hist.length === 4 && hist[0].new_value === 'at_risk|Bank wants new board resolution' && hist[3].old_value === 'off_track', 'every change is in the history (with its note)');
ok((await as(H, `update tasks set health='great' where id=$1`, [pj.id])).error, 'only the three flags');

console.log('Missed stages');
await su(`update task_checklist set due_date = public.app_today() - 1 where id = any($1)`, [[s2.id, s3.id]]);
await su('delete from notifications');
await su('select public.run_deadline_check()'); await su('select public.run_deadline_check()');
const nm = await notices(N, 'stage_overdue'), km = await notices(K, 'stage_overdue');
ok(nm.length === 1 && nm[0].message.startsWith('Missed stage: "Bank sign-off" in "DFCC account restructure"'), 'the stage person hears about a missed stage, once');
ok(km.length === 2 && km.some(n => n.message.startsWith('Missed stage: Nadeesha — "Bank sign-off"')), "the project owner hears about every missed stage (his own and Nadeesha's)");
ok((await notices(A, 'stage_overdue')).length === 0, 'not for a stage already ticked');
await su(`update task_checklist set due_date = public.app_today() - 1 where id = $1`, [s1.id]);
await su(`update tasks set status='done', completed_at=now() where id=$1`, [pj.id]);
await su(`update task_checklist set due_date = public.app_today() - 2, overdue_notified_on = null where id = $1`, [s3.id]);
await su('delete from notifications'); await su('select public.run_deadline_check()');
ok((await notices(K, 'stage_overdue')).length === 0, 'nothing once the project is finished');

// =====================================================================
console.log('Mini tasks given to someone');
r = await as(H, `insert into task_minis (body, user_id) values ('Call Sampath re limits', $1) returning *`, [K]);
const g1 = r.rows[0];
ok(g1 && g1.user_id === K && g1.created_by === H && g1.department_id === FIN, 'the manager gives Kasun a mini task');
ok((await notices(K, 'mini'))[0]?.message === 'Hasith gave you a mini task: Call Sampath re limits', 'Kasun gets one alert');
ok((await as(K, 'select id from task_minis where id=$1', [g1.id])).rows.length === 1, 'it is on his list');
ok((await as(H, 'select id from task_minis where id=$1', [g1.id])).rows.length === 1, 'Hasith sees the ones he gave');
ok((await as(A, 'select id from task_minis where id=$1', [g1.id])).rows.length === 0, "a colleague doesn't");
r = await as(N, `insert into task_minis (body, user_id, day) values ('Scan GRNs', $1, $2) returning created_by`, [K, addDays(today, 1)]);
ok(r.rows[0]?.created_by === N && (await notices(K, 'mini')).some(n => n.message.includes('for ')), 'a senior executive gives one to a member, for tomorrow');
ok((await as(N, `insert into task_minis (body, user_id) values ('x', $1)`, [H])).error?.includes('only give mini tasks'), "but not to the manager");
ok((await as(P, `insert into task_minis (body, user_id) values ('x', $1)`, [K])).error, "HR can't give Finance people mini tasks");
ok((await as(H, `update task_minis set body='Call Sampath re limits (DFCC)' where id=$1`, [g1.id])).count === 1, 'the giver can change the words until it is ticked');
r = await as(H, `update task_minis set done_at=now() where id=$1 returning done_at`, [g1.id]);
ok(r.rows[0]?.done_at === null, "but can't tick it — only Kasun can");
await as(K, `update task_minis set done_at=now() where id=$1`, [g1.id]);
ok((await as(H, 'select done_at is not null as d from task_minis where id=$1', [g1.id])).rows[0]?.d === true, 'Hasith sees when Kasun ticks it');
ok((await as(H, `update task_minis set body='late change' where id=$1`, [g1.id])).count === 0, 'once ticked the giver can no longer change it');
ok((await as(H, `delete from task_minis where id=$1`, [g1.id])).count === 0, 'or delete it');
const g2 = (await as(H, `insert into task_minis (body, user_id) values ('Wrong one', $1) returning id`, [K])).rows[0];
ok((await as(H, `delete from task_minis where id=$1`, [g2.id])).count === 1, 'an unticked one can be taken back');
ok((await as(K, `insert into task_minis (body) values ('Mine')  returning created_by`)).rows[0]?.created_by === K, 'your own still work as before');

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
