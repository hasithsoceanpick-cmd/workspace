export type Status = 'todo' | 'doing' | 'waiting' | 'review' | 'done';
export type Priority = 'low' | 'normal' | 'high';
export type Repeat = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Task {
  id: number;
  department_id: string;
  title: string;
  notes: string;
  assignee_id: string;
  created_by: string | null;
  status: Status;
  priority: Priority;
  due_date: string; // YYYY-MM-DD
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  /** the first deadline it was given, and how many times it has been moved */
  original_due: string | null;
  due_moves: number;
  repeat: Repeat | null;
  /** the series' first deadline, and which occurrence this is (the schedule is anchor + n × step) */
  repeat_anchor: string | null;
  repeat_n: number;
  next_task_id: number | null;
  /** first task of its repeating series (itself for the first one) */
  series_id: number | null;
  /** sign-off: needed when given by someone else (whoever gave it decides) */
  needs_check: boolean;
  /** when the owner finished it (sent for sign-off) */
  submitted_at: string | null;
  checked_by: string | null;
  checked_at: string | null;
  sent_back_n: number;
  /** "Got it": when the owner first opened it (null = not yet) */
  acknowledged_at: string | null;
  /** early reminder N days before the deadline */
  remind_days: number | null;
  /** still not finished 3 days after the deadline: the managers were told (cleared when the deadline moves) */
  escalated_at: string | null;
}

/** My pin / follow marks on a task */
export interface TaskFollow {
  task_id: number;
  user_id: string;
  department_id: string;
  pinned: boolean;
  following: boolean;
}

export type ReminderRepeat = 'daily' | 'weekdays' | 'weekly' | 'monthly';
export interface Reminder {
  id: number;
  department_id: string;
  user_id: string;
  created_by: string | null;
  body: string;
  remind_at: string;
  repeat: ReminderRepeat | null;
  task_id: number | null;
  sent_at: string | null;
  done_at: string | null;
  created_at: string;
}

export interface TaskComment {
  id: number;
  task_id: number;
  author_id: string;
  body: string;
  created_at: string;
}

export interface TaskActivity {
  id: number;
  task_id: number;
  department_id: string;
  actor_id: string | null;
  kind: 'created' | 'status' | 'due_date' | 'assignee' | 'edited' | 'comment' | 'helper_added' | 'helper_removed' | 'step' | 'repeated'
    | 'sent_back' | 'acknowledged';
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export interface TaskDraft {
  title: string;
  notes: string;
  assignee_id: string;
  status: Status;
  priority: Priority;
  due_date: string;
  repeat?: Repeat | null;
  needs_check?: boolean;
  remind_days?: number | null;
  acknowledged_at?: string | null;
}

export interface TaskHelper {
  task_id: number;
  user_id: string;
  department_id: string;
  added_by: string | null;
  created_at: string;
}

export interface ChecklistItem {
  id: number;
  task_id: number;
  department_id: string;
  body: string;
  done: boolean;
  position: number;
  created_by: string | null;
  done_by: string | null;
  done_at: string | null;
  created_at: string;
}

export interface TaskAttachment {
  id: number;
  task_id: number;
  department_id: string;
  kind: 'file' | 'link';
  name: string;
  url: string | null;
  path: string | null;
  size: number | null;
  mime: string | null;
  created_by: string | null;
  created_at: string;
}

export interface TimeBlock {
  id: number;
  department_id: string;
  user_id: string;
  day: string;        // YYYY-MM-DD
  start_min: number;  // minutes after midnight
  end_min: number;
  task_id: number | null;
  title: string | null;
  created_at: string;
}
