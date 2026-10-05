// Database tests for the multi-department platform: isolation, admin-only powers,
// per-person app access, department feature switches, tasks rules and alerts.
import pg from 'pg';
pg.types.setTypeParser(1082, v => v);
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
const notes = (u) => su('select kind, message, ref_id, department_id from notifications where user_id=$1 order by id', [u]);
const day = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return d.toISOString().slice(0, 10); };
const ids = async (u, t = 'tasks') => (await as(u, `select id from ${t} order by id`)).rows.map(r => Number(r.id));

await su('truncate notifications, task_activity, task_comments, tasks, daily_notes, app_members, department_apps, department_features restart identity cascade');
await su('delete from platform_admins; delete from profiles; delete from departments; delete from auth.users');

console.log('Admin & sign-up');
const H = await signup('hasith@x.lk', 'Hasith');
const N = await signup('nadeesha@x.lk', 'Nadeesha');
const K = await signup('kasun@x.lk', 'Kasun');
const A = await signup('amaya@x.lk', 'Amaya');
const P = await signup('priya@x.lk', 'Priya');
const D = await signup('dilan@x.lk', 'Dilan');
const R = await signup('ruwan@x.lk', 'Ruwan');
ok((await su('select user_id from platform_admins')).map(r => r.user_id).join() === H, 'first sign-up is the only admin');
ok((await su('select active from profiles where id=$1', [H]))[0].active, 'admin is active straight away');
ok((await notes(H)).filter(n => n.kind === 'signup').length === 6, 'admin notified of each sign-up');

let r = await as(K, `insert into platform_admins (user_id) values ($1)`, [K]);
ok(!!r.error, 'nobody can make themselves admin from the app');
r = await as(H, `insert into platform_admins (user_id) values ($1)`, [K]);
ok(!!r.error, 'even the admin cannot add admins from the app (SQL editor only)');
r = await as(K, `insert into departments (name) values ('Hack')`);
ok(!!r.error, 'non-admin cannot create departments');

console.log('Admin builds departments');
r = await as(H, `insert into departments (name) values ('Finance'), ('HR') returning id, name`);
const FIN = r.rows.find(x => x.name === 'Finance').id, HR = r.rows.find(x => x.name === 'HR').id;
await as(H, `insert into department_apps (department_id, app_key) values ($1,'tasks'), ($2,'tasks')`, [FIN, HR]);
await as(H, `update profiles set department_id=$1, role='manager' where id=$2`, [FIN, H]);
await as(H, `update profiles set department_id=$1, role='senior', active=true where id=$2`, [FIN, N]);
await as(H, `update profiles set department_id=$1, role='member', active=true where id = any($2)`, [FIN, [K, A]]);
await as(H, `update profiles set department_id=$1, role='manager', active=true where id=$2`, [HR, P]);
await as(H, `update profiles set department_id=$1, role='member', active=true where id=$2`, [HR, D]);
ok((await su(`select count(*)::int n from profiles where active and department_id is not null`))[0].n === 6, 'admin approved people into departments');

r = await as(P, `update profiles set department_id=$1, role='manager' where id=$2`, [FIN, D]);
ok((await su('select department_id from profiles where id=$1', [D]))[0].department_id === HR, 'a manager cannot move people between departments');
r = await as(K, `update profiles set role='manager', department_id=$1 where id=$2`, [HR, K]);
const kp = (await su('select role, department_id from profiles where id=$1', [K]))[0];
ok(kp.role === 'member' && kp.department_id === FIN, 'a member cannot change own role or department');
r = await as(P, `insert into department_apps (department_id, app_key) values ($1,'tasks') on conflict do nothing`, [FIN]);
ok(!!r.error, 'a manager cannot change app access');
r = await as(P, `insert into department_features (department_id, feature_key) values ($1,'daily_notes')`, [HR]);
ok(!!r.error, 'a manager cannot switch on features');

console.log('Department isolation — people & departments');
const seeProf = async (u) => (await as(u, 'select id from profiles')).rows.map(x => x.id);
const kSees = await seeProf(K), pSees = await seeProf(P);
ok(kSees.includes(N) && kSees.includes(A) && !kSees.includes(P) && !kSees.includes(D), 'Finance member sees Finance people only');
ok(pSees.includes(D) && pSees.includes(H) && !pSees.includes(K) && !pSees.includes(N), 'HR manager sees HR people (+ admin name), no Finance staff');
ok((await seeProf(R)).length === 1, 'pending user sees only themselves');
ok((await as(K, 'select name from departments')).rows.map(x => x.name).join() === 'Finance', 'member sees only own department');
ok((await as(H, 'select name from departments')).rows.length === 2, 'admin sees all departments');

