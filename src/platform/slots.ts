import type { ComponentType } from 'react';
import type { Task } from '../apps/tasks/types';
import LinkedNotesPanel from '../apps/notes/LinkedNotesPanel';

/**
 * Places where one app can show something inside another app, without the two
 * importing each other. A slot only appears for people who have that app.
 *
 *   taskPanel – a section inside the Tasks app's task details panel
 */
export const TASK_PANELS: { app: string; component: ComponentType<{ task: Task }> }[] = [
  { app: 'notes', component: LinkedNotesPanel },
];
