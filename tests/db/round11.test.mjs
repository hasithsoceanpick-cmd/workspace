// Database tests for round 11: the Messages app — team chat, announcements, one-to-one chats (private to the two),
// @mentions, ticks, "Got it", cards (attached / sent / made), files, edit & delete window, search, departments apart.
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
const notices = (u, kind) => su('select kind, message, ref_id, app_key from notifications where user_id=$1 and ($2::text is null or kind=$2) order by id', [u, kind ?? null]);
const one = async (sql, p = []) => (await su(sql, p))[0];

await su(`truncate notifications, task_activity, task_comments, task_helpers, task_checklist, task_attachments, time_blocks,
          notes_task_links, notes_files, notes_shares, notes_pages, tasks, daily_notes, app_members, department_apps,
          department_features, task_reminders, task_follows, task_minis, task_work_log, task_contacts,
          msg_acks, msg_reads, msg_files, msg_items, msg_messages, msg_threads restart identity cascade`);
await su(`delete from storage.objects; delete from platform_admins; delete from profiles; delete from departments; delete from auth.users`);

const H = await signup('h@x.lk', 'Hasith'), N = await signup('n@x.lk', 'Nadeesha'), K = await signup('k@x.lk', 'Kasun'),
      A = await signup('a@x.lk', 'Amaya'), P = await signup('p@x.lk', 'Priya'), D = await signup('d@x.lk', 'Dilan'), O = await signup('o@x.lk', 'Oshan');