console.log('Department isolation — tasks');
r = await as(H, `insert into tasks (title, assignee_id, due_date) values ('Bank rec', $1, $2) returning id, department_id`, [K, day(2)]);
const tK = r.rows[0].id;
ok(r.rows[0].department_id === FIN, 'task lands in the assignee\'s department');
r = await as(P, `insert into tasks (title, assignee_id, due_date) values ('Payroll inputs', $1, $2) returning id`, [D, day(1)]);
const tD = r.rows[0]?.id;
ok(!r.error, 'HR manager assigns within HR');
r = await as(P, `insert into tasks (title, assignee_id, due_date) values ('x', $1, $2)`, [K, day(1)]);
ok(!!r.error, 'HR manager cannot assign to a Finance person');
r = await as(N, `insert into tasks (title, assignee_id, due_date, department_id) values ('x', $1, $2, $3)`, [D, day(1), FIN]);
ok(!!r.error, 'Finance senior cannot assign to an HR person (even faking the department)');
r = await as(H, `insert into tasks (title, assignee_id, due_date) values ('Policy refresh', $1, $2) returning id, department_id`, [D, day(3)]);
const tAdminHR = r.rows[0]?.id;
ok(r.rows[0]?.department_id === HR, 'admin can assign work inside any department');
ok(!(await ids(K)).includes(Number(tD)), 'Finance member cannot see HR tasks');
const pT = await ids(P);
ok(pT.includes(Number(tD)) && pT.includes(Number(tAdminHR)) && !pT.includes(Number(tK)), 'HR manager sees HR tasks only');
ok((await ids(H)).length === 3, 'admin sees every department\'s tasks');
r = await as(P, `update tasks set title='hacked' where id=$1`, [tK]);
ok(r.count === 0, 'HR manager cannot edit Finance task');
r = await as(H, `update tasks set assignee_id=$2 where id=$1`, [tK, D]);
ok(!!r.error, 'a task cannot jump to another department (even by the admin)');
r = await as(K, `update tasks set department_id=$2 where id=$1 returning department_id`, [tK, HR]);
ok(r.rows[0]?.department_id === FIN, 'department of a task cannot be changed');

console.log('Department isolation — comments, history, notifications');
await su('delete from notifications');
r = await as(K, `update tasks set due_date=$2 where id=$1`, [tK, day(4)]);
ok((await notes(H)).filter(n => n.kind === 'due_moved').length === 1, 'Finance manager/assigner told once about deadline move');
ok((await notes(P)).length === 0, 'HR manager hears nothing about Finance');
ok((await notes(H))[0]?.department_id === FIN, 'notification is tagged with its department');
await as(P, `insert into task_comments (task_id, body) values ($1,'Please send by Fri')`, [tD]);
ok((await as(K, `select * from task_comments`)).rows.length === 0, 'Finance cannot read HR comments');
ok((await as(K, `select * from task_activity where department_id=$1`, [HR])).rows.length === 0, 'Finance cannot read HR history');
ok((await as(H, `select * from task_activity where department_id=$1`, [HR])).rows.length > 0, 'admin can read HR history');
r = await as(P, `insert into task_comments (task_id, body) values ($1,'peek')`, [tK]);
ok(!!r.error, 'HR cannot comment on Finance task');

console.log('Per-person app access');
await as(H, `update department_apps set everyone=false where department_id=$1 and app_key='tasks'`, [HR]);
await as(H, `insert into app_members (department_id, app_key, user_id) values ($1,'tasks',$2)`, [HR, P]);
ok((await ids(D)).length === 0, 'person without the app loses access to its data');
r = await as(P, `insert into tasks (title, assignee_id, due_date) values ('x', $1, $2)`, [D, day(1)]);
ok(!!r.error, 'cannot assign work to someone without the app');
ok((await ids(P)).length === 2, 'person on the access list keeps access');
await as(H, `insert into app_members (department_id, app_key, user_id) values ($1,'tasks',$2)`, [HR, D]);
ok((await ids(D)).length === 2, 'adding them back restores access');
await as(H, `update department_apps set everyone=true where department_id=$1 and app_key='tasks'`, [HR]);
r = await as(D, `select * from app_members`);
ok(r.rows.every(x => x.department_id === HR), 'people only see access lists of their own department');

