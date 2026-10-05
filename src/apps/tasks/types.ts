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
  kind: 'created' | 'status' | 'due_date' | 'assignee' | 'edited' | 'comment';
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
