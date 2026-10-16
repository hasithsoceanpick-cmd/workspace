import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import { forgetDeviceOnSignOut } from '../../platform/push';
import { addDays, fmtLong, today } from '../../lib/dates';

type Owed = { task_id: number; title: string; day: string };

/**
 * The morning catch-up. A task marked "Daily update needed" wants a short update from its owner every weekday.
 * If yesterday's (the last weekday's) is missing, the whole app waits behind this screen until it's written.
 * Shown through the platform's GATES slot, so it covers every app. There is no skip: "On leave" is an update too.
 */
export default function DailyUpdateGate() {
  const { fail, toast } = usePlatform();
  const [owed, setOwed] = useState<Owed[]>([]);
  const [text, setText] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const checkedOn = useRef('');

  const check = useCallback(async () => {
    checkedOn.current = today();
    const { data, error } = await supabase.rpc('tasks_updates_owed');
    if (error) return;                 // never lock anyone out because a check failed
    setOwed((data ?? []) as Owed[]);
  }, []);

  useEffect(() => {
    check();
    // left open overnight: check again when the day has changed
    const again = () => { if (document.visibilityState === 'visible' && checkedOn.current !== today()) check(); };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    const timer = setInterval(again, 5 * 60_000);
    return () => { window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', again); clearInterval(timer); };
  }, [check]);

  if (owed.length === 0) return null;
  const day = owed[0].day;
  const ready = owed.every(o => (text[o.task_id] ?? '').trim());

  async function save() {
    setBusy(true);
    for (const o of owed) {
      const body = (text[o.task_id] ?? '').trim();
      const { error } = await supabase.from('task_comments').insert({ task_id: o.task_id, body, daily_for: o.day });
      if (error) { setBusy(false); fail(error); return; }
    }
    setBusy(false);
    toast(owed.length === 1 ? 'Update saved — have a good day' : 'Updates saved — have a good day');
    setText({});
    await check();
  }

  async function signOut() {
    await forgetDeviceOnSignOut();
    await supabase.auth.signOut();
  }

  return (
    <div className="gate" role="dialog" aria-modal="true" aria-label="Daily updates needed">
      <div className="gate-card">
        <h2>Before you start: {addDays(today(), -1) === day ? "yesterday's" : `${fmtLong(day).split(',')[0]}'s`} updates</h2>
        <p className="muted">
          {owed.length === 1 ? 'This task needs' : 'These tasks need'} a daily update for <strong>{fmtLong(day)}</strong>.
          Write {owed.length === 1 ? 'it' : 'them'} to open the app. If you were away, say so (for example “On leave”).
        </p>
        {owed.map(o => (
          <label key={o.task_id} className="gate-item">
            <span>{o.title}</span>
            <textarea rows={2} value={text[o.task_id] ?? ''} placeholder="What was done, what's next, anything holding it up?"
              onChange={e => setText(t => ({ ...t, [o.task_id]: e.target.value }))} aria-label={`Update for ${o.title}`} />
          </label>
        ))}
        <div className="gate-foot">
          <button className="link" onClick={signOut}>Sign out</button>
          <button className="btn primary" disabled={!ready || busy} onClick={save}>{busy ? 'Saving…' : 'Save and continue'}</button>
        </div>
      </div>
    </div>
  );
}
