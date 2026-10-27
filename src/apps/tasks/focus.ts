import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '../../supabase';

/**
 * The focus timer (Pomodoro): focus → short break → focus … → long break after N focus slots.
 * The running timer lives in this browser (localStorage, shared by open tabs); each focus slot is recorded in
 * task_focus when it ends — finished, or stopped / skipped after at least a minute — for My output.
 * A slot that ended while the app was closed is recorded when it's next opened.
 */
export type Phase = 'focus' | 'short' | 'long';
export interface FocusSettings { focus_min: number; short_min: number; long_min: number; rounds: number; sound: boolean }
export const DEFAULTS: FocusSettings = { focus_min: 25, short_min: 5, long_min: 15, rounds: 4, sound: true };
export const PRESETS: { label: string; s: Pick<FocusSettings, 'focus_min' | 'short_min' | 'long_min'> }[] = [
  { label: '25 / 5', s: { focus_min: 25, short_min: 5, long_min: 15 } },
  { label: '50 / 10', s: { focus_min: 50, short_min: 10, long_min: 20 } },
  { label: '90 / 20', s: { focus_min: 90, short_min: 20, long_min: 30 } },
];
export const PHASE_NAME: Record<Phase, string> = { focus: 'Focus', short: 'Short break', long: 'Long break' };

export interface Ended { phase: Phase; next: Phase; minutes: number; at: number; away: boolean; taskTitle: string }
export interface FocusState {
  phase: Phase;
  status: 'idle' | 'running' | 'paused';
  /** running: when the slot ends (ms) */
  endsAt: number | null;
  /** idle / paused: time left (ms) */
  leftMs: number;
  /** focus: when this slot first started — its record's key */
  startedAt: number | null;
  /** focus: time focused before the current run (pauses don't count) */
  focusedMs: number;
  /** running: since when */
  runFrom: number | null;
  /** focus slots finished since the last long break */
  done: number;
  plannedMin: number;
  taskId: number | null;
  taskTitle: string;
  settings: FocusSettings;
  /** a slot just ended: the pop-up asks what next */
  ended: Ended | null;
}

const lenOf = (s: FocusSettings, p: Phase) => (p === 'focus' ? s.focus_min : p === 'short' ? s.short_min : s.long_min);
const fresh = (settings: FocusSettings): FocusState => ({
  phase: 'focus', status: 'idle', endsAt: null, leftMs: settings.focus_min * 60_000, startedAt: null, focusedMs: 0,
  runFrom: null, done: 0, plannedMin: settings.focus_min, taskId: null, taskTitle: '', settings, ended: null,
});

let uid: string | null = null;
let state: FocusState = fresh(DEFAULTS);
const subs = new Set<() => void>();
const key = () => `workspace.focus.v1.${uid}`;
const emit = () => subs.forEach(f => f());

function save(next: FocusState) {
  state = next;
  try { localStorage.setItem(key(), JSON.stringify(next)); } catch { /* private window: this tab only */ }
  emit();
}
function readStored(): FocusState | null {
  try {
    const raw = localStorage.getItem(key());
    return raw ? { ...fresh(DEFAULTS), ...(JSON.parse(raw) as FocusState) } : null;
  } catch { return null; }
}

// ---------- sound: a short chime made in the browser (no file to download) ----------
let audio: AudioContext | null = null;
function unlockSound() {
  try {
    audio ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { /* no sound on this device */ }
}
export function chime() {
  try {
    unlockSound();
    if (!audio) return;
    const t0 = audio.currentTime + 0.02;
    [0, 0.28, 0.56].forEach((d, i) => {
      const o = audio!.createOscillator();
      const g = audio!.createGain();
      o.type = 'sine';
      o.frequency.value = i === 2 ? 1046 : 880;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.24);
      o.connect(g).connect(audio!.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.26);
    });
  } catch { /* ignore */ }
}

