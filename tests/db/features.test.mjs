// Database tests for helpers, checklist, files, time blocks and Notes.
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
const notes = (u, kind) => su('select kind, message, ref_id from notifications where user_id=$1 and ($2::text is null or kind=$2) order by id', [u, kind ?? null]);
const day = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return d.toISOString().slice(0, 10); };
const sees = async (u, table, where = 'true', p = []) => (await as(u, `select * from ${table} where ${where}`, p)).rows.length;

await su(`truncate notifications, task_activity, task_comments, task_helpers, task_checklist, task_attachments, time_blocks,
          notes_task_links, notes_files, notes_shares, notes_pages, tasks, daily_notes, app_members, department_apps,
          department_features restart identity cascade`);
await su(`delete from storage.objects; delete from platform_admins; delete from profiles; delete from departments; delete from auth.users`);
await su(`insert into storage.buckets (id, name) values ('workspace-files','workspace-files') on conflict do nothing`);

const H = await signup('h@x.lk', 'Hasith'), N = await signup('n@x.lk', 'Nadeesha'), K = await signup('k@x.lk', 'Kasun'),
      A = await signup('a@x.lk', 'Amaya'), S = await signup('s@x.lk', 'Sunil'), P = await signup('p@x.lk', 'Priya'), D = await signup('d@x.lk', 'Dilan');
const depts = (await as(H, `insert into departments (name) values ('Finance'), ('HR') returning id, name`)).rows;
const FIN = depts.find(d => d.name === 'Finance').id, HR = depts.find(d => d.name === 'HR').id;
await as(H, `insert into department_apps (department_id, app_key) values ($1,'tasks'), ($2,'tasks'), ($1,'notes')`, [FIN, HR]);
await as(H, `update profiles set department_id=$1, role='manager' where id=$2`, [FIN, H]);
await as(H, `update profiles set department_id=$1, role='senior', active=true where id=$2`, [FIN, N]);
await as(H, `update profiles set department_id=$1, role='member', active=true where id = any($2)`, [FIN, [K, A, S]]);
await as(H, `update profiles set department_id=$1, role='manager', active=true where id=$2`, [HR, P]);
await as(H, `update profiles set department_id=$1, role='member', active=true where id=$2`, [HR, D]);

console.log('Helpers');
const t1 = (await as(H, `insert into tasks (title, assignee_id, due_date) values ('Bank rec', $1, $2) returning id`, [K, day(2)])).rows[0].id;
let r = await as(N, `insert into task_helpers (task_id, user_id) values ($1, $2) returning department_id, added_by`, [t1, A]);
ok(!r.error && r.rows[0].department_id === FIN && r.rows[0].added_by === N, 'senior adds a member as helper');
r = await as(K, `insert into task_helpers (task_id, user_id) values ($1, $2)`, [t1, S]);
ok(!!r.error, 'the owner (a member) cannot add helpers');
r = await as(A, `insert into task_helpers (task_id, user_id) values ($1, $2)`, [t1, S]);
ok(!!r.error, 'a helper cannot add more helpers');
r = await as(N, `insert into task_helpers (task_id, user_id) values ($1, $2)`, [t1, H]);
ok(!!r.error, 'a senior cannot add the manager as helper');
r = await as(H, `insert into task_helpers (task_id, user_id) values ($1, $2)`, [t1, K]);
ok(/already owns/.test(r.error || ''), 'the owner cannot be added as a helper');
r = await as(H, `insert into task_helpers (task_id, user_id) values ($1, $2)`, [t1, D]);
ok(!!r.error, 'nobody from another department can be a helper (not even by the admin)');
ok((await notes(A, 'helper')).length === 1, 'helper is notified when added');
ok(await sees(A, 'tasks', 'id=$1', [t1]) === 1, 'helper can see the task');
ok(await sees(S, 'tasks', 'id=$1', [t1]) === 0, 'other members still cannot');
ok(await sees(P, 'task_helpers') === 0, 'HR cannot see Finance helpers');
r = await as(A, `update tasks set status='done' where id=$1`, [t1]);
ok(r.count === 0, 'helper cannot mark the task done');
r = await as(A, `update tasks set due_date=$2 where id=$1`, [t1, day(9)]);
ok(r.count === 0, 'helper cannot move the deadline');
r = await as(A, `insert into task_comments (task_id, body) values ($1, 'On it')`, [t1]);
ok(!r.error, 'helper can comment');
await su('delete from notifications');
await as(H, `update tasks set due_date=$2 where id=$1`, [t1, day(3)]);
ok((await notes(A, 'due_moved')).length === 1, 'helper told when deadline moves');
await as(K, `insert into task_comments (task_id, body) values ($1, 'Statement received')`, [t1]);
ok((await notes(A, 'comment')).length === 1, 'helper told about comments');
r = await as(K, `delete from task_helpers where task_id=$1 and user_id=$2`, [t1, A]);
ok(r.count === 0, 'owner (member) cannot remove a helper');
const t2 = (await as(H, `insert into tasks (title, assignee_id, due_date) values ('Late one', $1, $2) returning id`, [K, day(-1)])).rows[0].id;
await as(H, `insert into task_helpers (task_id, user_id) values ($1, $2)`, [t2, A]);
await su('delete from notifications');
await su('select public.run_deadline_check()');
ok((await notes(A, 'overdue')).length === 1, 'helper told about a missed deadline');
await as(K, `update tasks set status='done' where id=$1`, [t2]);
await as(H, `update tasks set status='done' where id=$1`, [t2]);   // signed off by whoever gave it
ok((await notes(A, 'signed_off')).length === 1, 'helper told when the task is finished and signed off');
r = await as(N, `delete from task_helpers where task_id=$1 and user_id=$2`, [t1, A]);
ok(r.count === 1 && await sees(A, 'tasks', 'id=$1', [t1]) === 0, 'senior removes helper; they lose access');
await as(H, `insert into task_helpers (task_id, user_id) values ($1, $2)`, [t1, N]);
await as(H, `update tasks set assignee_id=$2 where id=$1`, [t1, N]);
ok((await su('select count(*)::int n from task_helpers where task_id=$1 and user_id=$2', [t1, N]))[0].n === 0, 'a helper who becomes owner stops being a helper');
await as(H, `update tasks set assignee_id=$2 where id=$1`, [t1, K]);
await as(N, `insert into task_helpers (task_id, user_id) values ($1, $2)`, [t1, A]);
ok((await su(`select count(*)::int n from task_activity where task_id=$1 and kind in ('helper_added','helper_removed')`, [t1]))[0].n >= 3, 'helper changes recorded in history');

