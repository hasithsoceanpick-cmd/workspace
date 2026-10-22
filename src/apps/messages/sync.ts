import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '../../supabase';
import type { ThreadInfo } from './types';

/**
 * The conversation list with unread counts, shared by the chat button and the Messages page.
 * One timer for both: every 20 seconds normally, every 5 while Messages is open.
 * Each sync also tells the database this device has received everything (the grey double tick).
 */
let state: { dept: string | null; threads: ThreadInfo[] | null } = { dept: null, threads: null };
const subs = new Set<() => void>();
const demands = new Map<number, number>();
let seq = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let current: string | null = null;
let inFlight = false;

export async function syncNow(dept = current) {
  if (!dept || inFlight) return;
  inFlight = true;
  try {
    const { data, error } = await supabase.rpc('msg_sync', { p_dept: dept });
    if (!error && dept === current) {
      state = { dept, threads: (data ?? []) as ThreadInfo[] };
      subs.forEach(f => f());
    }
  } finally {
    inFlight = false;
  }
}

function reschedule() {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (!demands.size) return;
  const ms = Math.min(...demands.values());
  timer = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, ms);
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snapshot = () => state;

export function useThreads(dept: string | undefined, everyMs: number): ThreadInfo[] | null {
  const s = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (!dept) return;
    if (current !== dept) { current = dept; state = { dept, threads: null }; subs.forEach(f => f()); }
    const id = ++seq;
    demands.set(id, everyMs);
    reschedule();
    syncNow(dept);
    const again = () => syncNow(dept);
    window.addEventListener('focus', again);
    window.addEventListener('workspace:pushed', again);   // a phone alert arrived while the app is open
    return () => {
      demands.delete(id);
      reschedule();
      window.removeEventListener('focus', again);
      window.removeEventListener('workspace:pushed', again);
    };
  }, [dept, everyMs]);
  return s.dept === dept ? s.threads : null;
}
