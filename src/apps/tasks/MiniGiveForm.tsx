import { useState, type FormEvent } from 'react';
import { supabase } from '../../supabase';
import { useTaskApp } from './store';
import { fmtDay, today } from '../../lib/dates';
import { firstName } from '../../lib/labels';

/** "+ New → Mini task": a quick one-line to-do for you, or for someone in your team, on a day's Today list. */
export default function MiniGiveForm({ onDone }: { onDone: () => void }) {
  const { me, team, person, fail, toast, refreshNotices } = useTaskApp();
  const [body, setBody] = useState('');
  const [who, setWho] = useState(me.id);
  const [day, setDay] = useState(today());
  const [busy, setBusy] = useState(false);
  const td = today();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('task_minis').insert({ body: body.trim(), user_id: who, day });
    setBusy(false);
    if (error) return fail(error);
    const name = firstName(person(who)?.full_name ?? '');
    toast(who === me.id ? (day === td ? 'Added to your Today' : `Added to your list for ${fmtDay(day)}`) : `Given to ${name} — it's on their Today list`);
    refreshNotices();
    window.dispatchEvent(new Event('workspace:minis'));
    onDone();
  }

  return (
    <form className="mini-give" onSubmit={submit}>
      <p className="muted small">A quick one-line to-do for a day — no deadline beyond the day, no sign-off. Unfinished ones wait the next morning under "Left from earlier".</p>
      <label className="field"><span>What</span>
        <input autoFocus maxLength={300} value={body} onChange={e => setBody(e.target.value)} placeholder="e.g. Call Sampath about the limits" aria-label="Mini task" />
      </label>
      <div className="fields two">
        <label className="field"><span>For</span>
          <select value={who} onChange={e => setWho(e.target.value)} aria-label="Mini task for">
            {team.map(p => <option key={p.id} value={p.id}>{p.id === me.id ? `${p.full_name} (me)` : p.full_name}</option>)}
          </select>
        </label>
        <label className="field"><span>Day</span>
          <input type="date" value={day} min={td} onChange={e => setDay(e.target.value || td)} aria-label="Mini task day" />
        </label>
      </div>
      {who !== me.id && <div className="field-note">{firstName(person(who)?.full_name ?? '')} gets one alert. You'll see it on your Today under "Given to others", ticked or not.</div>}
      <div className="row gap end create-row">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button className="btn primary" disabled={busy || !body.trim()}>{who === me.id ? 'Add mini task' : 'Give mini task'}</button>
      </div>
    </form>
  );
}
