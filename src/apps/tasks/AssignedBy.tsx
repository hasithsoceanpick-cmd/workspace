import { useTaskApp } from './store';
import type { Task } from './types';
import { firstName } from '../../lib/labels';
import Avatar from '../../platform/Avatar';

/**
 * The line at the top of a task card when someone gave the task to someone else.
 * Whoever gave it sees "Assigned by you → Kasun", the owner sees "Assigned by Hasith",
 * anyone else (a manager looking on) sees "Assigned by Hasith → Kasun".
 */
export default function AssignedBy({ t, big }: { t: Pick<Task, 'created_by' | 'assignee_id'>; big?: boolean }) {
  const { me, person } = useTaskApp();
  if (!t.created_by || t.created_by === t.assignee_id) return null;
  const by = person(t.created_by);
  const to = person(t.assignee_id);
  const name = (p: typeof by) => (big ? p?.full_name : firstName(p?.full_name ?? '')) || 'someone';
  const byName = t.created_by === me.id ? 'you' : name(by);
  const toMe = t.assignee_id === me.id;
  return (
    <div className={`assigned-by ${big ? 'big' : ''} ${t.created_by === me.id ? 'mine' : ''}`}
      title={`Assigned by ${by?.full_name ?? 'someone'} to ${to?.full_name ?? 'someone'}`}>
      <Avatar p={by} size={big ? 20 : 15} />
      <span className="ab-text">Assigned by <strong>{byName}</strong>{!toMe && <> <span aria-hidden="true">→</span> <strong>{name(to)}</strong></>}</span>
    </div>
  );
}
