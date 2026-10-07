export type Status = 'todo' | 'doing' | 'waiting' | 'done';
export type Priority = 'low' | 'normal' | 'high';

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
  kind: 'created' | 'status' | 'due_date' | 'assignee' | 'edited' | 'comment' | 'helper_added' | 'helper_removed' | 'step';
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