console.log('Checklist');
r = await as(K, `insert into task_checklist (task_id, body, position) values ($1,'Download statement',1), ($1,'Match items',2) returning id, department_id`, [t1]);
ok(r.rows.length === 2 && r.rows[0].department_id === FIN, 'owner adds steps');
const step = r.rows[0].id;
r = await as(A, `update task_checklist set done=true where id=$1 returning done_by, done_at`, [step]);
ok(r.rows[0]?.done_by === A && !!r.rows[0]?.done_at, 'helper ticks a step (who + when recorded)');
ok((await su(`select count(*)::int n from task_activity where task_id=$1 and kind='step' and actor_id=$2`, [t1, A]))[0].n === 1, 'tick shows in history / day review');
r = await as(A, `insert into task_checklist (task_id, body) values ($1,'Helper step')`, [t1]);
ok(!r.error, 'helper can add a step');
ok(await sees(S, 'task_checklist') === 0, 'someone not on the task sees no steps');
r = await as(S, `insert into task_checklist (task_id, body) values ($1,'x')`, [t1]);
ok(!!r.error, 'someone not on the task cannot add steps');
ok(await sees(P, 'task_checklist') === 0, 'HR sees no Finance steps');

console.log('Files and links');
r = await as(K, `insert into task_attachments (task_id, kind, name, url) values ($1,'link','Bank portal','https://bank.example')`, [t1]);
ok(!r.error, 'owner adds a link');
const fpath = `tasks/${t1}/abc-statement.png`;
r = await as(A, `insert into storage.objects (bucket_id, name) values ('workspace-files', $1)`, [fpath]);
ok(!r.error, 'helper uploads a screenshot to the task folder');
r = await as(A, `insert into task_attachments (task_id, kind, name, path, size, mime) values ($1,'file','statement.png',$2,1000,'image/png') returning id`, [t1, fpath]);
ok(!r.error, 'helper records the file on the task'); const fileRow = r.rows[0]?.id;
r = await as(A, `insert into task_attachments (task_id, kind, name, path) values ($1,'file','x',$2)`, [t1, `tasks/${t2}/x.png`]);
ok(!!r.error, 'a file record must point inside its own task folder');
ok(await sees(K, 'storage.objects', 'name=$1', [fpath]) === 1, 'owner can open the file');
ok(await sees(P, 'storage.objects', 'name=$1', [fpath]) === 0, 'HR cannot open the file');
ok(await sees(S, 'storage.objects', 'name=$1', [fpath]) === 0, 'a colleague not on the task cannot open the file');
r = await as(D, `insert into storage.objects (bucket_id, name) values ('workspace-files', $1)`, [`tasks/${t1}/evil.png`]);
ok(!!r.error, 'HR cannot upload into a Finance task');
r = await as(S, `insert into storage.objects (bucket_id, name) values ('workspace-files', $1)`, [`notes/1/evil.png`]);
ok(!!r.error, 'cannot upload into a page you cannot edit');
const linkId = (await su(`select id from task_attachments where kind='link' and task_id=$1`, [t1]))[0].id;
r = await as(A, `delete from task_attachments where id=$1`, [linkId]);
ok(r.count === 0, "helper cannot delete someone else's link");
r = await as(K, `delete from task_attachments where id=$1`, [fileRow]);
ok(r.count === 1, "owner can delete a helper's file");