// ---------- recording ----------
interface Pending { task_id: number | null; started_at: string; ended_at: string; planned_min: number; minutes: number; completed: boolean }
const pendingKey = () => `workspace.focus.pending.${uid}`;
function readPending(): Pending[] {
  try { return JSON.parse(localStorage.getItem(pendingKey()) ?? '[]') as Pending[]; } catch { return []; }
}
function writePending(list: Pending[]) {
  try { localStorage.setItem(pendingKey(), JSON.stringify(list.slice(-20))); } catch { /* ignore */ }
}
async function send(p: Pending): Promise<boolean> {
  const { error } = await supabase.from('task_focus').insert(p);
  if (!error || /duplicate|unique/i.test(error.message)) return true;
  // the task may have gone or become hidden: keep the time without it
  if (p.task_id && /can see|task/i.test(error.message)) return send({ ...p, task_id: null });
  return !/fetch|network/i.test(error.message);   // only keep it to try again if we were offline
}
async function record(p: Pending) {
  if (p.minutes < 1) return;
  const ok = await send(p);
  if (!ok) writePending([...readPending(), p]);
  window.dispatchEvent(new Event('workspace:focus'));
}
async function flushPending() {
  const list = readPending();
  if (!list.length) return;
  writePending([]);
  for (const p of list) if (!(await send(p))) writePending([...readPending(), p]);
  window.dispatchEvent(new Event('workspace:focus'));
}

const focusedMinutes = (s: FocusState, now: number) =>
  Math.floor((s.focusedMs + (s.status === 'running' && s.runFrom ? now - s.runFrom : 0)) / 60_000);

function recordFocus(s: FocusState, now: number, completed: boolean) {
  if (s.phase !== 'focus' || !s.startedAt) return;
  const minutes = completed ? s.plannedMin : focusedMinutes(s, now);
  record({
    task_id: s.taskId, started_at: new Date(s.startedAt).toISOString(), ended_at: new Date(Math.min(now, Date.now())).toISOString(),
    planned_min: s.plannedMin, minutes: Math.min(minutes, s.plannedMin), completed,
  });
}

function idleAt(s: FocusState, phase: Phase, extra: Partial<FocusState> = {}): FocusState {
  const min = lenOf(s.settings, phase);
  return { ...s, phase, status: 'idle', endsAt: null, runFrom: null, startedAt: null, focusedMs: 0, leftMs: min * 60_000, plannedMin: min, ...extra };
}

// ---------- actions ----------
export const focus = {
  start(phase?: Phase) {
    unlockSound();
    const s = readStored() ?? state;
    const p = phase ?? s.phase;
    const min = lenOf(s.settings, p);
    const now = Date.now();
    save({ ...s, phase: p, status: 'running', endsAt: now + min * 60_000, runFrom: now, startedAt: p === 'focus' ? now : null,
      focusedMs: 0, plannedMin: min, leftMs: min * 60_000, ended: null });
  },
  pause() {
    const s = readStored() ?? state;
    if (s.status !== 'running' || !s.endsAt) return;
    const now = Date.now();
    save({ ...s, status: 'paused', leftMs: Math.max(0, s.endsAt - now), focusedMs: s.focusedMs + (s.runFrom ? now - s.runFrom : 0), endsAt: null, runFrom: null });
  },
  resume() {
    unlockSound();
    const s = readStored() ?? state;
    if (s.status !== 'paused') return;
    const now = Date.now();
    save({ ...s, status: 'running', endsAt: now + s.leftMs, runFrom: now });
  },
  /** stop: an unfinished focus slot still counts the minutes done (a minute or more) */
  stop() {
    const s = readStored() ?? state;
    if (s.status !== 'idle') recordFocus(s, Date.now(), false);
    save(idleAt(s, 'focus', { ended: null }));
  },
  /** skip to what comes next: focus → break (minutes done still count), break → focus */
  skip() {
    const s = readStored() ?? state;
    if (s.status !== 'idle') recordFocus(s, Date.now(), false);
    const next: Phase = s.phase === 'focus' ? ((s.done + 1) % s.settings.rounds === 0 ? 'long' : 'short') : 'focus';
    save(idleAt(s, next, { ended: null, done: s.phase === 'long' ? 0 : s.done }));
  },
  choose(phase: Phase) {
    const s = readStored() ?? state;
    if (s.status !== 'idle') return;
    save(idleAt(s, phase));
  },
  setTask(id: number | null, title: string) {
    const s = readStored() ?? state;
    save({ ...s, taskId: id, taskTitle: title });
  },
  dismiss() {
    const s = readStored() ?? state;
    save({ ...s, ended: null });
  },
  settings(next: FocusSettings, persist = true) {
    const s = readStored() ?? state;
    const upd = { ...s, settings: next };
    save(s.status === 'idle' ? idleAt(upd, s.phase, { ended: s.ended }) : upd);
    if (persist) {
      supabase.rpc('task_focus_save', { p_focus: next.focus_min, p_short: next.short_min, p_long: next.long_min, p_rounds: next.rounds, p_sound: next.sound })
        .then(({ error }) => { if (error) console.warn('focus settings not saved', error.message); });
    }
  },
};

