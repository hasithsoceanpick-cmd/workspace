import { useEffect, useState } from 'react';
import { useTaskApp } from './store';
import { fmtStamp } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import { HEALTHS, healthLabel } from './labels';
import type { Health, Task } from './types';

export const HealthPill = ({ h }: { h: Health | null }) => (
  <span className={`pill health ${h ?? 'none'}`}>{healthLabel(h)}</span>
);

/** The project status flag: On track / At risk / Off track with a note. The owner, whoever gave it, or a manager sets it. */
export default function ProjectStatus({ task }: { task: Task }) {
  const { me, person, canCheck, updateTask, toast } = useTaskApp();
  const mayEdit = task.assignee_id === me.id || task.created_by === me.id || canCheck(task);
  const [h, setH] = useState<Health | ''>(task.health ?? '');
  const [note, setNote] = useState(task.health_note ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setH(task.health ?? ''); setNote(task.health_note ?? ''); }, [task.health, task.health_note]);
  const dirty = (h || null) !== task.health || note.trim() !== (task.health_note ?? '');

  async function save() {
    setBusy(true);
    const t = await updateTask(task.id, { health: (h || null) as Health | null, health_note: note.trim() });
    setBusy(false);
    if (t) toast('Status updated');
  }

  return (
    <section className="project-status">
      <div className="ps-current">
        <HealthPill h={task.health} />
        {task.health_note && <span className="ps-note">{task.health_note}</span>}
        {task.health_at && <span className="muted tiny">· {firstName(person(task.health_by)?.full_name ?? '')} {fmtStamp(task.health_at)}</span>}
      </div>
      {mayEdit && (
        <div className="ps-edit">
          <div className="seg small" role="radiogroup" aria-label="Project status">
            {HEALTHS.map(x => (
              <button key={x.value} type="button" className={`seg-btn health-${x.value} ${h === x.value ? 'on' : ''}`} onClick={() => setH(x.value)}>{x.label}</button>
            ))}
          </div>
          <input value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder="Why? (a short note)" aria-label="Status note" />
          <button className="btn primary sm" disabled={busy || !dirty || !h} onClick={save}>Update status</button>
        </div>
      )}
    </section>
  );
}
