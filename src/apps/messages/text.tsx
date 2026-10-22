import type { ReactNode } from 'react';
import type { Profile } from '../../platform/types';
import { fmtDay, fmtTime, toISO, today, addDays } from '../../lib/dates';
import type { ThreadInfo } from './types';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A message's words: line breaks kept, web links clickable, @mentions highlighted.
 * Plain text only — nothing in a message is ever treated as HTML.
 */
export function Body({ text, mentioned, me }: { text: string; mentioned: Profile[]; me: string }) {
  const names = mentioned.map(p => p.full_name).filter(Boolean).sort((a, b) => b.length - a.length);
  const parts = [`https?://[^\\s<]+[^\\s<.,;:!?)\\]'"]`];
  if (names.length) parts.push(`@(?:${names.map(esc).join('|')})`);
  const re = new RegExp(parts.join('|'), 'g');
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const tok = m[0];
    if (tok.startsWith('@')) {
      const p = mentioned.find(x => `@${x.full_name}` === tok);
      out.push(<span key={k++} className={`mention ${p?.id === me ? 'me' : ''}`}>{tok}</span>);
    } else {
      out.push(<a key={k++} href={tok} target="_blank" rel="noopener noreferrer">{tok}</a>);
    }
    last = i + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/** Time on the conversation list: 14:05 today, "Yesterday", "Mon", or "12 Oct". */
export function listTime(ts: string) {
  const d = toISO(new Date(ts));
  const td = today();
  if (d === td) return fmtTime(ts);
  if (d === addDays(td, -1)) return 'Yesterday';
  if (d > addDays(td, -7)) return fmtDay(d).split(' ')[0];
  return fmtDay(d).split(' ').slice(1).join(' ');
}

/** The day line between messages: Today, Yesterday, or "Tue 6 Oct". */
export function dayLine(iso: string) {
  const td = today();
  if (iso === td) return 'Today';
  if (iso === addDays(td, -1)) return 'Yesterday';
  return fmtDay(iso);
}

export function threadTitle(t: Pick<ThreadInfo, 'kind' | 'other_id'>, person: (id: string | null) => Profile | undefined) {
  if (t.kind === 'team') return 'Team chat';
  if (t.kind === 'announce') return 'Announcements';
  return person(t.other_id)?.full_name ?? 'Former colleague';
}

const CARD: Record<string, string> = { task: '📋 Task', mini: '☑️ Mini task', reminder: '⏰ Reminder', note: '📝 Note' };

/** One line for the conversation list */
export function lastLine(t: ThreadInfo, me: string, person: (id: string | null) => Profile | undefined) {
  if (!t.last_author && t.last_body === null) return t.kind === 'announce' ? 'Managers post here' : 'No messages yet';
  const who = t.last_author === me ? 'You: ' : t.kind !== 'direct' ? `${person(t.last_author)?.full_name.split(' ')[0] ?? 'Someone'}: ` : '';
  if (t.last_deleted) return `${who}Message deleted`;
  return who + ((t.last_body ?? '').replace(/\s+/g, ' ').trim() || (t.last_files ? '📎 Attachment' : CARD[t.last_item ?? ''] ?? '…'));
}
