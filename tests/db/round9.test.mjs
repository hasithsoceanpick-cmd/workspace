// Database tests for round 9: people outside the app (no login) that tasks are given to, for follow-up.
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
const one = async (sql, p = []) => (await su(sql, p))[0];

await su(`truncate notifications, task_activity, task_comments, task_helpers, task_checklist, task_attachments, time_blocks,
          notes_task_links, notes_files, notes_shares, notes_pages, tasks, daily_notes, app_members, department_apps,
          department_features, task_reminders, task_follows, task_minis, task_work_log, task_contacts restart identity cascade`);
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
await as(H, `update profiles set department_id=$1, role='member', active=true where id=$2`, [ST, O]);
const addContact = (by, name, extra = {}) => {
  const cols = ['name', ...Object.keys(extra)];
  return as(by, `insert into task_contacts (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, [name, ...Object.values(extra)]);
};

// =====================================================================
console.log('People outside the app');
let r = await addContact(H, '  Sampath Perera ', { organisation: 'DFCC Bank', phone: '077 123 4567', email: 'sampath@dfcc.lk' });
const sam = r.rows[0];
ok(sam && sam.department_id === FIN && sam.name === 'Sampath Perera' && sam.created_by === H && sam.active, 'the manager adds someone without a login to Finance\'s list');
r = await addContact(K, 'Ruwan (Lanka Tiles)', { department_id: HR });
const ruw = r.rows[0];
ok(ruw && ruw.department_id === FIN, "a member adds one too — always to his own department, whatever he sends");
r = await addContact(H, 'HR auditor', { department_id: HR });
ok(r.rows[0]?.department_id === HR, 'the admin can add one to another department');
const hrc = r.rows[0];
ok((await addContact(K, '   ')).error, 'a name is needed');
ok((await addContact(O, 'No app')).error, "someone without the Tasks app can't add any");
ok((await as(null, 'select id from task_contacts')).error, 'signed-out visitors are refused');

ok((await as(K, 'select id from task_contacts order by id')).rows.length === 2, 'everyone in Finance sees Finance\'s list');
ok((await as(P, 'select id from task_contacts')).rows.every(x => x.id === hrc.id), "HR sees only HR's");
ok((await as(H, 'select id from task_contacts')).rows.length === 3, 'the admin sees all');

ok((await as(A, `update task_contacts set phone='x' where id=$1`, [sam.id])).count === 0, "a member can't change someone else added");
ok((await as(K, `update task_contacts set phone='071 000 0000' where id=$1`, [ruw.id])).count === 1, 'whoever added them can');
ok((await as(N, `update task_contacts set note='Call after 10' where id=$1 returning note`, [sam.id])).rows[0]?.note === 'Call after 10', 'senior executives can');
r = await as(H, `update task_contacts set department_id=$2, created_by=$3 where id=$1 returning department_id, created_by`, [sam.id, HR, K]);
ok(r.rows[0].department_id === FIN && r.rows[0].created_by === H, "department and who added them can't be changed");
ok((await as(P, `update task_contacts set name='x' where id=$1`, [sam.id])).count === 0, "another department can't change them");

// =====================================================================
console.log('Giving tasks to them');
r = await as(H, `insert into tasks (title, assignee_id, due_date, contact_id) values ('DFCC new bank accounts on iConnect', $1, $2, $3) returning *`, [H, addDays(today, 3), sam.id]);
const t1 = r.rows[0];
ok(t1 && t1.contact_id === sam.id && t1.assignee_id === H, 'a task given to Sampath, which Hasith follows up');
r = await as(H, `insert into tasks (title, assignee_id, due_date, contact_id) values ('Chase statement', $1, $2, $3) returning *`, [K, addDays(today, 2), sam.id]);
const t2 = r.rows[0];
ok(t2 && t2.assignee_id === K && t2.contact_id === sam.id, 'or one Kasun follows up');
ok((await as(H, `insert into tasks (title, assignee_id, due_date, contact_id) values ('x', $1, $2, $3)`, [H, today, hrc.id])).error?.includes("isn't on this department's list"),
  "someone on HR's list can't be used on a Finance task");
ok((await as(K, `update tasks set contact_id=$2 where id=$1`, [t2.id, hrc.id])).error?.includes("isn't on this department's list"), 'not by changing it later either');
r = await as(K, `update tasks set contact_id=$2 where id=$1 returning contact_id`, [t2.id, ruw.id]);
ok(r.rows[0]?.contact_id === ruw.id, 'the owner can change who it\'s with');
ok((await one(`select new_value from task_activity where task_id=$1 and kind='edited' order by id desc limit 1`, [t2.id])).new_value.includes('outside person'),
  'and the change is in the history');
const rp = (await as(H, `insert into tasks (title, assignee_id, due_date, contact_id, repeat) values ('Monthly DFCC statement', $1, $2, $3, 'monthly') returning *`, [H, today, sam.id])).rows[0];
await as(H, `update tasks set status='done' where id=$1`, [rp.id]);
ok((await one(`select contact_id from tasks where series_id=$1 and id<>$1`, [rp.id]))?.contact_id === sam.id, 'a repeating task keeps the same person');

// =====================================================================
console.log('Removing them');
ok((await as(N, `delete from task_contacts where id=$1`, [sam.id])).count === 0, "a senior executive can't remove someone for good");
r = await as(H, `delete from task_contacts where id=$1`, [sam.id]);
ok(r.error, 'nobody can remove someone for good while tasks mention them');
r = await as(H, `update task_contacts set active=false where id=$1 returning active`, [sam.id]);
ok(r.rows[0]?.active === false && (await one('select contact_id from tasks where id=$1', [t1.id])).contact_id === sam.id,
  'they are taken off the list instead, and their tasks keep the name');
const spare = (await addContact(K, 'Wrong entry')).rows[0];
ok((await as(K, `delete from task_contacts where id=$1`, [spare.id])).count === 0, "a member can't delete");
ok((await as(H, `delete from task_contacts where id=$1`, [spare.id])).count === 1, 'the manager deletes one no task mentions');
r = await addContact(K, 'Back again');
ok(r.rows[0]?.active === true, 'new entries always start on the list');

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