/** Called every second (and when the app opens): ends a slot whose time is up. */
function tick() {
  const s = readStored() ?? state;
  if (s !== state && JSON.stringify(s) !== JSON.stringify(state)) { state = s; emit(); }
  if (s.status !== 'running' || !s.endsAt) return;
  const now = Date.now();
  if (now < s.endsAt) return;
  const away = now - s.endsAt > 5_000;
  let next: Phase;
  let done = s.done;
  if (s.phase === 'focus') {
    recordFocus({ ...s, focusedMs: s.focusedMs }, s.endsAt, true);
    done = s.done + 1;
    next = done % s.settings.rounds === 0 ? 'long' : 'short';
  } else {
    next = 'focus';
    if (s.phase === 'long') done = 0;
  }
  const ended: Ended = { phase: s.phase, next, minutes: s.plannedMin, at: s.endsAt, away, taskTitle: s.taskTitle };
  save(idleAt(s, next, { done, ended }));
  if (s.settings.sound && !away) chime();
}

/** the time left in the current slot (ms) */
export const leftOf = (s: FocusState, now = Date.now()) => (s.status === 'running' && s.endsAt ? Math.max(0, s.endsAt - now) : s.leftMs);
export const clock = (ms: number) => {
  const t = Math.ceil(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snap = () => state;

/** The timer for the signed-in person. Keeps time, shares state with other tabs, shows the countdown in the tab title. */
export function useFocus(userId: string): FocusState {
  if (uid !== userId) {
    uid = userId;
    state = readStored() ?? fresh(DEFAULTS);
  }
  const s = useSyncExternalStore(subscribe, snap);

  useEffect(() => {
    // lengths saved in the database follow the person to every device
    supabase.from('task_focus_settings').select('*').eq('user_id', userId).maybeSingle().then(({ data }) => {
      if (!data) return;
      const d = data as FocusSettings;
      const cur = (readStored() ?? state).settings;
      const next = { focus_min: d.focus_min, short_min: d.short_min, long_min: d.long_min, rounds: d.rounds, sound: d.sound };
      if (JSON.stringify(cur) !== JSON.stringify(next)) focus.settings(next, false);
    });
    flushPending();
    tick();
    const t = setInterval(tick, 1000);
    const other = (e: StorageEvent) => { if (e.key === key()) { const v = readStored(); if (v) { state = v; emit(); } } };
    window.addEventListener('storage', other);
    return () => { clearInterval(t); window.removeEventListener('storage', other); };
  }, [userId]);

  // countdown in the browser tab's title while a slot runs
  useEffect(() => {
    const strip = (t: string) => t.replace(/^[▶❚]+ \d+:\d\d (Focus|Break) · /, '');
    if (s.status === 'idle') { document.title = strip(document.title); return; }
    const label = s.phase === 'focus' ? 'Focus' : 'Break';
    document.title = `${s.status === 'paused' ? '❚❚' : '▶'} ${clock(leftOf(s))} ${label} · ${strip(document.title)}`;
  });
  return s;
}
