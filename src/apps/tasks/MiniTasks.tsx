import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { supabase } from '../../supabase';
import { useTaskApp } from './store';
import { fmtDay, fmtDue, today } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import type { MiniTask } from './types';

/**
 * Mini tasks: quick to-dos for one day, on the Today page. Private to you.
 * One not ticked by the end of its day waits in "Left from earlier" the next morning:
 * do it today, turn it into a real task, or delete it.
 */
export default function MiniTasks({ day }: { day: string }) {
  const { me, dept, fail, toast, createTask, openTask, person, team } = useTaskApp();
  const td = today();
  const isToday = day === td;
  const [items, setItems] = useState<MiniTask[] | null>(null);
  const [given, setGiven] = useState<MiniTask[]>([]);          // ones I gave to others for this day
  const [leftovers, setLeftovers] = useState<MiniTask[]>([]);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    const base = () => supabase.from('task_minis').select('*').eq('user_id', me.id).eq('department_id', dept!.id);
    const [a, b, g] = await Promise.all([
      base().eq('day', day).order('created_at').order('id'),
      isToday ? base().lt('day', td).is('done_at', null).order('day').order('id') : Promise.resolve({ data: [], error: null }),
      supabase.from('task_minis').select('*').eq('created_by', me.id).neq('user_id', me.id).eq('day', day).order('created_at').order('id'),
    ]);
    if (a.error) return fail(a.error);
    setItems((a.data ?? []) as MiniTask[]);
    setGiven((g.data ?? []) as MiniTask[]);
    setLeftovers((b.data ?? []) as MiniTask[]);
  }, [me.id, dept, day, isToday, td, fail]);
  useEffect(() => { setItems(null); load(); }, [load]);
  // a mini task was just given from "+ New → Mini task"
  useEffect(() => {
    const again = () => load();
    window.addEventListener('workspace:minis', again);
    return () => window.removeEventListener('workspace:minis', again);
  }, [load]);

  async function changeGiven(m: MiniTask, body: string) {
    setEditing(null);
    const b = body.trim();
    if (!b || b === m.body) return;
    setGiven(xs => xs.map(x => (x.id === m.id ? { ...x, body: b } : x)));
    const { error, count } = await supabase.from('task_minis').update({ body: b }, { count: 'exact' }).eq('id', m.id);
    if (error || !count) { fail(error ?? new Error('It has been ticked already.')); load(); }
  }
  async function takeBack(m: MiniTask) {
    setGiven(xs => xs.filter(x => x.id !== m.id));
    const { error, count } = await supabase.from('task_minis').delete({ count: 'exact' }).eq('id', m.id);
    if (error || !count) { fail(error ?? new Error('It has been ticked already.')); load(); }
  }

  async function add() {
    const body = text.trim();
    if (!body) return;
    setText('');
    const { data, error } = await supabase.from('task_minis').insert({ body, day }).select().single();
    if (error) { setText(body); return fail(error); }
    setItems(xs => [...(xs ?? []), data as MiniTask]);
  }

  async function patch(m: MiniTask, p: Partial<Pick<MiniTask, 'done_at' | 'body' | 'day'>>) {
    const { data, error } = await supabase.from('task_minis').update(p).eq('id', m.id).select().single();
    if (error) { fail(error); load(); return null; }
    return data as MiniTask;
  }

  async function toggle(m: MiniTask) {
    const done_at = m.done_at ? null : new Date().toISOString();
    setItems(xs => (xs ?? []).map(x => (x.id === m.id ? { ...x, done_at } : x)));
    await patch(m, { done_at });
  }

  async function rename(m: MiniTask, body: string) {
    setEditing(null);
    const b = body.trim();
    if (!b || b === m.body) return;
    setItems(xs => (xs ?? []).map(x => (x.id === m.id ? { ...x, body: b } : x)));
    await patch(m, { body: b });
  }

  async function remove(m: MiniTask) {
    setItems(xs => (xs ?? []).filter(x => x.id !== m.id));
    setLeftovers(xs => xs.filter(x => x.id !== m.id));
    const { error } = await supabase.from('task_minis').delete().eq('id', m.id);
    if (error) { fail(error); load(); }
  }

  async function doToday(m: MiniTask) {
    setBusy(m.id);
    const moved = await patch(m, { day: td });
    setBusy(null);
    if (!moved) return;
    setLeftovers(xs => xs.filter(x => x.id !== m.id));
    if (isToday) setItems(xs => [...(xs ?? []), moved]);
  }

  /** a real task for me, due today (or the mini task's own day if that's later); opened so details can be added */
  async function makeTask(m: MiniTask) {
    setBusy(m.id);
    const t = await createTask({
      title: m.body, notes: '', assignee_id: me.id, status: 'todo', priority: 'normal',
      due_date: m.day > td ? m.day : td,
    });
    if (!t) { setBusy(null); return; }
    await supabase.from('task_minis').delete().eq('id', m.id);
    setItems(xs => (xs ?? []).filter(x => x.id !== m.id));
    setLeftovers(xs => xs.filter(x => x.id !== m.id));
    setBusy(null);
    toast('Now a task — set its deadline, owner or steps here');
    openTask(t.id);
  }

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  const list = items ?? [];
  const doneN = list.filter(m => m.done_at).length;

  return (
    <section className="minis" aria-label="Mini tasks">
      {leftovers.length > 0 && (
        <div className="mini-left">
          <div className="mini-left-head">
            <strong>Left from earlier</strong> <span className="count">{leftovers.length}</span>
            <div className="muted tiny">Not ticked off on the day. Do it today, make it a task, or delete it.</div>
          </div>
          <ul>
            {leftovers.map(m => (
              <li key={m.id} className="mini-left-item">
                <div className="mini-left-text">
                  <span>{m.body}</span>
                  <span className="muted tiny">{fmtDue(m.day) === 'Yesterday' ? 'yesterday' : fmtDay(m.day)}</span>
                </div>
                <div className="mini-left-acts">
                  <button className="btn sm" disabled={busy === m.id} onClick={() => doToday(m)}>Do today</button>
                  <button className="btn sm" disabled={busy === m.id} onClick={() => makeTask(m)}>Make task</button>
                  <button className="btn sm mini-del" disabled={busy === m.id} onClick={() => remove(m)} aria-label={`Delete ${m.body}`}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mini-head">
        <span className="section-title">Mini tasks</span>
        {list.length > 0 && <span className="muted tiny">{doneN}/{list.length} done</span>}
      </div>
      <ul className="mini-list">
        {items === null && <li className="muted small">Loading…</li>}
        {list.map(m => (
          <li key={m.id} className={`mini ${m.done_at ? 'done' : ''}`}>
            <button className={`check ${m.done_at ? 'on' : ''}`} onClick={() => toggle(m)} aria-label={m.done_at ? `Not done: ${m.body}` : `Done: ${m.body}`}>
              <svg viewBox="0 0 16 16" width="11" height="11"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {editing === m.id ? (
              <input className="mini-edit" autoFocus defaultValue={m.body} maxLength={300}
                onBlur={e => rename(m, e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} />
            ) : (
              <button className="mini-text" onClick={() => setEditing(m.id)} title="Click to edit">{m.body}</button>
            )}
            {m.created_by && m.created_by !== me.id && (
              <span className="mini-from" title={`Given by ${person(m.created_by)?.full_name ?? ''}`}>from {firstName(person(m.created_by)?.full_name ?? '')}</span>
            )}
            {!m.done_at && (
              <button className="mini-act" disabled={busy === m.id} onClick={() => makeTask(m)} title="Turn into a real task" aria-label={`Make a task: ${m.body}`}>→ Task</button>
            )}
            <button className="mini-act x" onClick={() => remove(m)} aria-label={`Delete ${m.body}`}>✕</button>
          </li>
        ))}
      </ul>
      <input className="mini-add" placeholder={isToday ? 'Add a mini task… (Enter)' : `Add a mini task for ${fmtDay(day)}… (Enter)`}
        value={text} maxLength={300} onChange={e => setText(e.target.value)} onKeyDown={onKey} aria-label="Add a mini task" />
      {team.length > 1 && given.length === 0 && <div className="muted tiny mini-tip">To give someone a mini task: <strong>+ New task → Mini task</strong>.</div>}

      {given.length > 0 && (
        <div className="mini-given">
          <div className="mini-head">
            <span className="section-title">Given to others</span>
            <span className="muted tiny">{given.filter(m => m.done_at).length}/{given.length} done</span>
          </div>
          <ul className="mini-list">
            {given.map(m => (
              <li key={m.id} className={`mini given ${m.done_at ? 'done' : ''}`}>
                <span className={`check static ${m.done_at ? 'on' : ''}`} aria-label={m.done_at ? 'Ticked' : 'Not ticked yet'}>
                  <svg viewBox="0 0 16 16" width="11" height="11"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                {editing === -m.id ? (
                  <input className="mini-edit" autoFocus defaultValue={m.body} maxLength={300}
                    onBlur={e => changeGiven(m, e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} />
                ) : (
                  <button className="mini-text" onClick={() => !m.done_at && setEditing(-m.id)} title={m.done_at ? 'Ticked' : 'Click to change'}>{m.body}</button>
                )}
                <span className="mini-from">{firstName(person(m.user_id)?.full_name ?? '')}</span>
                {!m.done_at && <button className="mini-act x" onClick={() => takeBack(m)} aria-label={`Take back ${m.body}`}>✕</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
