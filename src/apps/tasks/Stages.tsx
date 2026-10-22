import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../supabase';
import { useTaskApp } from './store';
import { daysBetween, fmtDue, today } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import Avatar from '../../platform/Avatar';
import type { ChecklistItem } from './types';

type Draft = { body: string; due_date: string; assignee_id: string };

/** A project's stages (checklist steps with a date and a person). Before the project exists they're queued. */
export function useStages(taskId: number | null) {
  const { fail, refreshChecklist } = useTaskApp();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [pending, setPending] = useState<Draft[]>([]);

  const load = useCallback(async () => {
    if (!taskId) return;
    const { data } = await supabase.from('task_checklist').select('*').eq('task_id', taskId);
    setItems(((data as ChecklistItem[]) ?? []).sort((a, b) =>
      (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.position - b.position || a.id - b.id));
  }, [taskId]);
  useEffect(() => { load(); }, [load]);

  const after = useCallback(() => { load(); refreshChecklist(); }, [load, refreshChecklist]);

  const add = useCallback(async (d: Draft) => {
    if (!d.body.trim()) return false;
    if (!taskId) { setPending(p => [...p, { ...d, body: d.body.trim() }]); return true; }
    const { error } = await supabase.from('task_checklist').insert({
      task_id: taskId, body: d.body.trim(), due_date: d.due_date || null, assignee_id: d.assignee_id || null,
      position: items.length + 1,
    });
    if (error) { fail(error); return false; }
    after();
    return true;
  }, [taskId, items.length, fail, after]);

  const change = useCallback(async (s: ChecklistItem, patch: Partial<Pick<ChecklistItem, 'body' | 'due_date' | 'assignee_id' | 'done'>>) => {
    setItems(xs => xs.map(x => (x.id === s.id ? { ...x, ...patch } : x)));
    const { data, error } = await supabase.from('task_checklist').update(patch).eq('id', s.id).select().maybeSingle();
    if (error || !data) { fail(error ?? new Error('You can only tick your own stages.')); }
    after();
  }, [fail, after]);

  const remove = useCallback(async (s: ChecklistItem) => {
    const { error } = await supabase.from('task_checklist').delete().eq('id', s.id);
    if (error) fail(error);
    after();
  }, [fail, after]);

  const flush = useCallback(async (id: number) => {
    if (!pending.length) return;
    const { error } = await supabase.from('task_checklist').insert(pending.map((d, i) => ({
      task_id: id, body: d.body, due_date: d.due_date || null, assignee_id: d.assignee_id || null, position: i + 1,
    })));
    if (error) fail(error);
    setPending([]);
    refreshChecklist();
  }, [pending, fail, refreshChecklist]);

  return { items, pending, setPending, add, change, remove, flush, reload: load };
}

/** The stages list: tick, date, person; the project's owner (or whoever runs it) changes them. */
export function Stages({ list, ownerId, canRun, endDate }: {
  list: ReturnType<typeof useStages>; ownerId: string; canRun: boolean; endDate?: string;
}) {
  const { me, team, person } = useTaskApp();
  const { items, pending, setPending, add, change, remove } = list;
  const [d, setD] = useState<Draft>({ body: '', due_date: '', assignee_id: '' });
  const [editing, setEditing] = useState<number | null>(null);
  const td = today();
  const done = items.filter(i => i.done).length;
  const total = items.length + pending.length;
  const late = items.filter(i => !i.done && i.due_date && i.due_date < td).length;
  const ownerName = firstName(person(ownerId)?.full_name ?? 'Owner');
  const people = team.some(p => p.id === ownerId) ? team : [...team, ...(person(ownerId) ? [person(ownerId)!] : [])];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await add(d)) setD({ body: '', due_date: d.due_date, assignee_id: '' });
  }

  const who = (id: string | null) => id ?? ownerId;
  return (
    <section className="stages">
      <div className="section-head">
        <span className="section-title">
          Stages {total > 0 && <span className={`count ${total && done === total ? 'good' : ''}`}>{done}/{total}</span>}
          {late > 0 && <span className="pill high">{late} overdue</span>}
        </span>
      </div>
      {total > 0 && <div className="progress" aria-hidden="true"><div style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>}
      <ul className="stage-list">
        {items.map(s => {
          const mine = who(s.assignee_id) === me.id;
          const overdue = !s.done && !!s.due_date && s.due_date < td;
          return (
            <li key={s.id} className={`stage ${s.done ? 'done' : ''} ${overdue ? 'late' : ''}`}>
              <input type="checkbox" checked={s.done} disabled={!canRun && !mine} onChange={() => change(s, { done: !s.done })}
                aria-label={`Stage: ${s.body}`} title={!canRun && !mine ? 'Only the person doing this stage (or the owner) ticks it' : undefined} />
              <div className="stage-main">
                {canRun && editing === s.id ? (
                  <input className="step-edit" autoFocus defaultValue={s.body}
                    onBlur={e => { const v = e.target.value.trim(); setEditing(null); if (v && v !== s.body) change(s, { body: v }); }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} />
                ) : (
                  <span className="stage-text" onClick={() => canRun && setEditing(s.id)}>{s.body}</span>
                )}
                <span className="stage-meta">
                  {canRun ? (
                    <input type="date" value={s.due_date ?? ''} onChange={e => change(s, { due_date: e.target.value || null })} aria-label={`Date for ${s.body}`} />
                  ) : (
                    <span className={overdue ? 'danger' : 'muted'}>{s.due_date ? fmtDue(s.due_date) : 'no date'}</span>
                  )}
                  {overdue && <span className="danger tiny">{daysBetween(s.due_date!, td)}d late</span>}
                  {canRun && people.length > 1 ? (
                    <select value={s.assignee_id ?? ''} onChange={e => change(s, { assignee_id: e.target.value || null })} aria-label={`Person for ${s.body}`}>
                      <option value="">{ownerName} (owner)</option>
                      {people.filter(p => p.id !== ownerId).map(p => <option key={p.id} value={p.id}>{p.id === me.id ? `${p.full_name} (me)` : p.full_name}</option>)}
                    </select>
                  ) : (
                    <span className="stage-who"><Avatar p={person(who(s.assignee_id))} size={16} /> {firstName(person(who(s.assignee_id))?.full_name ?? '')}</span>
                  )}
                </span>
              </div>
              {canRun && <button type="button" className="step-x" onClick={() => remove(s)} aria-label={`Remove stage ${s.body}`}>✕</button>}
            </li>
          );
        })}
        {pending.map((p, i) => (
          <li key={`p${i}`} className="stage">
            <input type="checkbox" disabled aria-label={`Stage: ${p.body}`} />
            <div className="stage-main">
              <span className="stage-text">{p.body}</span>
              <span className="stage-meta muted">{p.due_date ? fmtDue(p.due_date) : 'no date'} · {firstName(person(p.assignee_id || ownerId)?.full_name ?? '')}</span>
            </div>
            <button type="button" className="step-x" onClick={() => setPending(xs => xs.filter((_, j) => j !== i))} aria-label={`Remove stage ${p.body}`}>✕</button>
          </li>
        ))}
      </ul>
      {total === 0 && <div className="muted small">No stages yet{canRun ? ' — add the first one below.' : '.'}</div>}
      {canRun && (
        <form className="stage-add" onSubmit={submit}>
          <input placeholder="Stage, e.g. Collect board resolutions" value={d.body} onChange={e => setD({ ...d, body: e.target.value })} aria-label="New stage" />
          <input type="date" value={d.due_date} max={endDate || undefined} onChange={e => setD({ ...d, due_date: e.target.value })} aria-label="New stage date" />
          {people.length > 1 && (
            <select value={d.assignee_id} onChange={e => setD({ ...d, assignee_id: e.target.value })} aria-label="New stage person">
              <option value="">{ownerName} (owner)</option>
              {people.filter(p => p.id !== ownerId).map(p => <option key={p.id} value={p.id}>{p.id === me.id ? `${p.full_name} (me)` : p.full_name}</option>)}
            </select>
          )}
          <button className="btn sm" disabled={!d.body.trim()}>Add stage</button>
        </form>
      )}
    </section>
  );
}
