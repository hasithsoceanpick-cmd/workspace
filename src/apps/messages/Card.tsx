import { Suspense } from 'react';
import { usePlatform } from '../../platform/store';
import { MESSAGE_CARDS, type WorkKind } from '../../platform/slots';
import { firstName } from '../../lib/labels';
import type { MsgItem } from './types';

const ICON: Record<WorkKind, string> = { task: '📋', mini: '☑️', reminder: '⏰', note: '📝' };
const NAME: Record<WorkKind, string> = { task: 'Task', mini: 'Mini task', reminder: 'Reminder', note: 'Note' };
export const workName = (k: WorkKind) => NAME[k];

/**
 * A task, mini task, reminder or note inside a message. The app that owns it draws the card (and opens it);
 * people without that app see the title only.
 */
export default function Card({ item }: { item: MsgItem }) {
  const { myAppKeys, person } = usePlatform();
  const slot = MESSAGE_CARDS.find(c => c.kinds.includes(item.kind) && myAppKeys.includes(c.app));
  const plain = (
    <div className={`wcard k-${item.kind} plain`}>
      <span className="wcard-icon" aria-hidden>{ICON[item.kind]}</span>
      <span className="wcard-main">
        <span className="wcard-kind">{NAME[item.kind]}{item.for_id ? ` for ${firstName(person(item.for_id)?.full_name ?? '')}` : ''}</span>
        <span className="wcard-title">{item.title || 'Untitled'}</span>
      </span>
    </div>
  );
  if (!slot) return plain;
  const C = slot.component;
  return (
    <Suspense fallback={plain}>
      <C item={item} relation={item.relation} by={item.created_by} />
    </Suspense>
  );
}