console.log('Department-only feature (daily notes)');
r = await as(K, `insert into daily_notes (day, body) values ($1,'Did the bank rec')`, [day(0)]);
ok(!!r.error, 'feature OFF → cannot write');
await as(H, `insert into department_features (department_id, feature_key) values ($1,'daily_notes')`, [FIN]);
r = await as(K, `insert into daily_notes (day, body) values ($1,'Did the bank rec') returning department_id`, [day(0)]);
ok(r.rows[0]?.department_id === FIN, 'feature ON for Finance → Finance member can write');
r = await as(K, `insert into daily_notes (day, body) values ($1,'future')`, [day(1)]);
ok(!!r.error, 'cannot write notes for future days');
r = await as(A, `insert into daily_notes (day, body) values ($1,'Invoices posted')`, [day(0)]);
ok((await as(N, `select user_id from daily_notes`)).rows.length === 2, 'Finance senior reads members\' notes');
ok((await as(A, `select user_id from daily_notes`)).rows.length === 1, 'member reads only own note');
r = await as(D, `insert into daily_notes (day, body) values ($1,'x')`, [day(0)]);
ok(!!r.error, 'HR (feature off) cannot write notes');
ok((await as(P, `select * from daily_notes`)).rows.length === 0, 'HR cannot read Finance notes');
await as(H, `insert into department_features (department_id, feature_key) values ($1,'daily_notes')`, [HR]);
ok((await as(P, `select * from daily_notes`)).rows.length === 0, 'even with the feature ON, HR cannot read Finance notes');
r = await as(D, `insert into daily_notes (day, body) values ($1,'Payroll inputs collected') returning department_id`, [day(0)]);
ok(r.rows[0]?.department_id === HR, 'HR notes land in HR');
ok((await as(K, `select * from daily_notes where department_id=$1`, [HR])).rows.length === 0, 'Finance cannot read HR notes');
r = await as(K, `update daily_notes set department_id=$1 where user_id=$2 returning department_id`, [HR, K]);
ok(r.rows[0]?.department_id === FIN, 'a note cannot be moved to another department');
await as(H, `delete from department_features where department_id=$1 and feature_key='daily_notes'`, [FIN]);
ok((await as(N, `select * from daily_notes`)).rows.length === 0, 'switching the feature off hides its data again');
await as(H, `insert into department_features (department_id, feature_key) values ($1,'daily_notes')`, [FIN]);

console.log('Moving a person between departments');
await as(H, `insert into tasks (title, assignee_id, due_date) values ('Amaya job', $1, $2)`, [A, day(2)]);
ok((await ids(A)).length === 1, 'Amaya sees her Finance task');
await as(H, `update profiles set department_id=$1 where id=$2`, [HR, A]);
ok((await ids(A)).length === 0, 'after moving to HR she can no longer see Finance tasks');
ok(!(await seeProf(A)).includes(K), 'and no longer sees Finance people');
await as(H, `update profiles set department_id=$1 where id=$2`, [FIN, A]);

console.log('Daily check is per department');
await su('delete from notifications');
const late = (await as(P, `insert into tasks (title, assignee_id, due_date) values ('HR late', $1, $2) returning id`, [D, day(-1)])).rows[0].id;
await as(H, `insert into tasks (title, assignee_id, due_date) values ('FIN late', $1, $2)`, [K, day(-1)]);
await su('delete from notifications');
await as(K, 'select public.run_deadline_check()');
const pn = await notes(P), hn = await notes(H);
ok(pn.some(n => n.kind === 'overdue' && n.ref_id == late) && !pn.some(n => /FIN late/.test(n.message)), 'HR manager gets HR missed deadlines only');
ok(hn.some(n => /FIN late/.test(n.message)) && !hn.some(n => /HR late/.test(n.message)), 'Finance manager gets Finance missed deadlines only');
const cnt = (await su('select count(*)::int n from notifications'))[0].n;
await su('select public.run_deadline_check()');
ok((await su('select count(*)::int n from notifications'))[0].n === cnt, 'no double alerts');