console.log('Time blocks');
r = await as(K, `insert into time_blocks (day, start_min, end_min, task_id) values ($1, 540, 630, $2) returning user_id, department_id`, [day(0), t1]);
ok(!r.error && r.rows[0].user_id === K && r.rows[0].department_id === FIN, 'member blocks 9:00–10:30 for a task');
r = await as(K, `insert into time_blocks (day, start_min, end_min, title) values ($1, 780, 810, 'Lunch') returning id`, [day(0)]);
ok(!r.error, 'member adds an own block (Lunch)'); const lunch = r.rows[0]?.id;
r = await as(K, `insert into time_blocks (day, start_min, end_min, title) values ($1, 1200, 1230, 'Late wrap-up')`, [day(1)]);
ok(!r.error, 'last slot 20:00–20:30 allowed, any day');
r = await as(K, `insert into time_blocks (day, start_min, end_min, title) values ($1, 400, 450, 'Too early')`, [day(0)]);
ok(!!r.error, 'before 07:00 rejected');
r = await as(K, `insert into time_blocks (day, start_min, end_min, title) values ($1, 1200, 1260, 'Too late')`, [day(0)]);
ok(!!r.error, 'after 20:30 rejected');
r = await as(K, `insert into time_blocks (day, start_min, end_min, task_id) values ($1, 600, 630, $2)`, [day(0), (await as(H, `insert into tasks (title, assignee_id, due_date) values ('Board pack', $1, $2) returning id`, [H, day(3)])).rows[0].id]);
ok(!!r.error, "cannot block time for a task you can't see");
ok(await sees(N, 'time_blocks', 'user_id=$1', [K]) === 3, "senior sees a member's day");
ok(await sees(H, 'time_blocks', 'user_id=$1', [K]) === 3, "manager sees a member's day");
ok(await sees(A, 'time_blocks', 'user_id=$1', [K]) === 0, "members can't see each other's day");
ok(await sees(P, 'time_blocks') === 0, "HR can't see Finance days");
await as(N, `insert into time_blocks (day, start_min, end_min, title) values ($1, 540, 600, 'Review')`, [day(0)]);
ok(await sees(K, 'time_blocks', 'user_id=$1', [N]) === 0, "a member can't see their senior's day");
r = await as(N, `update time_blocks set start_min=600 where id=$1`, [lunch]);
ok(r.count === 0, "a lead can view but not change someone's day");
r = await as(K, `update time_blocks set start_min=750, end_min=810 where id=$1`, [lunch]);
ok(r.count === 1, 'owner moves their block');
r = await as(K, `update time_blocks set user_id=$2 where id=$1 returning user_id`, [lunch, A]);
ok(r.rows[0]?.user_id === K, "a block can't be pushed onto someone else");

console.log('Notes');
ok((await su(`select count(*)::int n from public.notes`))[0].n === 1
   && !(await su(`select relrowsecurity r from pg_class where oid = 'public.notes'::regclass`))[0].r,
   "an older app's notes table is left untouched");
