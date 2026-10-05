import type { ComponentType } from 'react';
import type { Params } from '../lib/route';
import type { Task } from '../apps/tasks/types';
import DailyNotes from './daily-notes/DailyNotes';

/**
 * DEPARTMENT-SPECIFIC FEATURES
 *
 * Anything built for one department lives in  src/features/<feature>/  and is
 * listed here. A feature only appears for departments where the admin has
 * switched it on (Admin console → Departments → Features); its database table
 * must also check has_feature(...) — see supabase/templates/new_department_feature.sql.
 *
 * Shared app code never mentions a department by name. It only offers "slots"
 * that features can plug into:
 *   pages      – extra tabs inside an app
 *   dayReview  – a panel at the bottom of Tasks → Day review
 *   taskPanel  – a section inside the task details panel
 */
export interface FeatureModule {
  /** Must match feature_key in the department_features table */
  key: string;
  /** Which app it extends */
  app: string;
  name: string;
  description: string;
  pages?: { id: string; label: string; component: ComponentType<{ params: Params }> }[];
  dayReview?: ComponentType<{ day: string }>;
  taskPanel?: ComponentType<{ task: Task }>;
}

export const FEATURES: FeatureModule[] = [
  {
    key: 'daily_notes',
    app: 'tasks',
    name: 'Daily notes',
    description: 'Each person writes a short end-of-day note, shown in Day review.',
    dayReview: DailyNotes,
  },
];
