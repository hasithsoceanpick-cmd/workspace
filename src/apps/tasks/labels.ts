import type { Priority, Status } from './types';

export const STATUSES: { value: Status; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'doing', label: 'In progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'done', label: 'Done' },
];
export const statusLabel = (s: string) => STATUSES.find(x => x.value === s)?.label ?? s;

export const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];
