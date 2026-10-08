// Database tests for round 5: checker sign-off, "Got it" (acknowledge), early reminders, repeating series,
// the Compliance calendar feature, search, performance trends and phone alerts (web push).
// Run against a THROWAWAY local database only (see tests/README.md).
import pg from 'pg';
pg.types.setTypeParser(1082, v => v);
pg.types.setTypeParser(20, v => Number(v));
pg.types.setTypeParser(1700, v => Number(v));
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
const task = async id => (await su('select * from tasks where id=$1', [id]))[0];
// the database's own housekeeping may change pinned columns (used here to pretend time has passed)
const housekeeping = (sql, p = []) => su(`do $$ begin perform set_config('app.system','on',true); ${sql}; perform set_config('app.system','off',true); end $$`, p);
const backdate = (id, days) => housekeeping(`update tasks set created_at = now() - interval '${days} days' where id = ${Number(id)}`);

await su(`truncate notifications, task_activity, task_comments, task_helpers, task_checklist, task_attachments, time_blocks,
          notes_task_links, notes_files, notes_shares, notes_pages, tasks, daily_notes, app_members, department_apps,
          department_features, month_end_entries, month_end_periods, month_end_items, compliance_items,
          workspace_push_subscriptions, workspace_push_config, workspace_push_log restart identity cascade`);
await su(`delete from platform_admins; delete from profiles; delete from departments; delete from auth.users;
          truncate net.mock_requests, net._http_response`);

const H = await signup('h@x.lk', 'Hasith'), N = await signup('n@x.lk', 'Nadeesha'), K = await signup('k@x.lk', 'Kasun'),
      A = await signup('a@x.lk', 'Amaya'), P = await signup('p@x.lk', 'Priya'), D = await signup('d@x.lk', 'Dilan'),
      S = await signup('s@x.lk', 'Sunil');
const depts = (await as(H, `insert into departments (name) values ('Finance'), ('HR') returning id, name`)).rows;
const FIN = depts.find(d => d.name === 'Finance').id, HR = depts.find(d => d.name === 'HR').id;
await as(H, `insert into department_apps (department_id, app_key) values ($1,'tasks'), ($2,'tasks'), ($1,'notes'), ($2,'notes')`, [FIN, HR]);
await as(H, `update profiles set department_id=$1, role='manager' where id=$2`, [FIN, H]);
await as(H, `update profiles set department_id=$1, role='senior', active=true where id=$2`, [FIN, N]);
await as(H, `update profiles set department_id=$1, role='member', active=true where id = any($2)`, [FIN, [K, A]]);
await as(H, `update profiles set department_id=$1, role='senior', active=true where id=$2`, [FIN, S]);
await as(H, `update profiles set department_id=$1, role='manager', active=true where id=$2`, [HR, P]);
await as(H, `update profiles set department_id=$1, role='member', active=true where id=$2`, [HR, D]);
const newTask = async (by, title, to, due = addDays(today, 5), extra = '') =>
  (await as(by, `insert into tasks (title, assignee_id, due_date${extra ? ', ' + extra.split('=')[0] : ''}) values ($1, $2, $3${extra ? ', ' + extra.split('=')[1] : ''}) returning *`, [title, to, due])).rows[0];

// =====================================================================
console.log('Checker sign-off');
let t = await newTask(H, 'VAT return', K);
ok(t.needs_check === true && t.status === 'todo', 'work given to someone else needs sign-off by default');
await su('delete from notifications');
let r = await as(K, `update tasks set status='done' where id=$1 returning status, completed_at, submitted_at`, [t.id]);
ok(r.rows[0].status === 'review' && r.rows[0].completed_at === null && r.rows[0].submitted_at !== null,
   'when the owner finishes it, it waits for sign-off (not done yet)');
