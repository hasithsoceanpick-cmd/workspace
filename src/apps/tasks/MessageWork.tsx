import { useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import type { WorkItem, WorkMakeProps } from '../../platform/slots';
import { addDays, isWeekday, today } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import { presets, remindable, remindersChanged, toLocalInput } from './reminders';

const LABEL = { task: 'task', mini: 'mini task', reminder: 'reminder', note: 'note' } as const;

function nextWorkday() {
  let d = addDays(today(), 1);
  while (!isWeekday(d)) d = addDays(d, 1);
  return d;
}

/**
 * Messages → "Send as …" and "Make it a …": a task, mini task or reminder from a message's words.
 * Only for people you could give work to anyway (the database checks again).
 */
export default function MessageWork({ kind, text, suggest, mode, onDone }: WorkMakeProps) {
  const { me, isAdmin, deptPeople, userHasApp, person, fail, toast, refreshNotices } = usePlatform();
  const people = useMemo(() => remindable(me, isAdmin, deptPeople, id => userHasApp(id, 'tasks')), [me, isAdmin, deptPeople, userHasApp]);
  const choices = mode === 'send' ? people.filter(p => p.id !== me.id) : people;
  const [who, setWho] = useState(() => suggest.find(id => choices.some(p => p.id === id)) ?? choices[0]?.id ?? me.id);
  const lines = text.trim().split('\n');
  const [title, setTitle] = useState(lines[0].slice(0, kind === 'task' ? 200 : 300));
  const [due, setDue] = useState(nextWorkday);
  const [day, setDay] = useState(today);
  const [when, setWhen] = useState(() => toLocalInput(presets().find(p => p.label === 'Tomorrow 9 am')?.at ?? presets()[0].at));
  const [busy, setBusy] = useState(false);
  const td = today();
  const name = who === me.id ? 'you' : firstName(person(who)?.full_name ?? '');
  const label = LABEL[kind];

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    let item: WorkItem | null = null;
    if (kind === 'task') {
      const { data, error } = await supabase.from('tasks').insert({
        title: t, notes: lines.length > 1 ? text.trim() : '', assignee_id: who, status: 'todo', priority: 'normal', due_date: due,
      }).select().single();
      if (error) { setBusy(false); return fail(error); }
      item = { kind, ref_id: (data as { id: number }).id, title: t, for_id: who };
    } else if (kind === 'mini') {
      const { data, error } = await supabase.from('task_minis').insert({ body: t, user_id: who, day }).select().single();
      if (error) { setBusy(false); return fail(error); }
      item = { kind, ref_id: (data as { id: number }).id, title: t, for_id: who };
      window.dispatchEvent(new Event('workspace:minis'));
    } else if (kind === 'reminder') {
      const at = new Date(when);
      if (Number.isNaN(at.getTime())) { setBusy(false); return fail(new Error('Pick a time for the reminder.')); }
      const { data, error } = await supabase.from('task_reminders').insert({ body: t, user_id: who, remind_at: at.toISOString() }).select().single();
      if (error) { setBusy(false); return fail(error); }
      item = { kind, ref_id: (data as { id: number }).id, title: t, for_id: who, remind_at: at.toISOString() };
      remindersChanged();
    }
    setBusy(false);
    refreshNotices();
    if (mode === 'make') toast(`Made a ${label} for ${name}`);
    onDone(item);
  }

  return (
    <>
      <div className="modal-backdrop" onClick={() => onDone(null)} />
      <form className="modal msg-work" role="dialog" aria-label={mode === 'send' ? `Send as a ${label}` : `Make it a ${label}`} onSubmit={submit}>
        <div className="modal-head">
          <strong>{mode === 'send' ? `Send as a ${label}` : `Make it a ${label}`}</strong>
          <button type="button" className="icon-btn" onClick={() => onDone(null)} aria-label="Close">✕</button>
        </div>
        {!choices.length ? (
          <div className="modal-body"><p className="muted">You can only give work to people in your team. Use <strong>Make it a {label}</strong> on a message to make one for yourself.</p></div>
        ) : (
          <div className="modal-body">
            <label className="field"><span>What</span>
              <input autoFocus value={title} maxLength={kind === 'task' ? 200 : 300} onChange={e => setTitle(e.target.value)} aria-label="What" />
            </label>
            <div className="fields two">
              <label className="field"><span>For</span>
                <select value={who} onChange={e => setWho(e.target.value)} aria-label="For">
                  {choices.map(p => <option key={p.id} value={p.id}>{p.id === me.id ? `${p.full_name} (me)` : p.full_name}</option>)}
                </select>
              </label>
              {kind === 'task' && (
                <label className="field"><span>Deadline</span>
                  <input type="date" value={due} min={td} onChange={e => setDue(e.target.value || td)} aria-label="Deadline" />
                </label>
              )}
              {kind === 'mini' && (
                <label className="field"><span>Day</span>
                  <input type="date" value={day} min={td} onChange={e => setDay(e.target.value || td)} aria-label="Day" />
                </label>
              )}
              {kind === 'reminder' && (
                <label className="field"><span>When</span>
                  <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} aria-label="When" />
                </label>
              )}
            </div>
            <div className="field-note">
              {kind === 'task' && (who === me.id ? 'It goes on your task list.' : `${name} finds it in their New tab and is alerted.`)}
              {kind === 'mini' && (who === me.id ? 'It goes on your Today list for that day.' : `It goes on ${name}'s Today list for that day (one alert).`)}
              {kind === 'reminder' && (who === me.id ? 'You are alerted at that time.' : `${name} is alerted at that time.`)}
              {mode === 'send' && ' The message shows a card everyone in this chat can see.'}
              {mode === 'make' && ' The message shows that it was made into work.'}
            </div>
          </div>
        )}
        <div className="modal-foot row gap">
          <button type="button" className="btn" onClick={() => onDone(null)}>Cancel</button>
          {choices.length > 0 && <button className="btn primary" disabled={busy || !title.trim()}>{mode === 'send' ? 'Send' : `Make ${label}`}</button>}
        </div>
      </form>
    </>
  );
}
