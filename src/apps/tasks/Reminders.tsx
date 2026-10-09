import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import { go } from '../../lib/route';
import { toISO } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import Avatar from '../../platform/Avatar';
import type { Reminder, ReminderRepeat } from './types';
import { REMINDER_REPEATS, fmtWhen, isDue, loadReminders, presets, remindable, remindersChanged, repeatName, snoozes, toLocalInput } from './reminders';

/** My reminders (and the ones I set for others), kept fresh across the page. */
export function useReminders() {
  const { fail } = usePlatform();
  const [list, setList] = useState<Reminder[] | null>(null);
  const reload = useCallback(async () => {
    try { setList(await loadReminders()); } catch (e) { fail(e); }
  }, [fail]);
  useEffect(() => {
    reload();
    const on = () => reload();
    window.addEventListener('workspace:reminders', on);
    window.addEventListener('workspace:pushed', on);
    window.addEventListener('focus', on);
    return () => {
      window.removeEventListener('workspace:reminders', on);
      window.removeEventListener('workspace:pushed', on);
      window.removeEventListener('focus', on);
    };
  }, [reload]);
  return { list, reload };
}

/** Add a reminder: what, when (one tap or exact), repeat, and — for leads — for whom. */
export function ReminderForm({ taskId, defaultText = '', onSaved, autoFocus = true }: {
  taskId?: number; defaultText?: string; onSaved?: () => void; autoFocus?: boolean;
}) {
  const { me, isAdmin, deptPeople, userHasApp, toast, fail } = usePlatform();
  const people = useMemo(() => remindable(me, isAdmin, deptPeople, id => userHasApp(id, 'tasks')), [me, isAdmin, deptPeople, userHasApp]);
  const [body, setBody] = useState(defaultText);
  const [when, setWhen] = useState(() => toLocalInput(presets()[0].at));
  const [chip, setChip] = useState<string | null>(presets()[0].label);
  const [repeat, setRepeat] = useState<ReminderRepeat | ''>('');
  const [who, setWho] = useState(me.id);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return toast('What should the reminder say?', 'error');
    const at = new Date(when);
    if (isNaN(at.getTime())) return toast('Pick a date and time.', 'error');
    setBusy(true);
    const { error } = await supabase.from('task_reminders').insert({
      body: body.trim(), remind_at: at.toISOString(), repeat: repeat || null, user_id: who, task_id: taskId ?? null,
    });
    setBusy(false);
    if (error) return fail(error);
    toast(who === me.id ? `Reminder set for ${fmtWhen(at.toISOString())}` : `Reminder set for ${firstName(people.find(p => p.id === who)?.full_name ?? '')}`);
    setBody('');
    remindersChanged();
    onSaved?.();
  }

  return (
    <form className="rem-form" onSubmit={save}>
      <input className="rem-text" autoFocus={autoFocus} value={body} onChange={e => setBody(e.target.value)}
        placeholder={who === me.id ? 'Remind me to…' : `Remind ${firstName(people.find(p => p.id === who)?.full_name ?? '')} to…`}
        aria-label="Reminder text" maxLength={300} />
      <div className="rem-chips">
        {presets().map(p => (
          <button type="button" key={p.label} className={`chip-btn ${chip === p.label ? 'on' : ''}`}
            onClick={() => { setWhen(toLocalInput(p.at)); setChip(p.label); }}>{p.label}</button>
        ))}
        <input type="datetime-local" value={when} onChange={e => { setWhen(e.target.value); setChip(null); }} aria-label="When" />
      </div>
      <div className="rem-row">
        <select value={repeat} onChange={e => setRepeat(e.target.value as ReminderRepeat | '')} aria-label="Repeat">
          <option value="">Once</option>
          {REMINDER_REPEATS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {people.length > 1 && (
          <select value={who} onChange={e => setWho(e.target.value)} aria-label="For">
            {people.map(p => <option key={p.id} value={p.id}>{p.id === me.id ? 'For me' : `For ${p.full_name}`}</option>)}
          </select>
        )}
        <button className="btn primary sm" disabled={busy || !body.trim()}>{busy ? 'Saving…' : 'Set reminder'}</button>
      </div>
    </form>
  );
}

/** One reminder with Done / Snooze / Make it a task / Delete. */
export function ReminderItem({ r, compact = false }: { r: Reminder; compact?: boolean }) {
  const { me, person, toast, fail } = usePlatform();
  const [snoozing, setSnoozing] = useState(false);
  const mine = r.user_id === me.id;
  const due = isDue(r);
  const from = r.created_by && r.created_by !== r.user_id ? person(r.created_by) : undefined;
  const forWho = !mine ? person(r.user_id) : undefined;

  async function patch(p: Partial<Reminder>, msg: string) {
    const { error } = await supabase.from('task_reminders').update(p).eq('id', r.id);
    if (error) return fail(error);
    toast(msg);
    remindersChanged();
  }
  async function remove() {
    const { error } = await supabase.from('task_reminders').delete().eq('id', r.id);
    if (error) return fail(error);
    toast('Reminder deleted');
    remindersChanged();
  }
  async function makeTask() {
    const { data, error } = await supabase.from('tasks').insert({
      title: r.body, notes: '', status: 'todo', priority: 'normal', assignee_id: r.user_id, due_date: toISO(new Date(r.remind_at)),
    }).select('id').single();
    if (error) return fail(error);
    await supabase.from('task_reminders').update({ done_at: new Date().toISOString() }).eq('id', r.id);
    remindersChanged();
    toast('Turned into a task');
    go('tasks', 'list', { task: String((data as { id: number }).id) });
  }

  return (
    <li className={`rem-item ${due ? 'due' : ''} ${r.done_at ? 'done' : ''} ${compact ? 'compact' : ''}`}>
      <div className="rem-main">
        <div className="rem-body">{r.body}</div>
        <div className="rem-meta">
          <span className={due ? 'warn-text' : ''}>{r.done_at ? 'Done' : fmtWhen(r.remind_at)}</span>
          {r.repeat && <span>· ⟳ {repeatName(r.repeat).toLowerCase()}</span>}
          {from && <span>· from {firstName(from.full_name)}</span>}
          {forWho && <span className="rem-for"><Avatar p={forWho} size={16} /> for {firstName(forWho.full_name)}</span>}
          {r.task_id && <button type="button" className="link" onClick={() => go('tasks', 'list', { task: String(r.task_id) })}>open task</button>}
        </div>
      </div>
      {!r.done_at && (
        <div className="rem-actions">
          {snoozing ? (
            <>
              {snoozes().map(s => (
                <button key={s.label} type="button" className="btn sm"
                  onClick={() => { setSnoozing(false); patch({ remind_at: s.at.toISOString() }, `Snoozed until ${fmtWhen(s.at.toISOString())}`); }}>{s.label}</button>
              ))}
              <button type="button" className="btn sm" onClick={() => setSnoozing(false)}>✕</button>
            </>
          ) : (
            <>
              {mine && <button type="button" className="btn sm" onClick={() => patch({ done_at: new Date().toISOString() }, r.repeat ? 'Reminder stopped' : 'Done')}>{r.repeat ? 'Stop' : 'Done'}</button>}
              {mine && !r.repeat && <button type="button" className="btn sm" onClick={() => setSnoozing(true)}>Snooze</button>}
              {mine && !r.task_id && !compact && <button type="button" className="btn sm" onClick={makeTask}>Make it a task</button>}
              <button type="button" className="icon-btn" aria-label="Delete reminder" title="Delete" onClick={remove}>✕</button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