let n = await notices(H, 'review');
ok(n.length === 1 && n[0].ref_id === t.id && /Kasun finished "VAT return"/.test(n[0].message), 'whoever gave it is asked to sign it off');
r = await as(K, `update tasks set status='done' where id=$1`, [t.id]);
ok(/waiting for Hasith/.test(r.error || '') && (await task(t.id)).status === 'review', 'the owner cannot sign off their own work');
r = await as(A, `update tasks set status='done' where id=$1`, [t.id]);
ok(r.count === 0 && (await task(t.id)).status === 'review', "a colleague can't sign it off");
r = await as(N, `update tasks set status='done' where id=$1`, [t.id]);
ok(/waiting for Hasith/.test(r.error || '') && (await task(t.id)).status === 'review', "a senior who didn't give it can't sign it off");
await su('delete from notifications');
r = await as(H, `update tasks set status='done' where id=$1 returning status, checked_by, checked_at, completed_at`, [t.id]);
ok(r.rows[0].status === 'done' && r.rows[0].checked_by === H && r.rows[0].checked_at && r.rows[0].completed_at, 'whoever gave it signs it off');
ok((await notices(K, 'signed_off')).length === 1, 'the owner hears it was signed off');

const t2 = await newTask(H, 'Bank recs', K);
await as(K, `update tasks set status='done' where id=$1`, [t2.id]);
r = await as(H, `select public.tasks_send_back($1, '  ')`, [t2.id]);
ok(/what needs fixing/.test(r.error || ''), 'sending back needs a reason');
r = await as(K, `select public.tasks_send_back($1, 'please redo')`, [t2.id]);
ok(/Only the person who gave/.test(r.error || ''), 'the owner cannot "send back" their own task');
await su('delete from notifications');
r = await as(H, `select public.tasks_send_back($1, 'Commercial Bank balance does not match')`, [t2.id]);
let row = await task(t2.id);
ok(!r.error && row.status === 'doing' && row.sent_back_n === 1 && row.submitted_at === null, 'sent back: it is back in progress, counted once');
n = await notices(K, 'sent_back');
ok(n.length === 1 && /Hasith sent back "Bank recs": Commercial Bank balance does not match/.test(n[0].message), 'the owner is told what needs fixing');
const sb = await su(`select new_value from task_activity where task_id=$1 and kind='sent_back'`, [t2.id]);
ok(sb.length === 1 && sb[0].new_value === 'Commercial Bank balance does not match', 'the reason is kept in the task history');
r = await as(H, `select public.tasks_send_back($1, 'again')`, [t2.id]);
ok(/isn't waiting for sign-off/.test(r.error || ''), "can't send back a task that isn't waiting for sign-off");
await as(K, `update tasks set status='done' where id=$1`, [t2.id]);
r = await as(K, `update tasks set status='doing' where id=$1 returning status, sent_back_n`, [t2.id]);
ok(r.rows[0]?.status === 'doing' && r.rows[0].sent_back_n === 1, 'the owner may take it back to fix something (not counted as sent back)');

const own = await newTask(K, 'My own reminder', K);
r = await as(K, `update tasks set status='done' where id=$1 returning status, checked_by`, [own.id]);
ok(r.rows[0].status === 'done' && r.rows[0].checked_by === null, 'your own task needs no sign-off');
const byN = await newTask(N, 'Petty cash', A);
r = await as(H, `update tasks set status='done' where id=$1 returning status, checked_by`, [byN.id]);
ok(r.rows[0].status === 'done' && r.rows[0].checked_by === H, 'a manager can finish and sign off a task in one go');
const quick = await newTask(H, 'Print cheques', K);
r = await as(K, `update tasks set needs_check=false where id=$1`, [quick.id]);
ok(/Only the person who gave this task/.test(r.error || ''), "the owner can't switch sign-off off");
await as(H, `update tasks set needs_check=false where id=$1`, [quick.id]);
r = await as(K, `update tasks set status='done' where id=$1 returning status`, [quick.id]);
ok(r.rows[0].status === 'done', 'when the giver says no sign-off is needed, done is done');
r = await as(H, `insert into tasks (title, assignee_id, due_date, status) values ('Odd', $1, $2, 'review') returning status`, [K, today]);
ok(r.rows[0].status === 'done', "a task can't be created already waiting for sign-off");

const late = await newTask(H, 'Late but submitted', K, addDays(today, -2));
await as(K, `update tasks set status='done' where id=$1`, [late.id]);
const lateOpen = await newTask(H, 'Late and open', K, addDays(today, -2));
await su('delete from notifications');
await su('select public.run_deadline_check()');
n = await su(`select ref_id from notifications where kind='overdue'`);
ok(n.some(x => x.ref_id === lateOpen.id) && !n.some(x => x.ref_id === late.id), 'waiting for sign-off is not a missed deadline');

const gone = await newTask(N, 'Given by someone who left', K);
await as(H, `update profiles set active=false where id=$1`, [N]);
await su('delete from notifications');
await as(K, `update tasks set status='done' where id=$1`, [gone.id]);
ok((await notices(H, 'review')).length === 1, "if whoever gave it has left, the manager is asked to sign off");
await as(H, `update profiles set active=true where id=$1`, [N]);

const adminHr = await newTask(H, 'Exit interviews', D);
await su('delete from notifications');
await as(D, `update tasks set status='done' where id=$1`, [adminHr.id]);
ok((await notices(H, 'review')).length === 1 && (await notices(P, 'review')).length === 0, 'work the admin gives in another department comes back to the admin');
r = await as(H, `update tasks set status='done' where id=$1 returning status`, [adminHr.id]);
ok(r.rows[0]?.status === 'done', 'and the admin signs it off there');

// =====================================================================
console.log('Got it (acknowledge)');
const g = await newTask(H, 'Payroll journal', K);
ok(g.acknowledged_at === null, 'work given to someone starts as "not opened yet"');
ok(own.acknowledged_at !== null, 'your own task counts as seen');
r = await as(H, `update tasks set acknowledged_at=now() where id=$1 returning acknowledged_at`, [g.id]);
ok(r.rows[0].acknowledged_at === null, "nobody else can press Got it for them");
r = await as(K, `update tasks set acknowledged_at=now() where id=$1 returning acknowledged_at`, [g.id]);
ok(r.rows[0].acknowledged_at !== null, 'the owner presses Got it');
ok((await su(`select count(*)::int n from task_activity where task_id=$1 and kind='acknowledged'`, [g.id]))[0].n === 1, 'it shows in the history');
r = await as(K, `update tasks set acknowledged_at=null where id=$1 returning acknowledged_at`, [g.id]);
ok(r.rows[0].acknowledged_at !== null, "it can't be un-seen");
const g2 = await newTask(H, 'Fixed asset register', K);
await as(K, `update tasks set status='doing' where id=$1`, [g2.id]);
ok((await task(g2.id)).acknowledged_at !== null, 'starting the task also counts as seeing it');
await as(H, `update tasks set assignee_id=$2 where id=$1`, [g2.id, A]);
ok((await task(g2.id)).acknowledged_at === null, 'handed to someone else: unseen again for the new owner');

const u1 = await newTask(H, 'Supplier statement', K);
const u2 = await newTask(H, 'Debtors ageing', K);
await backdate(u1.id, 1); await backdate(u2.id, 1);
const u3 = await newTask(H, 'Given today', K);
await su('delete from notifications');
await su('select public.run_deadline_check()');
n = await notices(K, 'unseen');
ok(n.length === 1 && /2 new tasks you haven't opened yet/.test(n[0].message) && !/Given today/.test(n[0].message),
   'next morning the owner gets one reminder for everything still unopened');
n = await notices(H, 'unseen');
ok(n.length === 2 && n.every(x => /Kasun hasn't opened/.test(x.message)), 'whoever gave them hears once per task');
await su('select public.run_deadline_check()');
ok((await notices(K, 'unseen')).length === 1 && (await notices(H, 'unseen')).length === 2, 'running again the same day sends nothing more');
await housekeeping(`update tasks set ack_reminded_on = current_date - 1 where id in (${u1.id}, ${u2.id})`);
await su('select public.run_deadline_check()');
ok((await notices(K, 'unseen')).length === 2 && (await notices(H, 'unseen')).length === 2, 'the owner is reminded again the next day; the giver is not');
await as(K, `update tasks set acknowledged_at=now() where id = any($1)`, [[u1.id, u2.id, u3.id]]);

// =====================================================================
console.log('Early reminders ("remind me N days before")');
const e1 = await newTask(H, 'EPF contribution', K, addDays(today, 3), 'remind_days=5');
await backdate(e1.id, 1);
const e2 = await newTask(H, 'Made today', K, addDays(today, 3), 'remind_days=5');
const e3 = await newTask(H, 'Far away', K, addDays(today, 20), 'remind_days=5');
await backdate(e3.id, 1);
await su('delete from notifications');
await su('select public.run_deadline_check()');
n = await notices(K, 'due_soon');
ok(n.length === 1 && n[0].ref_id === e1.id && /due in 3 days/.test(n[0].message), 'reminded N days before (not for one made today, not too early)');
await su('select public.run_deadline_check()');
ok((await notices(K, 'due_soon')).length === 1, 'only once per deadline');
await as(K, `update tasks set due_date=$2 where id=$1`, [e1.id, addDays(today, 2)]);
await su('select public.run_deadline_check()');
ok((await notices(K, 'due_soon')).length === 2, 'a moved deadline gets its own reminder');
r = await as(K, `update tasks set remind_sent_for=null where id=$1 returning remind_sent_for`, [e1.id]);
ok(r.rows[0].remind_sent_for !== null, "the reminder record can't be changed from the browser");
void e2;

// =====================================================================
console.log('Repeating series');
const s1 = await newTask(H, 'WHT return', K, '2026-01-15', 'repeat=\'monthly\'');
ok(s1.series_id === s1.id, 'a repeating task starts its own series');
await as(K, `update tasks set status='done' where id=$1`, [s1.id]);
await as(H, `update tasks set status='done' where id=$1`, [s1.id]);
const s2 = await task((await task(s1.id)).next_task_id);
ok(s2.series_id === s1.id && s2.acknowledged_at !== null && s2.needs_check === true, 'the next one stays in the series, needs no Got it, still needs sign-off');
r = await as(H, `update tasks set series_id=null where id=$1 returning series_id`, [s2.id]);
ok(r.rows[0].series_id === s1.id, "the series can't be changed from the browser");
const plain = await newTask(H, 'One-off', K);
await as(H, `update tasks set repeat='yearly' where id=$1`, [plain.id]);
ok((await task(plain.id)).series_id === plain.id, 'switching repeat on later starts a series too');

// =====================================================================
console.log('Compliance calendar (feature)');
r = await as(H, `select public.compliance_add($1, 'VAT return', 'IRD', '', $2, $3, 'monthly', 5)`, [FIN, K, '2026-11-20']);
ok(!r.error, 'the admin can add one even before the feature is on');   // admin, like month-end
r = await as(N, `select public.compliance_add($1, 'APIT', 'IRD', '', $2, $3, 'monthly', 5)`, [FIN, K, '2026-11-15']);
ok(/Only managers and senior/.test(r.error || ''), 'feature off: a senior cannot add obligations');
ok((await as(N, `select * from compliance_items`)).rows.length === 0, 'feature off: nothing to see');
await as(H, `insert into department_features (department_id, feature_key) values ($1, 'compliance')`, [FIN]);
r = await as(N, `select public.compliance_add($1, 'APIT', 'IRD', 'Pay by the 15th', $2, $3, 'monthly', 5) as id`, [FIN, A, '2026-11-15']);
const ci = (await su(`select * from compliance_items where id=$1`, [r.rows[0]?.id]))[0];
const ct = ci && await task(ci.series_id);
ok(ci && ct && ct.repeat === 'monthly' && ct.remind_days === 5 && ct.assignee_id === A && ct.priority === 'high' && ct.series_id === ct.id,
   'a senior adds an obligation: a high-priority repeating task with an early reminder');
ok(ci.department_id === FIN && ct.created_by === N && ct.acknowledged_at === null, 'it belongs to Finance and the owner is asked to open it');
r = await as(N, `select public.compliance_add($1, 'Stamp duty', '', '', $2, $3, null, null)`, [FIN, A, '2026-11-15']);
ok(/how often/.test(r.error || ''), 'an obligation must repeat');
r = await as(N, `select public.compliance_add($1, 'Bad owner', '', '', $2, $3, 'monthly', null)`, [FIN, D, '2026-11-15']);
ok(!!r.error && (await su(`select count(*)::int n from tasks where title='Bad owner'`))[0].n === 0, "the owner must be in the department (nothing is left behind)");
ok((await as(K, `select * from compliance_items`)).rows.length === 2, 'members see the calendar');
r = await as(K, `update compliance_items set name='x' where id=$1`, [ci.id]);
ok(r.count === 0, "members can't change it");
r = await as(K, `delete from compliance_items where id=$1`, [ci.id]);
ok(r.count === 0, "members can't remove it");
r = await as(K, `insert into compliance_items (name) values ('sneaky')`);
ok(!!r.error, "members can't add to it");
ok((await as(P, `select * from compliance_items`)).rows.length === 0 && (await as(D, `select * from compliance_items`)).rows.length === 0,
   "HR can't see Finance's obligations");
r = await as(P, `select public.compliance_add($1, 'Spy', '', '', $2, $3, 'monthly', null)`, [FIN, K, '2026-11-15']);
ok(!!r.error, "HR's manager can't add to Finance");
const hrTask = await newTask(P, 'HR thing', D, addDays(today, 5), 'repeat=\'monthly\'');
r = await as(H, `update compliance_items set series_id=$2 where id=$1`, [ci.id, hrTask.id]);
ok(/another department/.test(r.error || ''), "an obligation can't point at another department's task");
r = await as(N, `insert into compliance_items (name, authority, series_id) values ('WHT return', 'IRD', $1) returning department_id`, [s1.id]);
ok(r.rows[0]?.department_id === FIN, 'an existing repeating task can be put on the calendar');
r = await as(N, `update compliance_items set active=false where id=$1 returning active`, [ci.id]);
ok(r.rows[0]?.active === false, 'a lead can pause an obligation');

// =====================================================================
console.log('Search');
const q = await newTask(H, 'Reconcile Sampath account', K);
await as(K, `insert into task_comments (task_id, body) values ($1, 'Waiting for the HNB statement')`, [q.id]);
await as(K, `insert into task_checklist (task_id, body) values ($1, 'Match cheque 50%_off')`, [q.id]);
const hrSecret = await newTask(P, 'HR payroll Sampath', D);
let hits = (await as(K, `select * from public.tasks_search('sampath', $1)`, [FIN])).rows;
ok(hits.length === 1 && hits[0].id === q.id && hits[0].found_in === 'title', 'finds tasks by title (any case)');
hits = (await as(K, `select * from public.tasks_search('HNB', $1)`, [FIN])).rows;
ok(hits.length === 1 && hits[0].found_in === 'comment' && /HNB statement/.test(hits[0].snippet), 'finds words in comments');
hits = (await as(K, `select * from public.tasks_search('50%_', $1)`, [FIN])).rows;
ok(hits.length === 1 && hits[0].found_in === 'step', 'finds checklist steps; % and _ are taken literally');
ok((await as(K, `select * from public.tasks_search('%', $1)`, [FIN])).rows.length === 0, 'a lone % matches nothing');
ok((await as(A, `select * from public.tasks_search('sampath', $1)`, [FIN])).rows.length === 0, "a colleague can't find someone else's task");
ok((await as(D, `select * from public.tasks_search('sampath', $1)`, [FIN])).rows.length === 0, "HR can't search Finance");
ok((await as(K, `select * from public.tasks_search('payroll', $1)`, [HR])).rows.length === 0, "and Finance can't search HR");
ok((await as(H, `select * from public.tasks_search('sampath', $1)`, [HR])).rows.some(x => x.id === hrSecret.id), 'the admin can search any department');
ok((await as(K, `select * from public.tasks_search('s', $1)`, [FIN])).rows.length === 0, 'needs at least 2 letters');

const doc = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Audit adjustments for Q3: depreciation rerun' }] }] });
const np = (await as(K, `insert into notes_pages (title, content) values ('Audit notes', $1::jsonb) returning id`, [doc])).rows[0].id;
hits = (await as(K, `select * from public.notes_search('depreciation', $1)`, [FIN])).rows;
ok(hits.length === 1 && hits[0].id === np && hits[0].found_in === 'text' && /depreciation rerun/.test(hits[0].snippet), 'finds words inside a note');
ok((await as(K, `select * from public.notes_search('audit', $1)`, [FIN])).rows[0]?.found_in === 'title', 'and note titles');
ok((await as(A, `select * from public.notes_search('depreciation', $1)`, [FIN])).rows.length === 0, "a private note can't be found by others");
await as(K, `update notes_pages set share_scope='department' where id=$1`, [np]);
ok((await as(A, `select * from public.notes_search('depreciation', $1)`, [FIN])).rows.length === 1, 'once shared, colleagues can find it');
ok((await as(D, `select * from public.notes_search('depreciation', $1)`, [FIN])).rows.length === 0, "HR still can't");

// =====================================================================
console.log('Performance trends');
await su(`truncate tasks restart identity cascade`);
const mk = async (title, who, due, finishedDaysLate) => {
  const x = await newTask(H, title, who, due);
  if (finishedDaysLate !== null) {
    await housekeeping(`update tasks set status='done', submitted_at = ('${due}'::date + ${finishedDaysLate})::timestamp at time zone public.app_tz() + interval '10 hours', completed_at = now() where id = ${x.id}`);
  }
  return x;
};
const m0 = `${today.slice(0, 7)}-01`;
const lastMonth = (() => { const d = new Date(m0 + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
await mk('on time 1', K, lastMonth, 0);
await mk('on time 2', K, addDays(lastMonth, 3), -1);
await mk('late', K, addDays(lastMonth, 5), 2);
await mk('never done', K, addDays(lastMonth, 6), null);
await mk('Amaya on time', A, addDays(lastMonth, 1), 0);
const mv = await mk('moved', K, addDays(lastMonth, 8), 0);
await su(`insert into task_activity (task_id, department_id, actor_id, kind, old_value, new_value, created_at) values ($1, $2, $3, 'due_date', 'x', 'y', $4::date + interval '12 hours')`, [mv.id, FIN, K, addDays(lastMonth, 2)]);
const tr = (await as(H, `select * from public.tasks_trends($1, 3)`, [FIN])).rows;
const kLast = tr.find(x => x.user_id === K && String(x.month).startsWith(lastMonth.slice(0, 7)));
ok(tr.length === 3 * 2 && kLast, 'one row per month per person');
ok(kLast.due === 5 && kLast.on_time === 3 && kLast.late === 1 && kLast.open_late === 1, `on time / late / still open are counted by deadline (${JSON.stringify(kLast)})`);
ok(kLast.moved === 1, 'deadline moves are counted');
const kNow = tr.find(x => x.user_id === K && String(x.month).startsWith(m0.slice(0, 7)));
ok(kNow.assigned === 5 && kNow.ack_hours === null, 'tasks given to them are counted in the month they were given');
const nView = (await as(N, `select distinct user_id from public.tasks_trends($1, 3)`, [FIN])).rows.map(x => x.user_id);
ok(nView.length === 2 && nView.includes(K) && nView.includes(A), "a senior sees the members' trends");
ok((await as(K, `select distinct user_id from public.tasks_trends($1, 3)`, [FIN])).rows.every(x => x.user_id === K), 'a member sees only their own');
ok((await as(P, `select * from public.tasks_trends($1, 3)`, [FIN])).rows.length === 0, "HR sees nothing of Finance");

// =====================================================================
console.log('Phone alerts');
const dev = (who, tag) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${who}-${tag}`, p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) });
const save = (uid, d, label = 'Android phone') => as(uid, `select public.workspace_push_save($1, $2, $3, $4)`, [d.endpoint, d.p256dh, d.auth, label]);
ok((await as(K, `select public.workspace_push_public_key() as k`)).rows[0].k === null, 'not set up yet: no key to hand out');
r = await as(K, `select public.workspace_push_setup('https://x.supabase.co/functions/v1/workspace-push', $1, $2, 'https://w.app', 'pk')`, ['P'.repeat(87), 'd'.repeat(43)]);
ok(/Only the administrator/.test(r.error || ''), 'only the admin can set it up');
r = await as(H, `select public.workspace_push_setup('https://evil.example.com/x', $1, $2, 'https://w.app', 'pk')`, ['P'.repeat(87), 'd'.repeat(43)]);
ok(/doesn't look like/.test(r.error || ''), 'the address must be the workspace-push function');
r = await as(H, `select public.workspace_push_setup('https://x.supabase.co/functions/v1/workspace-push', $1, $2, 'https://w.app', 'sb_publishable_x')`, ['P'.repeat(87), 'd'.repeat(43)]);
ok(!r.error, 'the admin sets it up');
ok((await as(K, `select public.workspace_push_public_key() as k`)).rows[0].k === 'P'.repeat(87), 'everyone can get the public key');
r = await as(H, `select * from workspace_push_config`);
ok(/permission denied/.test(r.error || ''), 'nobody can read the keys from the app — not even the admin');
r = await as(K, `select public.workspace_push_status()`);
ok(/Only the administrator/.test(r.error || ''), 'only the admin sees the status page');

r = await save(K, { ...dev('k', 1), endpoint: 'https://evil.example.com/push' });
ok(/isn't one we can send to/.test(r.error || ''), 'only real push services are accepted');
r = await save(K, { ...dev('k', 1), p256dh: 'short' });
ok(/incomplete/.test(r.error || ''), 'incomplete keys are refused');
await save(K, dev('k', 1)); await save(K, dev('k', 2), 'iPhone'); await save(A, dev('a', 1));
ok((await as(K, `select * from workspace_push_subscriptions`)).rows.length === 2 && (await as(A, `select * from workspace_push_subscriptions`)).rows.length === 1,
   'each person sees only their own devices');
r = await as(A, `select public.workspace_push_forget($1)`, [dev('k', 1).endpoint]);
ok((await su(`select count(*)::int n from workspace_push_subscriptions where user_id=$1`, [K]))[0].n === 2, "you can't remove someone else's device");

await su('truncate net.mock_requests');
const p1 = await newTask(H, 'Push me', K);
const reqs = await su(`select * from net.mock_requests order by id`);
const msgs = reqs.flatMap(x => x.body.messages);
ok(reqs.length === 1 && reqs[0].url === 'https://x.supabase.co/functions/v1/workspace-push', 'a new alert is handed to the Edge Function');
ok(msgs.length === 2 && msgs.every(m => m.endpoint.includes('/k-') && m.title === 'New task' && /assigned you "Push me"/.test(m.body)),
   "it goes to each of the person's devices, and only theirs");
ok(msgs[0].notice > 0 && msgs[0].tag === `tasks-${p1.id}`, 'tapping it can open the right task');
ok(reqs[0].body.vapid.private_key === 'd'.repeat(43) && reqs[0].headers.apikey === 'sb_publishable_x', 'the batch carries the signing keys and the site key');
await su('truncate net.mock_requests');
await su(`select public.notify(array[$1::uuid, $2::uuid], $3, 'tasks', null, 'due_today', 'Due today: x', null)`, [K, A, FIN]);
ok((await su(`select * from net.mock_requests`)).length === 1 && (await su(`select jsonb_array_length(body->'messages') n from net.mock_requests`))[0].n === 3,
   'alerts made together travel together');

// the push service said one device is gone: it is forgotten next time
const lastReq = (await su(`select max(request_id) id from workspace_push_log`))[0].id;
await su(`insert into net._http_response (id, status_code, content) values ($1, 200, $2)`,
  [lastReq, JSON.stringify({ workspace_push: true, sent: 2, gone: [dev('a', 1).endpoint], failed: [] })]);
await su(`select public.notify(array[$1::uuid], $2, 'tasks', null, 'due_today', 'Due today: y', null)`, [K, FIN]);
ok((await su(`select count(*)::int n from workspace_push_subscriptions where user_id=$1`, [A]))[0].n === 0, 'a device the push service says is gone is forgotten');

// a shared phone: someone else signs in and turns alerts on
await save(A, dev('k', 2), 'iPhone');
ok((await su(`select user_id from workspace_push_subscriptions where endpoint=$1`, [dev('k', 2).endpoint]))[0].user_id === A,
   "a shared device follows whoever turned alerts on last");
await as(A, `select public.workspace_push_forget($1)`, [dev('k', 2).endpoint]);
ok((await su(`select count(*)::int n from workspace_push_subscriptions where endpoint=$1`, [dev('k', 2).endpoint]))[0].n === 0, 'signing out removes the device');

const st = (await as(H, `select public.workspace_push_status() as s`)).rows[0].s;
ok(st.configured && st.enabled && st.pg_net && st.devices.length === 1 && st.recent.length >= 2, 'the admin sees set-up, devices and recent sends');
ok(st.recent.some(x => x.result?.sent === 2), 'including what the Edge Function reported');
r = await as(H, `select public.workspace_push_test() as id`);
ok(/None of your devices/.test(r.error || ''), "a test needs one of the admin's own devices");
await save(H, dev('h', 1), 'iPhone');
await su('truncate net.mock_requests');
const testId = (await as(H, `select public.workspace_push_test() as id`)).rows[0].id;
const tb = (await su(`select body from net.mock_requests where id=$1`, [testId]))[0].body;
ok(tb.messages.length === 1 && tb.messages[0].title === 'Phone alerts are working', 'the test goes to the admin only');
ok((await as(H, `select public.workspace_push_result($1) as r`, [testId])).rows[0].r.done === false, 'its result is pending until the call finishes');
await su(`insert into net._http_response (id, status_code, content) values ($1, 401, '{"msg":"Invalid JWT"}')`, [testId]);
const res = (await as(H, `select public.workspace_push_result($1) as r`, [testId])).rows[0].r;
ok(res.done && res.status === 401, 'then it shows what happened (e.g. 401 → Verify JWT still on)');

await as(H, `select public.workspace_push_enable(false)`);
await su('truncate net.mock_requests');
await newTask(H, 'Quiet', K);
ok((await su(`select count(*)::int n from net.mock_requests`))[0].n === 0, 'switched off: nothing is sent');
ok((await as(K, `select public.workspace_push_public_key() as k`)).rows[0].k === null, 'and devices are not offered the key');
await as(H, `select public.workspace_push_enable(true)`);

await su(`alter function net.http_post(text, jsonb, jsonb, jsonb, integer) rename to http_post_off`);
r = await as(H, `insert into tasks (title, assignee_id, due_date) values ('Still works', $1, $2) returning id`, [K, today]);
ok(!r.error && (await notices(K, 'assigned')).some(x => /Still works/.test(x.message)), 'if sending breaks, the app and the bell still work');
await su(`alter function net.http_post_off(text, jsonb, jsonb, jsonb, integer) rename to http_post`);

await as(H, `select public.workspace_push_setup('https://x.supabase.co/functions/v1/workspace-push', $1, $2, 'https://w.app', 'pk')`, ['Q'.repeat(87), 'e'.repeat(43)]);
ok((await su(`select count(*)::int n from workspace_push_subscriptions`))[0].n === 0, 'new keys: old devices are cleared (they re-join by themselves)');
ok((await as(D, `select * from workspace_push_subscriptions`)).rows.length === 0, 'HR sees no devices');

console.log(`\n${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail ? 1 : 0);
