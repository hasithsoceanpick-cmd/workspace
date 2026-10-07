import type { Priority, Repeat, Status } from './types';

export const STATUSES: { value: Status; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'doing', label: 'In progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'done', label: 'Done' },
];
export const statusLabel = (s: string) => STATUSES.find(x => x.value === s)?.label ?? s;

export const REPEATS: { value: Repeat; label: string; short: string }[] = [
  { value: 'weekly', label: 'Every week', short: 'Weekly' },
  { value: 'monthly', label: 'Every month', short: 'Monthly' },
  { value: 'quarterly', label: 'Every 3 months', short: 'Quarterly' },
  { value: 'yearly', label: 'Every year', short: 'Yearly' },
];
export const repeatLabel = (r: string | null | undefined) => REPEATS.find(x => x.value === r)?.short ?? '';

export const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];
