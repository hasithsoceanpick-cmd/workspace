export type Role = 'manager' | 'senior' | 'member';

export interface Department {
  id: string;
  name: string;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  department_id: string | null;
  role: Role;
  active: boolean;
  color: string;
  created_at: string;
}

/** A row of the `apps` table (what the database knows about each app) */
export interface AppRow {
  key: string;
  name: string;
  description: string;
  sort: number;
}

export interface DeptApp {
  department_id: string;
  app_key: string;
  everyone: boolean;
}

export interface AppMember {
  department_id: string;
  app_key: string;
  user_id: string;
}

export interface DeptFeature {
  department_id: string;
  feature_key: string;
}

export interface Notice {
  id: number;
  user_id: string;
  department_id: string | null;
  app_key: string | null;
  ref_id: number | null;
  kind: string;
  message: string;
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
}
