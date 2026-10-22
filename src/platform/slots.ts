import { lazy, type ComponentType } from 'react';
import type { Task } from '../apps/tasks/types';
import LinkedNotesPanel from '../apps/notes/LinkedNotesPanel';
import { tasksSearch } from '../apps/tasks/search';
import { notesSearch } from '../apps/notes/search';
import ReminderButton from '../apps/tasks/ReminderButton';
import DailyUpdateGate from '../apps/tasks/DailyUpdateGate';
import ChatButton from '../apps/messages/ChatButton';
import { messagesSearch } from '../apps/messages/search';

/**
 * Places where one app can show something inside another app, without the two
 * importing each other. A slot only appears for people who have that app.
 *
 *   taskPanel – a section inside the Tasks app's task details panel
 *   search    – results in the Ctrl+K search box (each app searches its own data, with the person's own rights)
 *   topBar    – a small button in the top bar (e.g. quick reminders), next to search and the bell
 *   gates     – a screen that must be dealt with before anything else (e.g. yesterday's daily updates)
 *   message*  – work inside the Messages app: cards for tasks / notes / reminders / mini tasks, pickers to attach
 *               them, and forms that make new work from a message (loaded only when Messages is opened)
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
export const SEARCH: SearchProvider[] = [tasksSearch, notesSearch, messagesSearch];

/** Buttons in the top bar. Only shown for people who have that app in the department being viewed. */
export const TOP_BAR: { app: string; component: ComponentType }[] = [
  { app: 'tasks', component: ReminderButton },
  { app: 'messages', component: ChatButton },
];

/**
 * Screens shown over the whole platform until they're dealt with. Each decides for itself whether it's needed
 * (from the person's own data, with their own rights) and renders nothing otherwise. Keep them small.
 */
export const GATES: { app: string; component: ComponentType }[] = [
  { app: 'tasks', component: DailyUpdateGate },
];

// ---------- Work inside messages ----------
export type WorkKind = 'task' | 'mini' | 'reminder' | 'note';
/** A piece of work carried by a message (a row of msg_items). The title etc. are a copy, shown even to people who can't open it. */
export interface WorkItem {
  kind: WorkKind;
  ref_id: number;
  title: string;
  /** who it is for (the task owner, the person reminded, …) */
  for_id?: string | null;
  /** reminders: when */
  remind_at?: string | null;
}
export interface WorkCardProps {
  item: WorkItem;
  /** 'attached' to the message, 'sent' as the message, or 'made' from it later */
  relation: 'attached' | 'sent' | 'made';
  /** who added it */
  by: string | null;
}
/** Shows a card in a message; clicking it opens the work (if the viewer may). */
export const MESSAGE_CARDS: { app: string; kinds: WorkKind[]; component: ComponentType<WorkCardProps> }[] = [
  { app: 'tasks', kinds: ['task', 'mini', 'reminder'], component: lazy(() => import('../apps/tasks/MessageCard')) },
  { app: 'notes', kinds: ['note'], component: lazy(() => import('../apps/notes/MessageNote')) },
];

export interface WorkPickProps {
  kind: WorkKind;
  /** the people who will see the message (not me) — e.g. to offer to share a private note with them */
  audience: string[];
  /** 'direct' (one person), 'team' or 'announce' */
  where: 'direct' | 'team' | 'announce';
  onPick: (item: WorkItem) => void;
  onCancel: () => void;
}
/** "Attach" in the message box: pick something you already have. */
export const MESSAGE_ATTACH: { app: string; kind: WorkKind; label: string; component: ComponentType<WorkPickProps> }[] = [
  { app: 'tasks', kind: 'task', label: 'Task', component: lazy(() => import('../apps/tasks/MessagePick')) },
  { app: 'tasks', kind: 'reminder', label: 'Reminder', component: lazy(() => import('../apps/tasks/MessagePick')) },
  { app: 'notes', kind: 'note', label: 'Note', component: lazy(() => import('../apps/notes/MessageNotePick')) },
];

export interface WorkMakeProps {
  kind: WorkKind;
  /** the message text, used as the title */
  text: string;
  /** who to suggest first (the other person in a one-to-one chat, the people @mentioned) */
  suggest: string[];
  /** 'send': "Send as" from the message box (for someone else); 'make': "Turn into" on a message (usually for me) */
  mode: 'send' | 'make';
  onDone: (item: WorkItem | null) => void;
}
/** New work made from a message: "Send as …" and "Turn into …". */
export const MESSAGE_WORK: { app: string; kind: WorkKind; label: string; component: ComponentType<WorkMakeProps> }[] = [
  { app: 'tasks', kind: 'task', label: 'Task', component: lazy(() => import('../apps/tasks/MessageWork')) },
  { app: 'tasks', kind: 'mini', label: 'Mini task', component: lazy(() => import('../apps/tasks/MessageWork')) },
  { app: 'tasks', kind: 'reminder', label: 'Reminder', component: lazy(() => import('../apps/tasks/MessageWork')) },
];
