import { useTaskApp } from './store';
import type { Task } from './types';
import { firstName } from '../../lib/labels';

/**
 * The line at the top of a task card when the task was given to someone outside the app:
 * "Given to Sampath Perera · DFCC Bank — you follow up".
 */
export default function OutsideWith({ t, big }: { t: Pick<Task, 'contact_id' | 'assignee_id'>; big?: boolean }) {
  const { me, person, contactOf } = useTaskApp();
  const c = contactOf(t.contact_id);
  if (!c) return null;
  const who = t.assignee_id === me.id ? 'you follow up' : `${firstName(person(t.assignee_id)?.full_name ?? '')} follows up`;
  return (
    <div className={`outside-with ${big ? 'big' : ''}`} title={[c.name, c.organisation, c.phone, c.email].filter(Boolean).join(' · ')}>
      <span className="ow-icon" aria-hidden="true">↗</span>
      <span className="ow-text">Given to <strong>{c.name}</strong>{c.organisation && <> · {c.organisation}</>}<span className="muted"> — {who}</span></span>
    </div>
  );
}
