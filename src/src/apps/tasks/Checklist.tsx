import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import type { ChecklistItem } from './types';

/** Checklist steps inside a task. Before the task exists, steps are queued and saved on create. */
export function useChecklist(taskId: number | null, onChange?: () => void) {
  const { fail } = usePlatform();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [pending, setPending] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!taskId) return;
    const { data } = await supabase.from('task_checklist').select('*').eq('task_id', taskId).order('position').order('id');
    setItems((data as ChecklistItem[]) ?? []);
  }, [taskId]);
  useEffect(() => { load(); }, [load]);

  const add = useCallback(async (body: string) => {
    const b = body.trim();
    if (!b) return;
    if (!taskId) { setPending(p => [...p, b]); return; }
    const position = (items.at(-1)?.position ?? 0) + 1;
    const { data, error } = await supabase.from('task_checklist').insert({ task_id: taskId, body: b, position }).select().single();
    if (error) return fail(error);
    setItems(xs => [...xs, data as ChecklistItem]);
    onChange?.();
  }, [taskId, items, fail, onChange]);

  const toggle = useCallback(async (it: ChecklistItem) => {
    setItems(xs => xs.map(x => (x.id === it.id ? { ...x, done: !x.done } : x)));
    const { data, error } = await supabase.from('task_checklist').update({ done: !it.done }).eq('id', it.id).select().maybeSingle();
    if (error || !data) { fail(error ?? new Error('Could not update that step.')); load(); return; }
    setItems(xs => xs.map(x => (x.id === it.id ? (data as ChecklistItem) : x)));
    onChange?.();
  }, [fail, load, onChange]);

  const rename = useCallback(async (it: ChecklistItem, body: string) => {
    const b = body.trim();
    if (!b || b === it.body) return;
    const { error } = await supabase.from('task_checklist').update({ body: b }).eq('id', it.id);
    if (error) return fail(error);
    setItems(xs => xs.map(x => (x.id === it.id ? { ...x, body: b } : x)));
  }, [fail]);

  const remove = useCallback(async (it: ChecklistItem) => {
    const { error } = await supabase.from('task_checklist').delete().eq('id', it.id);
    if (error) return fail(error);
    setItems(xs => xs.filter(x => x.id !== it.id));
    onChange?.();
  }, [fail, onChange]);

  const flush = useCallback(async (id: number) => {
    if (!pending.length) return;
    await supabase.from('task_checklist').insert(pending.map((body, i) => ({ task_id: id, body, position: i + 1 })));
    setPending([]);
  }, [pending]);

  return { items, pending, setPending, add, toggle, rename, remove, flush };
}

export function Checklist({ list }: { list: ReturnType<typeof useChecklist> }) {
  const { items, pending, setPending, add, toggle, rename, remove } = list;
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const done = items.filter(i => i.done).length;
  const total = items.length + pending.length;

  return (
    <section className="checklist">
      <div className="section-head">
        <span className="section-title">
          Checklist {total > 0 && <span className={`count ${total && done === items.length && !pending.length ? 'good' : ''}`}>{done}/{total}</span>}
        </span>
      </div>
      {total > 0 && (
        <div className="progress" aria-hidden="true"><div style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
      )}
      <ul className="steps">
        {items.map(it => (
          <li key={it.id} className={it.done ? 'done' : ''}>
            <input type="checkbox" checked={it.done} onChange={() => toggle(it)} aria-label={`Step: ${it.body}`} />
            {editing === it.id ? (
              <input className="step-edit" autoFocus defaultValue={it.body}
                onBlur={e => { rename(it, e.target.value); setEditing(null); }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} />
            ) : (
              <span className="step-text" onClick={() => setEditing(it.id)}>{it.body}</span>
            )}
            <button type="button" className="step-x" onClick={() => remove(it)} aria-label={`Remove step ${it.body}`}>✕</button>
          </li>
        ))}
        {pending.map((b, i) => (
          <li key={`p${i}`}>
            <input type="checkbox" disabled aria-label={`Step: ${b}`} />
            <span className="step-text">{b}</span>
            <button type="button" className="step-x" onClick={() => setPending(p => p.filter((_, j) => j !== i))} aria-label={`Remove step ${b}`}>✕</button>
          </li>
        ))}
      </ul>
      <form className="step-add" onSubmit={e => { e.preventDefault(); add(draft); setDraft(''); }}>
        <span className="qa-plus">+</span>
        <input placeholder="Add a step and press Enter" value={draft} onChange={e => setDraft(e.target.value)} aria-label="Add a checklist step" />
      </form>
    </section>
  );
}
