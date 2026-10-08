import type { ComponentType } from 'react';
import type { Params } from '../lib/route';
import type { Task } from '../apps/tasks/types';
import DailyNotes from './daily-notes/DailyNotes';
import MonthEndPage from './month-end/MonthEndPage';
import CompliancePage from './compliance/CompliancePage';

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
  /** notification kinds this feature sends; clicking one opens the feature's first page */
  noticeKinds?: string[];
}

export const FEATURES: FeatureModule[] = [
  {
    key: 'daily_notes',
    app: 'tasks',
    name: 'Daily notes',
    description: 'Each person writes a short end-of-day note, shown in Day review.',
    dayReview: DailyNotes,
  },
  {
    key: 'month_end',
    app: 'tasks',
    name: 'Month-end declaration',
    description: 'Monthly self-declaration checklist (MEC / CMP lines with owners and due dates), reviewed by a senior executive and approved by the manager.',
    pages: [{ id: 'month-end', label: 'Month end', component: MonthEndPage }],
    noticeKinds: ['month_end'],
  },
  {
    key: 'compliance',
    app: 'tasks',
    name: 'Compliance calendar',
    description: 'Recurring statutory deadlines (tax returns, EPF/ETF, renewals …) with owners, early reminders and an on-time record.',
    pages: [{ id: 'compliance', label: 'Compliance', component: CompliancePage }],
  },
];