console.log('Turning an app off for a department');
await as(H, `delete from department_apps where department_id=$1 and app_key='tasks'`, [HR]);
ok((await ids(P)).length === 0, 'HR loses Tasks data when the app is switched off');
ok((await ids(H)).filter(Boolean).length > 0, 'admin still sees data (for reference)');
await as(H, `insert into department_apps (department_id, app_key) values ($1,'tasks')`, [HR]);

console.log('Misc');
r = await as(P, `delete from tasks where id=$1`, [late]);
ok(r.count === 1 && (await su(`select count(*)::int n from notifications where app_key='tasks' and ref_id=$1`, [late]))[0].n === 0, 'deleting a task clears its notifications');
ok(!!(await as(null, 'select * from tasks')).error && !!(await as(null, 'select * from profiles')).error, 'anonymous visitors blocked');
r = await as(K, `select public.notify(array[$1::uuid], null, null, null, 'x', 'spam', null)`, [H]);
ok(!!r.error, 'internal notify() not callable');


console.log('Removing people (decline / delete)');
const exists = async (id) => (await su('select (select count(*) from auth.users where id=$1)::int a, (select count(*) from profiles where id=$1)::int p', [id]))[0];
r = await as(P, `select public.admin_delete_user($1)`, [R]);
ok(!!r.error && (await exists(R)).a === 1, 'a manager cannot delete people');
r = await as(K, `select public.admin_delete_user($1)`, [R]);
ok(!!r.error, 'a member cannot delete people');
r = await as(H, `select public.admin_delete_user($1)`, [H]);
ok(/own account/.test(r.error || ''), 'admin cannot delete their own account');
const H2 = await signup('second.admin@x.lk', 'Second Admin');
await su('insert into platform_admins (user_id) values ($1)', [H2]);
r = await as(H, `select public.admin_delete_user($1)`, [H2]);
ok(/SQL Editor/.test(r.error || '') && (await exists(H2)).a === 1, 'another admin cannot be deleted from the app');
await su('delete from platform_admins where user_id=$1', [H2]); await su('delete from auth.users where id=$1', [H2]);
r = await as(H, `select public.admin_delete_user($1)`, [R]);
let e = await exists(R);
ok(!r.error && e.a === 0 && e.p === 0, 'admin declines a pending sign-up: login and profile removed');
r = await as(H, `select public.admin_delete_user($1)`, [K]);
e = await exists(K);
ok(/still has tasks assigned/.test(r.error || '') && e.a === 1 && e.p === 1, 'cannot delete someone who still has tasks assigned');
// someone who created work, commented and wrote notes, but has nothing assigned any more
const Z = await signup('zara@x.lk', 'Zara');
await as(H, `update profiles set department_id=$1, role='member', active=true where id=$2`, [FIN, Z]);
const tz = (await as(Z, `insert into tasks (title, assignee_id, due_date) values ('Zara draft', $1, $2) returning id`, [Z, day(3)])).rows[0].id;
await as(Z, `insert into task_comments (task_id, body) values ($1, 'Started this')`, [tz]);
await as(Z, `insert into daily_notes (day, body) values ($1, 'note')`, [day(0)]);
await as(H, `update tasks set assignee_id=$2 where id=$1`, [tz, K]);
r = await as(H, `select public.admin_delete_user($1)`, [Z]);
e = await exists(Z);
ok(!r.error && e.a === 0 && e.p === 0, 'admin deletes someone with no tasks assigned ' + (r.error || ''));
const t = (await su('select created_by, assignee_id from tasks where id=$1', [tz]))[0];
ok(t.created_by === null && t.assignee_id === K, 'their task stays, creator shown as blank');
ok((await su('select author_id from task_comments where task_id=$1', [tz]))[0]?.author_id === null, 'their comment stays, author shown as blank');
ok((await su('select count(*)::int n from task_activity where actor_id=$1', [Z]))[0].n === 0 && (await su('select count(*)::int n from task_activity where task_id=$1', [tz]))[0].n >= 3, 'history kept, their name removed');
ok((await su('select count(*)::int n from daily_notes where user_id=$1', [Z]))[0].n === 0, 'their personal notes are removed');
ok((await as(K, 'select id from tasks where id=$1', [tz])).rows.length === 1, 'the reassigned task still works for its new owner');

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
