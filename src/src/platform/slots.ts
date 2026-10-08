import type { ComponentType } from 'react';
import type { Task } from '../apps/tasks/types';
import LinkedNotesPanel from '../apps/notes/LinkedNotesPanel';
import { tasksSearch } from '../apps/tasks/search';
import { notesSearch } from '../apps/notes/search';

/**
 * Places where one app can show something inside another app, without the two
 * importing each other. A slot only appears for people who have that app.
 *
 *   taskPanel – a section inside the Tasks app's task details panel
 *   search    – results in the Ctrl+K search box (each app searches its own data, with the person's own rights)
 */
export const TASK_PANELS: { app: string; component: ComponentType<{ task: Task }> }[] = [
  { app: 'notes', component: LinkedNotesPanel },
];

export interface SearchHit {
  key: string;
  title: string;
  detail?: string;
  /** the text around the match when it wasn't in the title */
  snippet?: string;
  done?: boolean;
  open: () => void;
}
export interface SearchProvider {
  app: string;
  label: string;
  search: (q: string, deptId: string, ctx: { nameOf: (id: string | null) => string }) => Promise<SearchHit[]>;
}
/** Ctrl+K search. Only shown for apps the person has in the department being viewed. */
export const SEARCH: SearchProvider[] = [tasksSearch, notesSearch];
