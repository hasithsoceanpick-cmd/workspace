// Seed a two-department demo through the real API (so triggers + rules run).
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const URL = process.env.MOCK_URL || 'http://localhost:54321';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:54322/postgres' });
await db.query(`truncate notifications, task_activity, task_comments, time_blocks, task_helpers, task_checklist, task_attachments,
  notes_task_links, notes_files, notes_shares, notes_pages, tasks, daily_notes, app_members, department_apps, department_features restart identity cascade;
  delete from storage.objects;
  delete from platform_admins; delete from profiles; delete from departments; delete from auth.users;`);

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const must = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };

async function user(email, name) {
  const sb = createClient(URL, 'anon', { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signUp({ email, password: 'password1', options: { data: { full_name: name } } });
  if (error) throw error;
  return { sb, id: data.user.id, name };
}
const H = await user('hasith@demo.lk', 'Hasith Ranaweera');   // admin + Finance manager
const N = await user('nadeesha@demo.lk', 'Nadeesha Perera');  // Finance senior
const K = await user('kasun@demo.lk', 'Kasun Silva');         // Finance member
const A = await user('amaya@demo.lk', 'Amaya Fernando');      // Finance member
const P = await user('priya@demo.lk', 'Priya Wickramasinghe'); // HR manager
const D = await user('dilan@demo.lk', 'Dilan Gunasekara');    // HR member
const S = await user('sachini@demo.lk', 'Sachini Rajapaksa'); // HR member
const R = await user('ruwan@demo.lk', 'Ruwan Jayasinghe');    // pending

const depts = must(await H.sb.from('departments').insert([{ name: 'Finance' }, { name: 'HR' }]).select());
const FIN = depts.find(d => d.name === 'Finance').id, HR = depts.find(d => d.name === 'HR').id;
must(await H.sb.from('department_apps').insert([{ department_id: FIN, app_key: 'tasks' }, { department_id: HR, app_key: 'tasks' }, { department_id: FIN, app_key: 'notes' }]).select());
must(await H.sb.from('department_features').insert({ department_id: FIN, feature_key: 'daily_notes' }).select());
must(await H.sb.from('profiles').update({ department_id: FIN, role: 'manager' }).eq('id', H.id).select());
must(await H.sb.from('profiles').update({ department_id: FIN, role: 'senior', active: true }).eq('id', N.id).select());
must(await H.sb.from('profiles').update({ department_id: FIN, role: 'member', active: true }).in('id', [K.id, A.id]).select());
must(await H.sb.from('profiles').update({ department_id: HR, role: 'manager', active: true }).eq('id', P.id).select());
must(await H.sb.from('profiles').update({ department_id: HR, role: 'member', active: true }).in('id', [D.id, S.id]).select());

async function task(by, to, title, due, extra = {}) {
  return must(await by.sb.from('tasks').insert({ title, assignee_id: to.id, due_date: due, notes: '', status: 'todo', priority: 'normal', ...extra }).select().single());
}
// Finance
const t1 = await task(H, K, 'Bank reconciliation — Commercial Bank', day(-2), { priority: 'high' });
const t2 = await task(H, A, 'Post September supplier invoices to ERP', day(0));
const t3 = await task(H, N, 'Review VAT return schedules', day(1), { priority: 'high', notes: 'Check input VAT tagging against invoice dates.' });
const t4 = await task(H, A, 'WHT schedule for September', day(2));
await task(H, K, 'Petty cash count & top-up', day(0), { status: 'doing' });
await task(H, H, 'Board pack — management accounts', day(3), { priority: 'high' });
await task(H, N, 'Export reconciliation: customs vs VAT', day(4));
await task(H, K, 'Fixed asset register update', day(8));
await task(H, A, 'Follow up debtor statements', day(-1));
await task(N, K, 'Clear unreconciled items list', day(1));
await task(N, A, 'Scan & file GRNs', day(3), { priority: 'low' });
// HR
const h1 = await task(P, D, 'Collect October payroll inputs', day(1), { priority: 'high' });
await task(P, S, 'Update leave register', day(0));
await task(P, D, 'Onboarding pack for new hires', day(4));
await task(P, P, 'Quarterly training plan', day(6));
await task(P, S, 'Renew staff medical insurance quotes', day(-1));

must(await A.sb.from('tasks').update({ status: 'done' }).eq('id', t2.id).select());
must(await A.sb.from('tasks').update({ due_date: day(4) }).eq('id', t4.id).select());
must(await N.sb.from('tasks').update({ status: 'doing' }).eq('id', t3.id).select());
must(await N.sb.from('task_comments').insert({ task_id: t3.id, body: 'Two invoices tagged to the wrong period — fixing now.' }).select());
must(await K.sb.from('tasks').update({ status: 'waiting' }).eq('id', t1.id).select());
must(await D.sb.from('tasks').update({ due_date: day(2) }).eq('id', h1.id).select());
must(await D.sb.from('task_comments').insert({ task_id: h1.id, body: 'Two department heads still to send theirs.' }).select());
must(await K.sb.from('daily_notes').insert({ day: day(0), body: 'Bank rec waiting on last week statement. Petty cash counted, top-up request sent.' }).select());
must(await A.sb.from('daily_notes').insert({ day: day(0), body: 'September supplier invoices all posted (64). WHT schedule moved to Thursday — waiting on 2 certificates.' }).select());

await db.query(`with x as (select set_config('app.system','on',true))
  update tasks set created_at = now() - interval '3 days' from x`);
console.log('seeded', { FIN, HR, tasks: (await db.query('select count(*) from tasks')).rows[0].count });
await db.end();
