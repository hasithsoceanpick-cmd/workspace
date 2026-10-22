import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import type { WorkCardProps } from '../../platform/slots';
import { go } from '../../lib/route';
import { fmtDue, today } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import { finished, statusLabel } from './labels';
import { fmtWhen, presets, remindersChanged } from './reminders';

type Live =
  | { kind: 'task'; id: number; title: string; status: string; due_date: string; assignee_id: string }
  | { kind: 'mini'; id: number; body: string; day: string; done_at: string | null; user_id: string }
  | { kind: 'reminder'; id: number; body: string; remind_at: string; done_at: string | null; user_id: string };

// what each card last found (a conversation redraws often; the work rarely changes that fast)
const cache = new Map<string, { at: number; v: Live | null }>();

async function fetchLive(kind: string, id: number): Promise<Live | null> {
  const key = `${kind}:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 20_000) return hit.v;
  let v: Live | null = null;
  if (kind === 'task') {
    const { data } = await supabase.from('tasks').select('id,title,status,due_date,assignee_id').eq('id', id).maybeSingle();
    if (data) v = { kind, ...(data as Omit<Extract<Live, { kind: 'task' }>, 'kind'>) };
  } else if (kind === 'mini') {
    const { data } = await supabase.from('task_minis').select('id,body,day,done_at,user_id').eq('id', id).maybeSingle();
    if (data) v = { kind, ...(data as Omit<Extract<Live, { kind: 'mini' }>, 'kind'>) };
  } else {
    const { data } = await supabase.from('task_reminders').select('id,body,remind_at,done_at,user_id').eq('id', id).maybeSingle();
    if (data) v = { kind: 'reminder', ...(data as Omit<Extract<Live, { kind: 'reminder' }>, 'kind'>) };
  }
  cache.set(key, { at: Date.now(), v });
  return v;
}

/** A task, mini task or reminder inside a message (Messages app). Opens it if you may; otherwise shows what it is. */
export default function MessageCard({ item }: WorkCardProps) {
  const { me, person, toast, fail } = usePlatform();
  const [live, setLive] = useState<Live | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let on = true;
    fetchLive(item.kind, item.ref_id).then(v => { if (on) setLive(v); });
    return () => { on = false; };
  }, [item.kind, item.ref_id]);

  const forId = live ? (live.kind === 'task' ? live.assignee_id : live.user_id) : item.for_id;
  const forName = forId === me.id ? 'you' : firstName(person(forId)?.full_name ?? '');
  const title = live ? (live.kind === 'task' ? live.title : live.body) : item.title;

  async function tickMini() {
    if (!live || live.kind !== 'mini') return;
    setBusy(true);
    const done_at = live.done_at ? null : new Date().toISOString();
    const { error } = await supabase.from('task_minis').update({ done_at }).eq('id', live.id);
    setBusy(false);
    if (error) return fail(error);
    const v = { ...live, done_at };
    cache.set(`mini:${live.id}`, { at: Date.now(), v });
    setLive(v);
    window.dispatchEvent(new Event('workspace:minis'));
  }

  async function remindMeToo() {
    const soon = item.remind_at && new Date(item.remind_at).getTime() > Date.now() + 60_000;
    const at = soon ? new Date(item.remind_at!) : presets().find(p => p.label === 'Tomorrow 9 am')!.at;
    setBusy(true);
    const { error } = await supabase.from('task_reminders').insert({ body: item.title, remind_at: at.toISOString() });
    setBusy(false);
    if (error) return fail(error);
    remindersChanged();
    toast(`Reminder set for ${fmtWhen(at.toISOString())}`);
  }

  if (item.kind === 'task') {
    const open = () => (live ? go('tasks', '', { task: String(item.ref_id) }) : toast('Only people working on this task can open it.', 'error'));
    const t = live?.kind === 'task' ? live : null;
    const late = t && !finished(t) && t.due_date < today();
    return (
      <button className={`wcard k-task ${t ? '' : 'locked'}`} onClick={open} title={t ? 'Open the task' : "You can't open this task"}>
        <span className="wcard-icon" aria-hidden>📋</span>
        <span className="wcard-main">
          <span className="wcard-kind">
            Task{forId ? ` for ${forName}` : ''}{t ? ` · due ${fmtDue(t.due_date)}` : ''}
          </span>
          <span className="wcard-title">{title || 'Untitled'}</span>
        </span>
        {t ? <span className={`pill s-${t.status} ${late ? 'late' : ''}`}>{late ? 'Late' : statusLabel(t.status)}</span>
          : live === null && <span className="muted tiny">🔒</span>}
      </button>
    );
  }

  if (item.kind === 'mini') {
    const m = live?.kind === 'mini' ? live : null;
    const mineToTick = m && m.user_id === me.id;
    return (
      <div className={`wcard k-mini ${m?.done_at ? 'done' : ''}`}>
        {mineToTick ? (
          <button className={`check ${m.done_at ? 'on' : ''}`} disabled={busy} onClick={tickMini} aria-label={m.done_at ? `Not done: ${title}` : `Done: ${title}`}>
            <svg viewBox="0 0 16 16" width="11" height="11"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        ) : <span className="wcard-icon" aria-hidden>☑️</span>}
        <button className="wcard-main" onClick={() => (m && m.user_id === me.id ? go('tasks', '', {}) : undefined)} disabled={!mineToTick}>
          <span className="wcard-kind">Mini task{forId ? ` for ${forName}` : ''}{m ? ` · ${fmtDue(m.day)}` : ''}{m?.done_at ? ' · done ✓' : ''}</span>
          <span className="wcard-title">{title}</span>
        </button>
      </div>
    );
  }

  // reminder
  const r = live?.kind === 'reminder' ? live : null;
  const when = r?.remind_at ?? item.remind_at;
  const forMe = forId === me.id;
  return (
    <div className="wcard k-reminder">
      <span className="wcard-icon" aria-hidden>⏰</span>
      <button className="wcard-main" onClick={() => (r ? go('tasks', 'reminders') : undefined)} disabled={!r}>
        <span className="wcard-kind">Reminder{forId ? ` for ${forName}` : ''}{when ? ` · ${fmtWhen(when)}` : ''}{r?.done_at ? ' · done' : ''}</span>
        <span className="wcard-title">{title}</span>
      </button>
      {!forMe && live !== undefined && (
        <button className="btn sm" disabled={busy} onClick={remindMeToo} title="Get the same reminder yourself">Remind me too</button>
      )}
    </div>
  );
}