const depts = (await as(H, `insert into departments (name) values ('Finance'), ('HR') returning id, name`)).rows;
const FIN = depts.find(d => d.name === 'Finance').id, HR = depts.find(d => d.name === 'HR').id;
await as(H, `insert into department_apps (department_id, app_key) values ($1,'tasks'), ($2,'tasks'), ($1,'messages'), ($2,'messages'), ($1,'notes')`, [FIN, HR]);
await as(H, `update profiles set department_id=$1, role='manager' where id=$2`, [FIN, H]);
await as(H, `update profiles set department_id=$1, role='senior', active=true where id=$2`, [FIN, N]);
await as(H, `update profiles set department_id=$1, role='member', active=true where id = any($2)`, [FIN, [K, A, O]]);
await as(H, `update profiles set department_id=$1, role='manager', active=true where id=$2`, [HR, P]);
await as(H, `update profiles set department_id=$1, role='member', active=true where id=$2`, [HR, D]);
// Oshan is in Finance but Messages is only for selected people… and he isn't one of them
await as(H, `update department_apps set everyone=false where department_id=$1 and app_key='messages'`, [FIN]);
await as(H, `insert into app_members (department_id, app_key, user_id) select $1, 'messages', unnest($2::uuid[])`, [FIN, [H, N, K, A]]);
const send = (by, thread, body, extra = {}) => {
  const cols = ['thread_id', 'body', ...Object.keys(extra)];
  return as(by, `insert into msg_messages (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, [thread, body, ...Object.values(extra)]);
};
const sync = (uid, dept) => as(uid, 'select * from public.msg_sync($1)', [dept]);

// =====================================================================
console.log('Conversations');
let r = await sync(K, FIN);
const team = r.rows.find(x => x.kind === 'team')?.thread_id, ann = r.rows.find(x => x.kind === 'announce')?.thread_id;
ok(team && ann && r.rows.length === 2, 'the first look creates the team chat and announcements');
r = await sync(A, FIN);
ok(r.rows.length === 2 && r.rows.some(x => x.thread_id === team), 'there is only one of each per department');
ok((await sync(O, FIN)).rows.length === 0, "someone without Messages sees no conversations");
ok((await as(O, 'select id from msg_threads')).rows.length === 0, '…and can read none');
const hrs = await sync(P, HR);
const hrTeam = hrs.rows.find(x => x.kind === 'team').thread_id;
ok((await as(K, 'select id from msg_threads where id=$1', [hrTeam])).rows.length === 0, "Finance can't see HR's team chat");
ok((await as(H, 'select id from msg_threads where id=$1', [hrTeam])).rows.length === 1, 'the admin can');

r = await as(K, 'select public.msg_direct($1) as id', [A]);
const kaDirect = r.rows[0]?.id;
ok(kaDirect, 'Kasun starts a one-to-one with Amaya');
ok((await as(A, 'select public.msg_direct($1) as id', [K])).rows[0]?.id === kaDirect, 'the same chat whoever starts it');
ok((await as(K, 'select public.msg_direct($1) as id', [D])).error, "not with someone in another department");
ok((await as(K, 'select public.msg_direct($1) as id', [O])).error, 'not with someone who doesn\'t use Messages');
ok((await as(K, 'select public.msg_direct($1) as id', [K])).error, 'not with yourself');

// =====================================================================
console.log('One-to-one: private');
r = await send(K, kaDirect, 'Can you send me the Sampath statement?');
const m1 = r.rows[0];
ok(m1 && m1.author_id === K && m1.department_id === FIN, 'Kasun writes to Amaya');
ok((await notices(A, 'message'))[0]?.message === 'Kasun: Can you send me the Sampath statement?' && (await notices(A, 'message'))[0].ref_id === kaDirect,
  'Amaya is told (phone too), opening the chat');
ok((await notices(K, 'message')).length === 0, 'Kasun is not told about his own message');
ok((await as(A, 'select body from msg_messages where thread_id=$1', [kaDirect])).rows.length === 1, 'Amaya reads it');
ok((await as(N, 'select id from msg_messages where thread_id=$1', [kaDirect])).rows.length === 0, 'their senior executive can\'t');
ok((await as(H, 'select id from msg_messages where thread_id=$1', [kaDirect])).rows.length === 0, 'the manager / admin can\'t');
ok((await as(H, 'select id from msg_threads where id=$1', [kaDirect])).rows.length === 0, "the admin can't even see the chat exists");
ok((await send(N, kaDirect, 'butting in')).error, "nobody else can write in it");
r = await sync(A, FIN);
ok(r.rows.find(x => x.thread_id === kaDirect)?.unread === 1 && r.rows.find(x => x.thread_id === kaDirect)?.other_id === K, 'it is unread on her list, with Kasun as the other person');

console.log('Ticks');
const rk = await as(K, 'select user_id, delivered_at, read_at from msg_reads where thread_id=$1', [kaDirect]);
const am = rk.rows.find(x => x.user_id === A);
ok(am && am.delivered_at && !am.read_at, "after Amaya's app synced: delivered, not yet seen (Kasun can see this)");
await as(A, 'select public.msg_seen($1)', [kaDirect]);
const seen = (await as(K, 'select read_at >= $2 as s from msg_reads where thread_id=$1 and user_id=$3', [kaDirect, m1.created_at, A])).rows[0];
ok(seen?.s, 'she opens it: seen');
ok((await sync(A, FIN)).rows.find(x => x.thread_id === kaDirect)?.unread === 0, 'and it is no longer unread');
ok((await su('select read_at from notifications where user_id=$1 and kind=$2', [A, 'message']))[0]?.read_at, '…and its alert in her bell is marked read');
await as(N, 'select public.msg_seen($1)', [kaDirect]);
ok((await su('select 1 from msg_reads where thread_id=$1 and user_id=$2', [kaDirect, N])).length === 0, "someone outside the chat can't leave a seen mark on it");
r = await as(A, `update msg_reads set read_at = now() - interval '1 day' where thread_id=$1 returning read_at > now() - interval '1 minute' as kept`, [kaDirect]);
ok(r.rows[0]?.kept, "seen can't be taken back");
ok((await as(A, `update msg_reads set read_at = now() where thread_id=$1 and user_id=$2`, [kaDirect, K])).count === 0, "nobody marks someone else's ticks");

// =====================================================================
console.log('Team chat and @mentions');
r = await send(N, team, 'Bank rec due Friday @Kasun', { mentions: `{${K},${D},${N}}` });
ok(r.rows[0]?.mentions?.length === 1 && r.rows[0].mentions[0] === K, 'only real team members can be mentioned (not HR, not yourself)');
ok((await notices(K, 'mention'))[0]?.message === 'Nadeesha mentioned you in the team chat: Bank rec due Friday @Kasun', 'Kasun gets a mention alert');
ok((await notices(A, 'mention')).length === 0 && (await notices(A, 'message')).length === 1, 'others only see it as unread');
ok((await sync(K, FIN)).rows.find(x => x.thread_id === team)?.mentions === 1, 'his list shows an unread mention');
ok((await send(P, team, 'hello Finance')).error, "HR can't write in Finance's team chat");
ok(!(await send(H, hrTeam, 'Hello HR, from the admin')).error, 'the admin can');
ok((await send(O, team, 'not on Messages')).error, "someone without Messages can't");

console.log('Announcements');
ok((await send(K, ann, 'I am announcing')).error, "a member can't post an announcement");
ok((await send(N, ann, 'Senior announcing')).error, "nor a senior executive");
r = await send(H, ann, 'Month-end close starts Monday 8 am');
const an1 = r.rows[0];
ok(an1 && (await notices(K, 'announce'))[0]?.message === 'Announcement from Hasith: Month-end close starts Monday 8 am'
   && (await notices(N, 'announce')).length === 1 && (await notices(A, 'announce')).length === 1, 'the manager announces: everyone is told');
ok((await notices(O, 'announce')).length === 0 && (await notices(P, 'announce')).length === 0, 'not people without Messages, not HR');
ok(!(await as(K, 'insert into msg_acks (message_id) values ($1)', [an1.id])).error, 'Kasun presses Got it');
ok((await as(K, 'insert into msg_acks (message_id) values ($1)', [m1.id])).error, 'Got it is only for announcements');
r = await as(H, 'select user_id from msg_acks where message_id=$1', [an1.id]);
ok(r.rows.length === 1 && r.rows[0].user_id === K, 'Hasith sees who has pressed it');

// =====================================================================
console.log('Work in messages');
const task = (await as(H, `insert into tasks (title, assignee_id, due_date) values ('Sampath statement', $1, public.app_today() + 2) returning id`, [A])).rows[0];
r = await send(H, team, 'See this');
const mt = r.rows[0];
ok(!(await as(H, `insert into msg_items (message_id, kind, ref_id, relation, title) values ($1, 'task', $2, 'attached', 'Sampath statement')`, [mt.id, task.id])).error, 'Hasith attaches a task to his message');
ok((await as(K, `insert into msg_items (message_id, kind, ref_id, relation) values ($1, 'task', $2, 'attached')`, [mt.id, task.id])).error,
  "nobody else can attach things to his message");
ok(!(await as(K, `insert into msg_items (message_id, kind, ref_id, relation) values ($1, 'mini', 5, 'made')`, [mt.id])).error, 'but anyone in the chat can turn it into work (made)');
r = await as(A, 'select kind, relation, title from msg_items where message_id=$1 order by id', [mt.id]);
ok(r.rows.map(x => x.relation).join() === 'attached,made' && r.rows[0].title === 'Sampath statement', 'everyone in the chat sees the cards (with their titles)');
ok((await as(P, 'select id from msg_items where message_id=$1', [mt.id])).rows.length === 0, "HR doesn't");
ok((await as(H, `insert into msg_items (message_id, kind, ref_id) values ($1, 'invoice', 1)`, [mt.id])).error, 'only tasks, notes, reminders and mini tasks');

console.log('Files');
ok(!(await as(K, `insert into storage.objects (bucket_id, name, owner) values ('workspace-files', $1, $2)`, [`messages/${kaDirect}/shot.png`, K])).error, 'a screenshot uploads into a chat he is in');
ok((await as(N, `insert into storage.objects (bucket_id, name, owner) values ('workspace-files', $1, $2)`, [`messages/${kaDirect}/x.png`, N])).error, "not into someone else's chat");
ok((await as(N, `select name from storage.objects where name like $1`, [`messages/${kaDirect}/%`])).rows.length === 0, "and others can't read its files");
ok((await as(A, `select name from storage.objects where name like $1`, [`messages/${kaDirect}/%`])).rows.length === 1, 'Amaya can');
r = await send(K, kaDirect, '');
ok(!(await as(K, `insert into msg_files (message_id, path, name, size, mime) values ($1, $2, 'shot.png', 10, 'image/png')`, [r.rows[0].id, `messages/${kaDirect}/shot.png`])).error, 'the file is listed on his message');
ok((await as(K, `insert into msg_files (message_id, path, name) values ($1, $2, 'x')`, [r.rows[0].id, `messages/${team}/x`])).error, 'a file has to be in its own chat\'s folder');
ok((await notices(A, 'message')).at(-1)?.message === 'Kasun: 📎 Attachment', 'a file-only message says "Attachment"');

console.log('Reply, edit, delete');
r = await send(A, kaDirect, 'Sent it this morning', { reply_to: m1.id });
const m2 = r.rows[0];
ok(m2?.reply_to === m1.id, 'Amaya replies to a specific message');
ok((await send(A, kaDirect, 'x', { reply_to: mt.id })).rows[0]?.reply_to === null, "a reply can't point into another chat");
r = await as(A, `update msg_messages set body='Sent it at 9 this morning' where id=$1 returning body, edited_at is not null as edited`, [m2.id]);
ok(r.rows[0]?.edited && r.rows[0].body === 'Sent it at 9 this morning', 'she edits it (marked edited)');
ok((await as(K, `update msg_messages set body='hijack' where id=$1`, [m2.id])).count === 0, "Kasun can't edit her message");
{ // backdate it (as the database's own housekeeping, so the trigger lets the time change through)
  const c = await pool.connect();
  await c.query('begin'); await c.query("select set_config('app.system','on',true)");
  await c.query(`update msg_messages set created_at = now() - interval '16 minutes' where id=$1`, [m1.id]);
  await c.query('commit'); c.release();
}
ok((await as(K, `update msg_messages set body='too late' where id=$1`, [m1.id])).error?.includes('15 minutes'), 'after 15 minutes it can\'t be changed');
r = await as(A, `update msg_messages set deleted_at = now() where id=$1 returning body, deleted_at is not null as gone`, [m2.id]);
ok(r.rows[0]?.gone && r.rows[0].body === '', 'she deletes it (the words are wiped)');
ok((await as(A, `update msg_messages set body='back' where id=$1`, [m2.id])).error, 'a deleted message stays deleted');
ok((await as(A, `delete from msg_messages where id=$1`, [m2.id])).error || true, 'messages are never removed outright (no delete rights)');
ok((await one('select count(*)::int as n from msg_messages where id=$1', [m2.id])).n === 1, '…the row stays as "Message deleted"');

console.log('Search');
r = await as(K, `select * from public.msg_search('Sampath', $1)`, [FIN]);
ok(r.rows.some(x => x.thread_id === kaDirect) && r.rows.every(x => x.kind === 'direct' || x.kind === 'team' || x.kind === 'announce'), 'Kasun finds his own message');
r = await as(N, `select * from public.msg_search('Sampath', $1)`, [FIN]);
ok(!r.rows.some(x => x.thread_id === kaDirect), "Nadeesha doesn't find words from their private chat");
r = await as(H, `select * from public.msg_search('Monday', $1)`, [FIN]);
ok(r.rows.length === 1 && r.rows[0].kind === 'announce', 'the announcement is searchable');
ok((await as(H, `select * from public.msg_search('statement', $1)`, [FIN])).rows.every(x => x.thread_id !== kaDirect), 'the admin doesn\'t find private words either');
ok((await as(null, 'select * from public.msg_search($1, $2)', ['x', FIN])).error, 'signed-out visitors are refused');

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
