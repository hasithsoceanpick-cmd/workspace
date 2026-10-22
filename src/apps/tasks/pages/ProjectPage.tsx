import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../supabase';
import { useTaskApp } from '../store';
import { go, type Params } from '../../../lib/route';
import { addDays, daysBetween, fmtDay, fmtStamp, localDayOf, today } from '../../../lib/dates';
import { firstName } from '../../../lib/labels';
import { finished, healthLabel, statusLabel } from '../labels';
import Avatar from '../../../platform/Avatar';
import AssignedBy from '../AssignedBy';
import OutsideWith from '../OutsideWith';
import ProjectStatus from '../ProjectStatus';
import { Stages, useStages } from '../Stages';
import { TaskFiles, useTaskFiles } from '../TaskFiles';
import type { TaskActivity } from '../types';

/** One project: progress, a timeline of its stages, the status flag and its history, the stages, notes and files. */
export default function ProjectPage({ params }: { params: Params }) {
  const { tasks, loaded, person, me, helperOnly, openTask, refresh } = useTaskApp();
  const id = Number(params.id) || 0;
  const t = tasks.find(x => x.id === id && x.nature === 'project');
  const stages = useStages(t ? id : null);
  const files = useTaskFiles(t ? id : null);
  const [history, setHistory] = useState<TaskActivity[]>([]);
  const [tried, setTried] = useState(false);
  const td = today();

  useEffect(() => {
    if (!t) return;
    supabase.from('task_activity').select('*').eq('task_id', id).eq('kind', 'health').order('created_at', { ascending: false })
      .then(({ data }) => setHistory((data ?? []) as TaskActivity[]));
  }, [id, t?.health, t?.health_note, t?.health_at]); // eslint-disable-line react-hooks/exhaustive-deps

  // opened from a link before the list knew this project: look once more
  useEffect(() => { if (loaded && !t && !tried) { setTried(true); refresh(); } }, [loaded, t, tried, refresh]);

  const items = stages.items;
  const range = useMemo(() => {
    if (!t) return null;
    const dates = [localDayOf(t.created_at), t.due_date, ...items.map(s => s.due_date).filter((x): x is string => !!x)].sort();
    const start = dates[0] < td ? dates[0] : td;
    let end = dates[dates.length - 1] > td ? dates[dates.length - 1] : td;
    if (end === start) end = addDays(start, 1);
    return { start, end, span: daysBetween(start, end) };
  }, [t, items, td]);

  if (!loaded) return <div className="page"><div className="empty">Loading…</div></div>;
  if (!t) {
    return (
      <div className="page">
        <button className="link" onClick={() => go('tasks', 'projects')}>← Projects</button>
        <div className="empty">This project isn't available. It may have been deleted, or you can't see it.</div>
      </div>
    );
  }

  const canRun = !helperOnly(t);
  const done = items.filter(s => s.done).length;
  const total = items.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const late = items.filter(s => !s.done && s.due_date && s.due_date < td).length;
  const left = daysBetween(td, t.due_date);
  const frac = (iso: string) => Math.max(0, Math.min(1, daysBetween(range!.start, iso) / range!.span));
  const pos = (iso: string) => `${frac(iso) * 100}%`;
  const line = (iso: string) => `calc(var(--lab) + (100% - var(--lab)) * ${frac(iso)})`;
  const owner = person(t.assignee_id);

  return (
    <div className="page wide project-page">
      <button className="link" onClick={() => go('tasks', 'projects')}>← Projects</button>
      <div className="page-head">
        <div className="grow">
          <AssignedBy t={t} big />
          <OutsideWith t={t} big />
          <h1><span className="pill project">◆ Project</span> {t.title}</h1>
          <div className="muted pj-sub">
            <span><Avatar p={owner} size={18} /> {owner?.full_name}{t.assignee_id === me.id ? ' (you)' : ''}</span>
            <span>· {finished(t) ? statusLabel(t.status) : left < 0 ? <span className="danger">ended {fmtDay(t.due_date)} · {-left}d late</span> : `ends ${fmtDay(t.due_date)} · ${left === 0 ? 'today' : `${left} day${left === 1 ? '' : 's'} left`}`}</span>
          </div>
        </div>
        <div className="filters">
          <button className="btn sm" onClick={() => openTask(t.id)}>Details, comments &amp; history</button>
        </div>
      </div>

      <div className="pj-grid">
        <section className="pj-box">
          <h2>Progress</h2>
          <div className="pj-big"><strong>{pct}%</strong> <span className="muted">{total ? `${done} of ${total} stages done` : 'no stages yet'}</span></div>
          <div className="progress big" aria-hidden="true"><div style={{ width: `${pct}%` }} /></div>
          <div className="small pj-facts">
            {late > 0 && <span className="danger">{late} stage{late === 1 ? '' : 's'} overdue</span>}
            <span className="muted">{total - done} to go</span>
          </div>
        </section>

        <section className="pj-box">
          <h2>Status</h2>
          <ProjectStatus task={t} />
          {history.length > 0 && (
            <ul className="pj-history small">
              {history.map(h => {
                const [flag, note] = (h.new_value ?? '').split(/\|(.*)/s);
                return (
                  <li key={h.id}>
                    <span className="muted">{fmtStamp(h.created_at)}</span> <strong>{firstName(person(h.actor_id)?.full_name ?? 'Someone')}</strong>
                    {' '}set <span className={`health-word ${flag}`}>{healthLabel(flag || null)}</span>{note ? <> — “{note}”</> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="pj-box">
        <h2>Timeline</h2>
        {range && (
          <div className="tl2">
            <div className="tl2-axis small muted">
              <span>{fmtDay(range.start)}</span>
              <span>{fmtDay(range.end)}</span>
            </div>
            <div className="tl2-rows">
              <div className="tl2-today" style={{ left: line(td) }} title="Today"><span>Today</span></div>
              <div className="tl2-end" style={{ left: line(t.due_date) }} title={`Ends ${fmtDay(t.due_date)}`}><span>End</span></div>
              {items.filter(s => s.due_date).map(s => {
                const overdue = !s.done && s.due_date! < td;
                const who = person(s.assignee_id ?? t.assignee_id);
                return (
                  <div key={s.id} className="tl2-row">
                    <div className="tl2-label">
                      <span className="tl2-name">{s.body}</span>
                      <span className="muted tiny">{firstName(who?.full_name ?? '')} · {fmtDay(s.due_date!)}</span>
                    </div>
                    <div className="tl2-track">
                      <div className="tl2-bar" style={{ left: pos(localDayOf(t.created_at)), width: `calc(${pos(s.due_date!)} - ${pos(localDayOf(t.created_at))})` }} />
                      <span className={`tl2-dot ${s.done ? 'done' : overdue ? 'late' : 'up'}`} style={{ left: pos(s.due_date!) }}
                        title={`${s.body} · ${fmtDay(s.due_date!)} · ${s.done ? 'done' : overdue ? 'overdue' : 'to do'}`} />
                    </div>
                  </div>
                );
              })}
              {items.filter(s => s.due_date).length === 0 && <div className="muted small tl2-empty">Give the stages dates to see them here.</div>}
            </div>
            <div className="tl2-legend tiny muted"><span className="tl2-dot done" /> done <span className="tl2-dot up" /> to do <span className="tl2-dot late" /> overdue</div>
          </div>
        )}
      </section>

      <section className="pj-box">
        <Stages list={stages} ownerId={t.assignee_id} canRun={canRun} endDate={t.due_date} />
        {!canRun && <div className="muted tiny">You can tick the stages that are yours. {firstName(owner?.full_name ?? 'The owner')} changes the rest.</div>}
      </section>

      <section className="pj-box">
        <h2>Notes &amp; files</h2>
        {t.notes ? <p className="pj-notes">{t.notes}</p> : <div className="muted small">No notes yet{canRun ? ' — add them in Details.' : '.'}</div>}
        <TaskFiles files={files} canRemove={a => a.created_by === me.id || canRun} />
      </section>
    </div>
  );
}
