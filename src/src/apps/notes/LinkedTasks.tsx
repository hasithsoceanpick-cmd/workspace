import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabase';
import { go } from '../../lib/route';
import { fmtDue, today } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import { usePlatform } from '../../platform/store';
import Avatar from '../../platform/Avatar';

type TaskLite = { id: number; title: string; status: string; due_date: string; assignee_id: string };
const COLS = 'id,title,status,due_date,assignee_id';

/** Tasks linked to a page. Only tasks you're allowed to see are listed. */
export default function LinkedTasks({ noteId, departmentId }: { noteId: number; departmentId: string }) {
  const { person, fail, toast } = usePlatform();
  const [linked, setLinked] = useState<TaskLite[]>([]);
  const [all, setAll] = useState<TaskLite[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('notes_task_links').select('task_id').eq('note_id', noteId);
    const ids = ((data ?? []) as { task_id: number }[]).map(r => r.task_id);
    if (!ids.length) return setLinked([]);
    const t = await supabase.from('tasks').select(COLS).in('id', ids);
    setLinked(((t.data ?? []) as TaskLite[]).sort((a, b) => a.due_date.localeCompare(b.due_date)));
  }, [noteId]);
  useEffect(() => { load(); }, [load]);

  async function openPicker() {
    setPicking(p => !p);
    if (all) return;
    const { data } = await supabase.from('tasks').select(COLS).eq('department_id', departmentId).order('due_date', { ascending: false }).limit(500);
    setAll((data ?? []) as TaskLite[]);
  }

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (all ?? [])
      .filter(t => !linked.some(l => l.id === t.id))
      .filter(t => (s ? t.title.toLowerCase().includes(s) || String(t.id) === s.replace('#', '') : t.status !== 'done'))
      .slice(0, 8);
  }, [all, linked, q]);

  async function link(t: TaskLite) {
    const { error } = await supabase.from('notes_task_links').insert({ note_id: noteId, task_id: t.id });
    if (error) return fail(error);
    setQ('');
    setPicking(false);
    toast('Task linked');
    load();
  }
  async function unlink(t: TaskLite) {
    const { error, count } = await supabase.from('notes_task_links').delete({ count: 'exact' }).eq('note_id', noteId).eq('task_id', t.id);
    if (error || !count) return fail(error ?? new Error('Only people who can edit this page can remove links others added.'));
    setLinked(ls => ls.filter(l => l.id !== t.id));
  }

  const td = today();
  return (
    <section className="note-section">
      <div className="section-head">
        <span className="section-title">Linked tasks {linked.length > 0 && <span className="count">{linked.length}</span>}</span>
        <button className="btn sm" onClick={openPicker}>{picking ? 'Close' : '+ Link a task'}</button>
      </div>
      {picking && (
        <div className="picker">
          <input autoFocus type="search" placeholder="Search tasks by title or #number…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search tasks" />
          {all === null ? <div className="muted small">Loading…</div> : matches.length === 0 ? <div className="muted small">No tasks found.</div> : (
            <ul>
              {matches.map(t => (
                <li key={t.id}><button onClick={() => link(t)}>
                  <span className="grow">{t.title}</span>
                  <span className="muted tiny">#{t.id} · {firstName(person(t.assignee_id)?.full_name ?? '')} · {t.status === 'done' ? 'done' : fmtDue(t.due_date)}</span>
                </button></li>
              ))}
            </ul>
          )}
        </div>
      )}
      {linked.length === 0 ? (!picking && <div className="muted small">No tasks linked yet.</div>) : (
        <ul className="linked-list">
          {linked.map(t => {
            const late = t.status !== 'done' && t.status !== 'review' && t.due_date < td;
            return (
              <li key={t.id} className={t.status === 'done' ? 'done' : ''}>
                <button className="linked-open" onClick={() => go('tasks', 'list', { task: String(t.id) })}>
                  <span className={`st-dot s-${t.status}`} />
                  <span className="grow">{t.title}</span>
                  <Avatar p={person(t.assignee_id)} size={18} />
                  <span className={`tiny ${late ? 'danger' : 'muted'}`}>{t.status === 'done' ? 'Done' : t.status === 'review' ? 'Waiting for sign-off' : fmtDue(t.due_date)}</span>
                </button>
                <button className="icon-btn" onClick={() => unlink(t)} aria-label={`Unlink ${t.title}`}>✕</button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
