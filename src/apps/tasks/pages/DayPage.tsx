import { useEffect, useMemo, useState } from 'react';
import { useTaskApp } from '../store';
import { supabase } from '../../../supabase';
import { setParams, type Params } from '../../../lib/route';
import { addDays, dayBounds, fmtLong, fmtTime, today } from '../../../lib/dates';
import { describe } from '../activity';
import { useFeatures } from '../../../features/useFeatures';
import { firstName } from '../../../lib/labels';
import type { TaskActivity as Activity } from '../types';
import type { Profile } from '../../../platform/types';
import Avatar from '../../../platform/Avatar';

export default function DayPage({ params }: { params: Params }) {
  const { me, dept, team, tasks, profiles, person, openTask } = useTaskApp();
  const panels = useFeatures('tasks').filter(f => f.dayReview);
  const d = params.d || today();
  const td = today();
  const [acts, setActs] = useState<Activity[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const [from, to] = dayBounds(d);
    supabase.from('task_activity').select('*').eq('department_id', dept!.id)
      .gte('created_at', from).lt('created_at', to).order('created_at')
      .then(({ data }) => { if (!cancelled) setActs((data as Activity[]) ?? []); });
    return () => { cancelled = true; };
  }, [d, tasks, dept]); // re-check whenever task data refreshes

  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const teamIds = new Set(team.map(p => p.id));
  const nameOf = (id: string | null) => person(id)?.full_name ?? 'Someone';

  const byActor = useMemo(() => {
    const m = new Map<string, Activity[]>();
    for (const a of acts ?? []) {
      const k = a.actor_id ?? 'system';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    }
    return m;
  }, [acts]);

  const dueThatDay = tasks.filter(t => t.due_date === d && teamIds.has(t.assignee_id));
  const completed = new Set((acts ?? []).filter(a => a.kind === 'status' && a.new_value === 'done').map(a => a.task_id));
  const stillDone = [...completed].filter(id => taskById.get(id)?.status === 'done').length;
  const comments = (acts ?? []).filter(a => a.kind === 'comment').length;
  const otherUpdates = (acts ?? []).filter(a => a.kind !== 'comment' && !(a.kind === 'status' && a.new_value === 'done')).length;
  const dueDone = dueThatDay.filter(t => t.status === 'done').length;

  // people to show: my team first, then anyone else who touched visible tasks
  const people: Profile[] = [
    ...team,
    ...profiles.filter(p => !teamIds.has(p.id) && byActor.has(p.id)),
  ];
  const active = people.filter(p => byActor.has(p.id) || dueThatDay.some(t => t.assignee_id === p.id));
  const quiet = people.filter(p => !active.includes(p));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Day review</h1>
          <div className="muted">{fmtLong(d)}{d === td ? ' · today' : ''}</div>
        </div>
        <div className="cal-nav">
          <button className="icon-btn" onClick={() => setParams({ d: addDays(d, -1) })} aria-label="Previous day">‹</button>
          <input type="date" value={d} max={td} onChange={e => e.target.value && setParams({ d: e.target.value === td ? '' : e.target.value })} />
          <button className="icon-btn" onClick={() => setParams({ d: addDays(d, 1) === td ? '' : addDays(d, 1) })} disabled={d >= td} aria-label="Next day">›</button>
          {d !== td && <button className="btn sm" onClick={() => setParams({ d: '' })}>Today</button>}
        </div>
      </div>

      <div className="summary">
        <div className="sum-card"><div className="sum-num good">{stillDone}</div><div className="sum-label">completed</div></div>
        <div className="sum-card"><div className="sum-num">{otherUpdates}</div><div className="sum-label">other updates</div></div>
        <div className="sum-card"><div className="sum-num">{comments}</div><div className="sum-label">comments</div></div>
        <div className="sum-card">
          <div className={`sum-num ${dueThatDay.length && dueDone < dueThatDay.length && d < td ? 'danger' : ''}`}>
            {dueDone}<span className="muted">/{dueThatDay.length}</span>
          </div>
          <div className="sum-label">due {d === td ? 'today' : 'this day'} done</div>
        </div>
      </div>

      {acts === null ? <div className="empty">Loading…</div> : active.length === 0 ? (
        <div className="empty">No activity on this day.</div>
      ) : (
        <div className="day-grid">
          {active.map(p => {
            const list = byActor.get(p.id) ?? [];
            const due = dueThatDay.filter(t => t.assignee_id === p.id);
            const doneCount = list.filter(a => a.kind === 'status' && a.new_value === 'done').length;
            return (
              <section key={p.id} className="person-card">
                <header>
                  <Avatar p={p} size={30} />
                  <div className="grow">
                    <div className="strong">{p.id === me.id ? `${p.full_name} (me)` : p.full_name}</div>
                    <div className="muted tiny">
                      {doneCount} completed · {list.length} action{list.length === 1 ? '' : 's'}
                    </div>
                  </div>
                </header>

                {list.length > 0 ? (
                  <ul className="day-log">
                    {list.map(a => {
                      const t = taskById.get(a.task_id);
                      const x = describe(a, nameOf);
                      const forOther = !!t && t.assignee_id !== p.id;
                      const verb = a.kind === 'created' && forOther ? 'assigned' : x.verb;
                      return (
                        <li key={a.id}>
                          <time>{fmtTime(a.created_at)}</time>
                          <span className={`verb ${x.tone ?? ''}`}>{verb}</span>
                          <button className="link task-link" onClick={() => openTask(a.task_id)}>{t?.title ?? `Task #${a.task_id}`}</button>
                          {forOther && a.kind === 'created' && (
                            <span className="muted"> → {firstName(nameOf(t!.assignee_id))}</span>
                          )}
                          {forOther && a.kind !== 'created' && a.kind !== 'comment' && (
                            <span className="muted tiny"> ({firstName(nameOf(t!.assignee_id))}'s)</span>
                          )}
                          {x.detail && <div className="detail">{a.kind === 'comment' ? `“${x.detail}”` : x.detail}</div>}
                        </li>
                      );
                    })}
                  </ul>
                ) : <div className="muted small pad">No updates this day.</div>}

                {due.length > 0 && (
                  <div className="due-box">
                    <div className="due-head">Due {d === td ? 'today' : 'this day'}</div>
                    {due.map(t => {
                      const ok = t.status === 'done';
                      const missed = !ok && d < td;
                      return (
                        <button key={t.id} className={`due-item ${ok ? 'ok' : missed ? 'missed' : ''}`} onClick={() => openTask(t.id)}>
                          <span className="due-mark">{ok ? '✓' : missed ? '✕' : '○'}</span>
                          <span className="grow">{t.title}</span>
                          <span className="muted tiny">{ok ? 'done' : missed ? 'missed' : 'open'}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {quiet.length > 0 && active.length > 0 && (
        <p className="muted small">No activity: {quiet.map(p => (p.id === me.id ? 'me' : p.full_name)).join(', ')}</p>
      )}
      {panels.map(f => {
        const Panel = f.dayReview!;
        return <Panel key={f.key + d} day={d} />;
      })}
    </div>
  );
}
