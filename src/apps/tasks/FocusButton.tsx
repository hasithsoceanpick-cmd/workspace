import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import { go } from '../../lib/route';
import { dayBounds, fmtTime, today } from '../../lib/dates';
import { DEFAULTS, PHASE_NAME, PRESETS, clock, focus, leftOf, useFocus, type FocusSettings, type Phase } from './focus';

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}` : `${min}m`);

function Tomato({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="14" r="7.5" /><path d="M12 6.5V3.5" /><path d="M8.5 6.8 12 8.2l3.5-1.4" />
    </svg>
  );
}

/** A number box that saves when you leave it (or press Enter), kept within limits. */
function Num({ label, value, min, max, onSave }: { label: string; value: number; min: number; max: number; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < min || n > max) { setV(String(value)); return; }
    if (n !== value) onSave(n);
  };
  return (
    <label className="focus-num"><span>{label}</span>
      <input type="number" inputMode="numeric" min={min} max={max} value={v} onChange={e => setV(e.target.value)}
        onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} aria-label={label} />
    </label>
  );
}

/**
 * Top-bar focus timer (Pomodoro), for people with the Tasks app. Keeps running while you move around the platform;
 * chimes and pops up when a slot ends. Focus slots are recorded for My output.
 */
export default function FocusButton() {
  const { me, dept, fail } = usePlatform();
  const s = useFocus(me.id);
  const [open, setOpen] = useState(false);
  const [lengths, setLengths] = useState(false);
  const [, setNow] = useState(0);
  const [tasks, setTasks] = useState<{ id: number; title: string }[] | null>(null);
  const [todayMin, setTodayMin] = useState<{ n: number; min: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const running = s.status === 'running';

  // redraw every second while the clock runs
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  const loadToday = useCallback(async () => {
    const [from, to] = dayBounds(today());
    const { data } = await supabase.from('task_focus').select('minutes').eq('user_id', me.id).gte('started_at', from).lt('started_at', to);
    const rows = (data ?? []) as { minutes: number }[];
    setTodayMin({ n: rows.length, min: rows.reduce((a, r) => a + r.minutes, 0) });
  }, [me.id]);

  // my open tasks, and ones I'm helping on, to pick from
  useEffect(() => {
    if (!open || !dept) return;
    loadToday();
    (async () => {
      const [own, help] = await Promise.all([
        supabase.from('tasks').select('id,title,due_date').eq('department_id', dept.id).eq('assignee_id', me.id)
          .in('status', ['todo', 'doing', 'waiting']).order('due_date').limit(150),
        supabase.from('task_helpers').select('task_id').eq('user_id', me.id),
      ]);
      if (own.error) return fail(own.error);
      let list = (own.data ?? []) as { id: number; title: string }[];
      const ids = ((help.data ?? []) as { task_id: number }[]).map(h => h.task_id).filter(id => !list.some(t => t.id === id));
      if (ids.length) {
        const { data } = await supabase.from('tasks').select('id,title,due_date').in('id', ids.slice(0, 100))
          .in('status', ['todo', 'doing', 'waiting']).order('due_date');
        list = [...list, ...((data ?? []) as { id: number; title: string }[])];
      }
      setTasks(list);
    })();
  }, [open, dept, me.id, fail, loadToday]);
  useEffect(() => {
    const again = () => loadToday();
    window.addEventListener('workspace:focus', again);
    return () => window.removeEventListener('workspace:focus', again);
  }, [loadToday]);

  const set = (p: Partial<FocusSettings>) => focus.settings({ ...s.settings, ...p });
  const left = leftOf(s);
  const busy = s.status !== 'idle';
  const isBreak = s.phase !== 'focus';
  const round = Math.min(s.done + (s.phase === 'focus' ? 1 : 0), s.settings.rounds) || 1;
  const e = s.ended;

  return (
    <div className="focus-btn" ref={ref}>
      <button className={`icon-btn ${open ? 'on' : ''} ${busy ? `focus-live ${isBreak ? 'brk' : 'foc'} ${s.status}` : ''}`}
        onClick={() => setOpen(o => !o)} title="Focus timer" aria-label={busy ? `Focus timer: ${PHASE_NAME[s.phase]} ${clock(left)} left` : 'Focus timer'}>
        <Tomato size={busy ? 16 : 20} />
        {busy && <span className="focus-clock">{s.status === 'paused' ? '❚❚ ' : ''}{clock(left)}</span>}
      </button>

      {open && (
        <div className="popover focus-pop" role="dialog" aria-label="Focus timer">
          <div className="pop-head">
            <strong>Focus timer</strong>
            <button className={`link ${lengths ? 'on' : ''}`} onClick={() => setLengths(l => !l)}>{lengths ? 'Done' : 'Lengths'}</button>
          </div>
          <div className="pop-body">
            {lengths ? (
              <div className="focus-lengths">
                <div className="focus-presets">
                  {PRESETS.map(p => (
                    <button key={p.label} className={`chip-btn ${p.s.focus_min === s.settings.focus_min && p.s.short_min === s.settings.short_min && p.s.long_min === s.settings.long_min ? 'on' : ''}`}
                      onClick={() => set(p.s)}>{p.label}</button>
                  ))}
                </div>
                <div className="focus-nums">
                  <Num label="Focus (min)" value={s.settings.focus_min} min={1} max={180} onSave={n => set({ focus_min: n })} />
                  <Num label="Short break (min)" value={s.settings.short_min} min={1} max={60} onSave={n => set({ short_min: n })} />
                  <Num label="Long break (min)" value={s.settings.long_min} min={1} max={90} onSave={n => set({ long_min: n })} />
                  <Num label="Long break after (focus slots)" value={s.settings.rounds} min={1} max={12} onSave={n => set({ rounds: n })} />
                </div>
                <label className="check-label"><input type="checkbox" checked={s.settings.sound} onChange={ev => set({ sound: ev.target.checked })} /> Chime when a slot ends</label>
                <div className="muted tiny">Saved for you on every device. A slot that's already running keeps its length.
                  {JSON.stringify(s.settings) !== JSON.stringify(DEFAULTS) && <> <button className="link" onClick={() => set(DEFAULTS)}>Back to 25 / 5 / 15 × 4</button></>}
                </div>
              </div>
            ) : (
              <>
                <div className="seg focus-phases" role="tablist">
                  {(['focus', 'short', 'long'] as Phase[]).map(p => (
                    <button key={p} role="tab" aria-selected={s.phase === p} className={`seg-btn ${s.phase === p ? 'on' : ''}`}
                      disabled={busy && s.phase !== p} onClick={() => focus.choose(p)}>{PHASE_NAME[p]}</button>
                  ))}
                </div>
                <div className={`focus-big ${isBreak ? 'brk' : 'foc'}`}>{clock(left)}</div>
                <div className="focus-sub muted small">
                  {isBreak ? (s.phase === 'long' ? 'Long break — step away properly' : 'Short break') : `Focus ${round} of ${s.settings.rounds}`}
                  {!isBreak && s.taskTitle && <> · {s.taskTitle}</>}
                </div>
                {!isBreak && (
                  <label className="focus-task">
                    <span className="muted tiny">Working on</span>
                    <select value={s.taskId ?? ''} aria-label="Working on"
                      onChange={ev => { const id = Number(ev.target.value) || null; focus.setTask(id, tasks?.find(t => t.id === id)?.title ?? ''); }}>
                      <option value="">No particular task</option>
                      {s.taskId && !tasks?.some(t => t.id === s.taskId) && <option value={s.taskId}>{s.taskTitle}</option>}
                      {(tasks ?? []).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                    </select>
                  </label>
                )}
                <div className="focus-acts">
                  {s.status === 'idle' && <button className="btn primary" onClick={() => focus.start()}>▶ Start {isBreak ? 'break' : 'focus'}</button>}
                  {s.status === 'running' && <button className="btn" onClick={() => focus.pause()}>❚❚ Pause</button>}
                  {s.status === 'paused' && <button className="btn primary" onClick={() => focus.resume()}>▶ Resume</button>}
                  {busy && <button className="btn" onClick={() => focus.stop()} title={isBreak ? 'End the break' : 'Stop — minutes done still count'}>■ Stop</button>}
                  <button className="btn" onClick={() => focus.skip()} title={isBreak ? 'Skip the break' : 'Go to the break now'}>⏭ {isBreak ? 'Skip break' : 'Break now'}</button>
                </div>
                <div className="focus-today">
                  <span className="muted small">Today: {todayMin === null ? '…' : todayMin.n === 0 ? 'no focus time yet' : `${todayMin.n} focus ${todayMin.n === 1 ? 'session' : 'sessions'} · ${hm(todayMin.min)}`}</span>
                  <button className="link small" onClick={() => { setOpen(false); go('tasks', 'output'); }}>My output</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {e && (
        <div className={`focus-alert ${e.phase === 'focus' ? 'foc' : 'brk'}`} role="alertdialog" aria-label={e.phase === 'focus' ? 'Focus done' : 'Break over'}>
          <div className="focus-alert-text">
            {e.phase === 'focus' ? (
              <>
                <strong>🍅 Focus done — {hm(e.minutes)}{e.taskTitle ? ` on “${e.taskTitle}”` : ''}</strong>
                <span>Time for a {e.next === 'long' ? `long break (${s.settings.long_min} min)` : `${s.settings.short_min}-minute break`}.{e.away ? ` It ended at ${fmtTime(new Date(e.at).toISOString())} while you were away.` : ''}</span>
              </>
            ) : (
              <>
                <strong>☕ Break's over</strong>
                <span>Ready for the next {s.settings.focus_min}-minute focus?{e.away ? ` It ended at ${fmtTime(new Date(e.at).toISOString())}.` : ''}</span>
              </>
            )}
          </div>
          <div className="focus-alert-acts">
            {e.phase === 'focus' ? (
              <>
                <button className="btn primary sm" onClick={() => focus.start(e.next)}>Start break</button>
                <button className="btn sm" onClick={() => focus.start('focus')}>Skip break</button>
              </>
            ) : <button className="btn primary sm" onClick={() => focus.start('focus')}>Start focus</button>}
            <button className="btn sm" onClick={() => focus.dismiss()}>{e.phase === 'focus' ? 'Later' : 'Not now'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
