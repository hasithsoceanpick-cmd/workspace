import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { supabase } from '../../../supabase';
import { useTaskApp } from '../store';
import { setParams, type Params } from '../../../lib/route';
import { addDays, dayBounds, daysBetween, fmtDay, fmtLong, fmtTime, isWeekday, localDayOf, today } from '../../../lib/dates';
import { firstName } from '../../../lib/labels';
import { finished, finishedAt } from '../labels';
import AssignedBy from '../AssignedBy';
import type { MiniTask, Task, TaskComment, WorkLog } from '../types';

type Step = { id: number; task_id: number; body: string; done_at: string };

/**
 * My output: what someone did on one day — tasks finished, daily updates, ticked mini tasks and checklist steps,
 * and work done outside the app (free-text lines, today only). Managers see their department, senior executives
 * their members (the database decides: task_sees_work_of).
 */
export default function OutputPage({ params }: { params: Params }) {
  const { me, dept, isLead, team, inDept, tasks, person, openTask, fail, updateDue } = useTaskApp();
  const td = today();
  const d = params.d && params.d <= td ? params.d : td;
  const who = isLead && params.who && team.some(p => p.id === params.who) ? params.who : inDept ? me.id : team[0]?.id ?? me.id;
  const mine = who === me.id;
  const owner = person(who);

  const [updates, setUpdates] = useState<TaskComment[] | null>(null);
  const [minis, setMinis] = useState<MiniTask[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [lines, setLines] = useState<WorkLog[]>([]);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [from, to] = dayBounds(d);
    const [u, m, s, w] = await Promise.all([
      supabase.from('task_comments').select('*').eq('author_id', who).eq('daily_for', d).order('created_at'),
      supabase.from('task_minis').select('*').eq('user_id', who).eq('department_id', dept!.id)
        .gte('done_at', from).lt('done_at', to).order('done_at'),
      supabase.from('task_checklist').select('id,task_id,body,done_at').eq('department_id', dept!.id).eq('done_by', who)
        .gte('done_at', from).lt('done_at', to).order('done_at'),
      supabase.from('task_work_log').select('*').eq('user_id', who).eq('department_id', dept!.id).eq('day', d).order('created_at').order('id'),
    ]);
    const err = u.error ?? m.error ?? s.error ?? w.error;
    if (err) return fail(err);
    setUpdates((u.data ?? []) as TaskComment[]);
    setMinis((m.data ?? []) as MiniTask[]);
    setSteps((s.data ?? []) as Step[]);
    setLines((w.data ?? []) as WorkLog[]);
  }, [d, who, dept, fail]);
  useEffect(() => { setUpdates(null); load(); }, [load, tasks]);

  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const done = useMemo(() => tasks
    .filter(t => t.assignee_id === who && finished(t) && finishedAt(t) && localDayOf(finishedAt(t)!) === d)
    .sort((a, b) => finishedAt(a)!.localeCompare(finishedAt(b)!)), [tasks, who, d]);
  const waiting = mine && d === td ? tasks.filter(t => t.assignee_id === me.id && updateDue(t)) : [];

  const canWrite = mine && d === td && inDept;
  async function add() {
    const body = text.trim();
    if (!body) return;
    setText('');
    const { data, error } = await supabase.from('task_work_log').insert({ body }).select().single();
    if (error) { setText(body); return fail(error); }
    setLines(ls => [...ls, data as WorkLog]);
  }
  async function rename(l: WorkLog, body: string) {
    setEditing(null);
    const b = body.trim();
    if (!b || b === l.body) return;
    setLines(ls => ls.map(x => (x.id === l.id ? { ...x, body: b } : x)));
    const { error } = await supabase.from('task_work_log').update({ body: b }).eq('id', l.id);
    if (error) { fail(error); load(); }
  }
  async function remove(l: WorkLog) {
    setLines(ls => ls.filter(x => x.id !== l.id));
    const { error } = await supabase.from('task_work_log').delete().eq('id', l.id);
    if (error) { fail(error); load(); }
  }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };

  const titleOf = (id: number) => taskById.get(id)?.title ?? `Task #${id}`;
  const onTime = (t: Task) => {
    const late = daysBetween(t.due_date, d);
    return late > 0 ? <span className="danger">{late}d late</span> : t.due_date > d ? <span className="good">early</span> : <span className="good">on time</span>;
  };
  const total = done.length + (updates?.length ?? 0) + minis.length + steps.length + lines.length;
  const name = owner ? firstName(owner.full_name) : 'They';

  return (
    <div className="page output-page">
      <div className="page-head">
        <div>
          <h1>{mine ? 'My output' : `${owner?.full_name ?? 'Their'}'s output`}</h1>
          <div className="muted">
            {d === td ? `Today · ${fmtLong(d)}` : fmtLong(d)}
            {updates !== null && <> · {total === 0 ? 'nothing recorded' : `${total} item${total === 1 ? '' : 's'}`}</>}
          </div>
        </div>
        <div className="filters">
          {isLead && team.length > 1 && (
            <select value={who} onChange={e => setParams({ who: e.target.value === me.id ? '' : e.target.value })} aria-label="Whose output">
              {team.map(p => <option key={p.id} value={p.id}>{p.id === me.id ? 'My output' : p.full_name}</option>)}
            </select>
          )}
          <div className="cal-nav">
            <button className="icon-btn" onClick={() => setParams({ d: addDays(d, -1) })} aria-label="Previous day">‹</button>
            <input type="date" value={d} max={td} onChange={e => e.target.value && setParams({ d: e.target.value === td ? '' : e.target.value })} aria-label="Day" />
            <button className="icon-btn" disabled={d >= td} onClick={() => setParams({ d: addDays(d, 1) === td ? '' : addDays(d, 1) })} aria-label="Next day">›</button>
            {d !== td && <button className="btn sm" onClick={() => setParams({ d: '' })}>Today</button>}
          </div>
        </div>
      </div>

      {waiting.length > 0 && (
        <div className="out-waiting">
          <strong>Waiting for today's daily update</strong>
          <ul>
            {waiting.map(t => (
              <li key={t.id}>
                <span className="grow">{t.title}</span>
                <button className="btn sm" onClick={() => openTask(t.id)}>Write update</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="out-tiles">
        <div className="out-tile"><span className="n">{done.length}</span><span>tasks finished</span></div>
        <div className="out-tile"><span className="n">{updates?.length ?? 0}</span><span>daily updates</span></div>
        <div className="out-tile"><span className="n">{minis.length + steps.length}</span><span>mini tasks &amp; steps</span></div>
        <div className="out-tile"><span className="n">{lines.length}</span><span>other work</span></div>
      </div>

      <section className="out-section">
        <h2>Tasks finished</h2>
        {done.length === 0 ? <div className="muted small">None{d === td ? ' yet' : ''}.</div> : (
          <ul className="out-list">
            {done.map(t => (
              <li key={t.id}>
                <button className="out-row" onClick={() => openTask(t.id)}>
                  <span className="out-time">{fmtTime(finishedAt(t)!)}</span>
                  <span className="grow">
                    <AssignedBy t={t} />
                    <span className="out-title">{t.title}</span>
                  </span>
                  {t.status === 'review' && <span className="pill s-review">Waiting for sign-off</span>}
                  <span className="small">{onTime(t)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="out-section">
        <h2>Daily updates</h2>
        {updates === null ? <div className="muted small">Loading…</div> : updates.length === 0 ? <div className="muted small">None.</div> : (
          <ul className="out-list">
            {updates.map(u => (
              <li key={u.id}>
                <button className="out-row" onClick={() => openTask(u.task_id)}>
                  <span className="out-time">{fmtTime(u.created_at)}</span>
                  <span className="grow">
                    <span className="out-title">{titleOf(u.task_id)}</span>
                    <span className="out-note">“{u.body}”</span>
                  </span>
                  {localDayOf(u.created_at) > d && <span className="pill update-due" title={`Written ${fmtDay(localDayOf(u.created_at))}`}>written next morning</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="out-section">
        <h2>Mini tasks and steps ticked</h2>
        {minis.length + steps.length === 0 ? <div className="muted small">None.</div> : (
          <ul className="out-list">
            {[...minis.map(m => ({ k: `m${m.id}`, at: m.done_at!, text: m.body, sub: 'mini task', task: null as number | null })),
              ...steps.map(s => ({ k: `s${s.id}`, at: s.done_at, text: s.body, sub: `step in “${titleOf(s.task_id)}”`, task: s.task_id }))]
              .sort((a, b) => a.at.localeCompare(b.at))
              .map(x => (
                <li key={x.k}>
                  <div className={`out-row ${x.task ? 'link' : ''}`} onClick={() => x.task && openTask(x.task)}>
                    <span className="out-time">{fmtTime(x.at)}</span>
                    <span className="grow"><span className="out-title">{x.text}</span> <span className="muted tiny">{x.sub}</span></span>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="out-section">
        <h2>Other work</h2>
        <div className="muted tiny">Work that isn't a task in the app — emails, payments, calls…{canWrite ? ' Add today’s here.' : ''}</div>
        {lines.length === 0 && !canWrite && <div className="muted small">None.</div>}
        {lines.length > 0 && (
          <ul className="out-list">
            {lines.map(l => (
              <li key={l.id}>
                <div className="out-row">
                  <span className="out-time">{fmtTime(l.created_at)}</span>
                  {canWrite && editing === l.id ? (
                    <input className="mini-edit grow" autoFocus defaultValue={l.body} maxLength={500}
                      onBlur={e => rename(l, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} />
                  ) : (
                    <span className={`grow out-title ${canWrite ? 'editable' : ''}`} onClick={() => canWrite && setEditing(l.id)}>{l.body}</span>
                  )}
                  {canWrite && <button className="mini-act x" onClick={() => remove(l)} aria-label={`Delete ${l.body}`}>✕</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <input className="mini-add" placeholder="e.g. Processed 12 supplier payments (Enter)" value={text} maxLength={500}
            onChange={e => setText(e.target.value)} onKeyDown={onKey} aria-label="Add other work" />
        )}
        {mine && d < td && <div className="muted tiny">Earlier days can't be filled in afterwards.</div>}
      </section>

      {!mine && total === 0 && updates !== null && (
        <p className="hint">{name} has nothing recorded for {d === td ? 'today so far' : 'this day'}{isWeekday(d) ? '' : ' (a weekend)'}.</p>
      )}
    </div>
  );
}
