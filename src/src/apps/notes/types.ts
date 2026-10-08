import type { JSONContent } from '@tiptap/core';

export type Access = 'edit' | 'view';
export type ShareScope = 'private' | 'department' | 'people';

/** A page without its content (what the page tree needs) */
export interface NoteRow {
  id: number;
  department_id: string;
  owner_id: string;
  parent_id: number | null;
  root_id: number | null;
  title: string;
  position: number;
  share_scope: ShareScope;
  dept_access: Access;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface Note extends NoteRow {
  content: JSONContent;
}

export interface NoteShare {
  note_id: number;
  user_id: string;
  access: Access;
  created_at: string;
}

export interface NoteAttachment {
  id: number;
  note_id: number;
  department_id: string;
  name: string;
  path: string;
  size: number | null;
  mime: string | null;
  inline: boolean;
  created_by: string | null;
  created_at: string;
}

export const NOTE_COLS = 'id,department_id,owner_id,parent_id,root_id,title,position,share_scope,dept_access,created_at,updated_at,updated_by';
export const untitled = (t: string | null | undefined) => (t ?? '').trim() || 'Untitled page';
