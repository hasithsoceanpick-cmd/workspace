import { lazy, type ComponentType } from 'react';
import type { Params } from '../lib/route';
import TasksApp from '../apps/tasks';
import AdminApp from '../apps/admin';

export interface AppProps {
  page: string;
  params: Params;
}

export interface AppDef {
  /** Must match the key in the `apps` table (registered by the app's SQL file) */
  key: string;
  name: string;
  component: ComponentType<AppProps>;
  /** URL parameter that opens one item, used by notifications (e.g. #/tasks?task=12) */
  refParam?: string;
  /** switched on (for everyone) when a new department is created; otherwise the admin turns it on */
  defaultOn?: boolean;
  /** notification kinds that open a particular page of the app (e.g. weekly → 'week') */
  kindPages?: Record<string, string>;
}

/**
 * Every app in the platform. To add one:
 *   1. create  src/apps/<key>/index.tsx  (default export = the app component)
 *   2. add it to this list
 *   3. run its SQL file (copy supabase/templates/new_app.sql)
 *   4. switch it on for a department in Admin console → Departments
 */
export const APPS: AppDef[] = [
  { key: 'tasks', name: 'Tasks', component: TasksApp, refParam: 'task', defaultOn: true, kindPages: { weekly: 'week', reminder: 'reminders' } },
  // the editor is large, so Notes only downloads when someone opens it
  { key: 'notes', name: 'Notes', component: lazy(() => import('../apps/notes')), refParam: 'note' },
];

/** Only the platform admin ever sees this one. */
export const ADMIN_APP: AppDef = { key: 'admin', name: 'Admin console', component: AdminApp };
