import type { WorkKind } from '../../platform/slots';

export type ThreadKind = 'team' | 'announce' | 'direct';

/** One conversation on the list (from msg_sync) */
export interface ThreadInfo {
  thread_id: number;
  kind: ThreadKind;
  /** one-to-one: the other person */
  other_id: string | null;
  last_at: string;
  last_body: string | null;
  last_author: string | null;
  last_deleted: boolean | null;
  last_files: number;
  /** the kind of work card on the last message, if it has one */
  last_item: string | null;
  unread: number;
  mentions: number;
}

export interface Msg {
  id: number;
  thread_id: number;
  department_id: string;
  author_id: string | null;
  body: string;
  reply_to: number | null;
  mentions: string[];
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export interface MsgItem {
  id: number;
  message_id: number;
  thread_id: number;
  kind: WorkKind;
  ref_id: number;
  relation: 'attached' | 'sent' | 'made';
  title: string;
  for_id: string | null;
  remind_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface MsgFile {
  id: number;
  message_id: number;
  thread_id: number;
  path: string;
  name: string;
  size: number | null;
  mime: string | null;
  created_by: string | null;
}

export interface MsgRead {
  thread_id: number;
  user_id: string;
  delivered_at: string | null;
  read_at: string | null;
}

export interface MsgAck {
  message_id: number;
  user_id: string;
  acked_at: string;
}

/** Messages can be changed or deleted for 15 minutes (the database enforces it too). */
export const EDIT_MINUTES = 15;
