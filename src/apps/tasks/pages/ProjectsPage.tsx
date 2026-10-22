import { useMemo, useState } from 'react';
import { useTaskApp } from '../store';
import { go, setParams, type Params } from '../../../lib/route';
import { daysBetween, fmtDay, fmtDue, today } from '../../../lib/dates';
import { firstName } from '../../../lib/labels';
import { finished, isLate } from '../labels';
import Avatar from '../../../platform/Avatar';
import { HealthPill } from '../ProjectStatus';
import type { Task } from '../types';

/** Projects: every project I can see, with progress, status flag, the next stage and the end date. */
export default function ProjectsPage({ params }: { params: Params }) {
  const { tasks, stagesOf, stageOwner, person, newTask, team, loaded } = useTaskApp();
  const td = today();
  const show = params.show === 'done' ? 'done' : 'open';
  const [q, setQ] = useState('');

  const list = useMemo(() => tasks.filter(t => t.nature === 'project' && (show === 'done' ? finished(t) : !finished(t)))
    .filter(t => !q.trim() || t.title.toLowerCase().includes(q.trim().toLowerCase()))
    .map(t => {
      const st = stagesOf(t.id);
      const done = st.filter(s => s.done).length;
      const late = st.filter(s => !s.done && s.due_date && s.due_date < td).length;
      const next = st.find(s => !s.done);
      return { t, total: st.length, done, late, next };
    })
    .sort((a, b) => rank(b.t) - rank(a.t) || b.late - a.late || a.t.due_date.localeCompare(b.t.due_date)), [tasks, show, q, stagesOf, td]);

  return (
    <div className="page projects-page">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <div className="muted">Big pieces of work with dated stages · {list.length} {show === 'done' ? 'finished' : 'open'}</div>
        </div>
        <div className="filters">
          <input type="search" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search projects" />
          <div className="seg small">
            <button className={`seg-btn ${show === 'open' ? 'on' : ''}`} onClick={() => setParams({ show: '' })}>Open</button>
            <button className={`seg-btn ${show === 'done' ? 'on' : ''}`} onClick={() => setParams({ show: 'done' })}>Finished</button>
          </div>
          {team.length > 0 && <button className="btn primary sm" onClick={() => newTask({ nature: 'project' })}>+ New project</button>}
        </div>
      </div>

      {!loaded ? <div className="empty">Loading…</div> : list.length === 0 ? (
        <div className="empty">{q ? 'No project matches.' : show === 'done' ? 'No finished projects yet.' : <>No projects yet. Start one with <strong>+ New project</strong>.</>}</div>
      ) : (
        <div className="pj-list">
          {list.map(({ t, total, done, late, next }) => {
            const pct = total ? Math.round((done / total) * 100) : 0;
            const overdue = isLate(t, td);
            return (
              <button key={t.id} className={`pj-card ${t.health ?? ''}`} onClick={() => go('tasks', 'project', { id: String(t.id) })}>
                <div className="pj-top">
                  <span className="pj-title">{t.title}</span>
                  <HealthPill h={t.health} />
                </div>
                {t.health_note && <div className="pj-note muted small">“{t.health_note}”</div>}
                <div className="pj-progress">
                  <div className="progress" aria-hidden="true"><div style={{ width: `${pct}%` }} /></div>
                  <span className="small">{total ? `${done}/${total} stages · ${pct}%` : 'No stages yet'}</span>
                  {late > 0 && <span className="pill high">{late} overdue</span>}
                </div>
                <div className="pj-meta small">
                  <span className="pj-owner"><Avatar p={person(t.assignee_id)} size={18} /> {firstName(person(t.assignee_id)?.full_name ?? '')}</span>
                  {next && (
                    <span className="muted">Next: <strong>{next.body}</strong>{next.due_date && ` · ${fmtDue(next.due_date)}`}
                      {stageOwner(next) && stageOwner(next) !== t.assignee_id && ` · ${firstName(person(stageOwner(next))?.full_name ?? '')}`}</span>
                  )}
                  <span className={`pj-end ${overdue ? 'danger' : 'muted'}`}>
                    {finished(t) ? 'Finished' : overdue ? `Ended ${fmtDay(t.due_date)} · ${daysBetween(t.due_date, td)}d late` : `Ends ${fmtDay(t.due_date)}`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const rank = (t: Task) => (t.health === 'off_track' ? 2 : t.health === 'at_risk' ? 1 : 0);