r = await as(K, `insert into notes_pages (title, content) values ('Bank recs', '{"type":"doc"}') returning id, root_id, department_id, owner_id`);
const n1 = r.rows[0]?.id;
ok(!r.error && r.rows[0].root_id === n1 && r.rows[0].department_id === FIN && r.rows[0].owner_id === K, 'member creates a private page');
r = await as(K, `insert into notes_pages (parent_id, title) values ($1, 'Commercial Bank') returning id, root_id`, [n1]);
const n1a = r.rows[0]?.id;
ok(r.rows[0]?.root_id === n1, 'sub-page belongs to its top-level page');
r = await as(K, `insert into notes_pages (parent_id, title) values ($1, 'Sept') returning root_id`, [n1a]);
ok(r.rows[0]?.root_id === n1, 'sub-sub-page too');
ok(await sees(A, 'notes_pages') === 0, 'private: colleagues see nothing');
ok(await sees(N, 'notes_pages') === 0, 'private: leads see nothing either');
ok(await sees(H, 'notes_pages') === 3, 'admin can read every page');
r = await as(H, `update notes_pages set title='x' where id=$1`, [n1]);
ok(r.count === 0, "admin cannot edit someone else's page");
await as(K, `update notes_pages set share_scope='department', dept_access='view' where id=$1`, [n1]);
ok(await sees(A, 'notes_pages') === 3, 'shared with department: page and sub-pages visible');
r = await as(A, `update notes_pages set title='hack' where id=$1`, [n1a]);
ok(r.count === 0, 'view access cannot edit');
r = await as(A, `insert into notes_pages (parent_id, title) values ($1,'x')`, [n1]);
ok(!!r.error, 'view access cannot add sub-pages');
await as(K, `update notes_pages set dept_access='edit' where id=$1`, [n1]);
r = await as(A, `update notes_pages set content='{"type":"doc","x":1}' where id=$1`, [n1a]);
ok(r.count === 1, 'edit access can edit sub-pages');
r = await as(A, `insert into notes_pages (parent_id, title) values ($1,'Amaya sub') returning id`, [n1]);
ok(!r.error, 'edit access can add sub-pages'); const nA = r.rows[0]?.id;
r = await as(A, `update notes_pages set share_scope='private' where id=$1 returning share_scope`, [n1]);
ok(r.rows[0]?.share_scope === 'department', "only the owner changes sharing");
r = await as(A, `delete from notes_pages where id=$1`, [n1]);
ok(r.count === 0, 'only the owner deletes a top-level page');
r = await as(A, `delete from notes_pages where id=$1`, [nA]);
ok(r.count === 1, 'an editor can delete a sub-page');
const before = (await su('select updated_at from notes_pages where id=$1', [n1]))[0].updated_at.toISOString();
await as(K, `update notes_pages set share_scope='people' where id=$1`, [n1]);
ok((await su('select updated_at from notes_pages where id=$1', [n1]))[0].updated_at.toISOString() === before, "changing sharing doesn't count as an edit");
r = await as(K, `update notes_pages set title='Bank recs 2' where id=$1 returning updated_at`, [n1]);
ok(new Date(r.rows[0]?.updated_at).toISOString() !== before, 'changing the words does');
await su('delete from notifications');
r = await as(K, `insert into notes_shares (note_id, user_id, access) values ($1,$2,'edit')`, [n1, N]);
ok(!r.error, 'owner shares with a chosen person');
ok(await sees(N, 'notes_pages') === 3 && await sees(A, 'notes_pages') === 0, 'only the chosen person sees it now');
ok((await notes(N, 'shared')).length === 1, 'they are notified');
r = await as(N, `insert into notes_shares (note_id, user_id, access) values ($1,$2,'view')`, [n1, A]);
ok(!!r.error, 'only the owner can share');
r = await as(K, `insert into notes_shares (note_id, user_id) values ($1,$2)`, [n1, P]);
ok(!!r.error, 'cannot share with another department');
r = await as(K, `insert into notes_shares (note_id, user_id) values ($1,$2)`, [n1a, A]);
ok(!!r.error, 'sharing is set on the top-level page only');
ok(await sees(P, 'notes_pages') === 0, 'HR sees no Finance pages');
r = await as(P, `insert into notes_pages (title) values ('HR page')`);
ok(!!r.error, "a department without the Notes app can't create pages");

console.log('Note files and links to tasks');
const npath = `notes/${n1a}/xyz-shot.png`;
r = await as(N, `insert into storage.objects (bucket_id, name) values ('workspace-files',$1)`, [npath]);
ok(!r.error, 'an editor uploads a screenshot into a page');
r = await as(N, `insert into notes_files (note_id, name, path, inline) values ($1,'shot.png',$2,true) returning department_id`, [n1a, npath]);
ok(r.rows[0]?.department_id === FIN, 'file recorded on the page');
ok(await sees(A, 'storage.objects', 'name=$1', [npath]) === 0, "someone without access can't open the page's files");
ok(await sees(H, 'storage.objects', 'name=$1', [npath]) === 1, 'admin can open them');
r = await as(K, `insert into notes_task_links (note_id, task_id) values ($1,$2)`, [n1, t1]);
ok(!r.error, 'owner links the page to a task');
ok(await sees(N, 'notes_task_links') === 1, 'someone who can open both sees the link');
ok(await sees(A, 'notes_task_links') === 0, "a helper on the task who can't open the page doesn't see the link");
const hrTask = (await as(P, `insert into tasks (title, assignee_id, due_date) values ('HR thing', $1, $2) returning id`, [D, day(2)])).rows[0].id;
r = await as(H, `insert into notes_task_links (note_id, task_id) values ($1,$2)`, [n1, hrTask]);
ok(!!r.error, 'a page cannot be linked to another department\'s task');

console.log('Cleanup on delete');
r = await as(H, `select public.admin_delete_user($1)`, [S]);
ok(!r.error, 'person with no work can still be deleted');
await as(K, `delete from notes_pages where id=$1`, [n1]);
ok((await su('select count(*)::int n from notes_pages'))[0].n === 0, 'deleting a page deletes its sub-pages');

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
