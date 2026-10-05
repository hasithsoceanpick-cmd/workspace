import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import type { Profile } from '../../platform/types';
import type { Task, TaskDraft } from './types';

type DrawerState = { mode: 'edit'; id: number } | { mode: 'new'; defaults: Partial<TaskDraft> } | null;

interface TasksStore {
  /** I'm a member of the department being viewed (false when the admin visits another department) */
  inDept: boolean;
  /** manager or admin: sees everything in the department */
  fullView: boolean;
  /** manager, senior or admin: can look at other people's work */
  isLead: boolean;
  /** People whose work I can see and assign to (me first) */
  team: Profile[];
  canAssignTo: (id: string) => boolean;
  tasks: Task[];
  loaded: boolean;
  refresh: () => Promise<void>;
  createTask: (d: TaskDraft) => Promise<Task | null>;
  updateTask: (id: number, patch: Partial<TaskDraft>) => Promise<Task | null>;
  deleteTask: (id: number) => Promise<boolean>;
  canDelete: (t: Task) => boolean;
  drawer: DrawerState;
  openTask: (id: number) => void;
  newTask: (defaults?: Partial<TaskDraft>) => void;
  closeDrawer: () => void;
}

const Ctx = createContext<TasksStore | null>(null);
export const useTasks = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('Tasks store missing');
  return s;
};

const POLL_MS = 45_000;

export function TasksProvider({ children }: { children: ReactNode }) {
  const { me, isAdmin, dept, deptPeople, userHasApp, fail, toast, refreshNotices } = usePlatform();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState>(null);

  const deptId = dept!.id;
  const inDept = me.department_id === deptId;
  const myRole = inDept ? me.role : null;
  const fullView = isAdmin || myRole === 'manager';
  const isLead = fullView || myRole === 'senior';

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.from('tasks').select('*')
      .eq('department_id', deptId).order('due_date').order('id');
    if (error) return fail(error);
    setTasks(data as Task[]);
    setLoaded(true);
  }, [deptId, fail]);

  useEffect(() => {
    (async () => {
      await supabase.rpc('run_deadline_check');
      await refresh();
      refreshNotices();
    })();
    const tick = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = setInterval(tick, POLL_MS);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [refresh, refreshNotices]);

  const team = useMemo(() => {
    const withApp = deptPeople.filter(p => userHasApp(p.id, 'tasks'));
    let list: Profile[];
    if (fullView) list = withApp;
    else if (myRole === 'senior') list = withApp.filter(p => p.id === me.id || p.role === 'member');
    else list = withApp.filter(p => p.id === me.id);
    const order = { manager: 0, senior: 1, member: 2 } as const;
    return [...list].sort((a, b) =>
      (a.id === me.id ? -1 : b.id === me.id ? 1 : 0) ||
      order[a.role] - order[b.role] ||
      a.full_name.localeCompare(b.full_name));
  }, [deptPeople, userHasApp, fullView, myRole, me.id]);

  const canAssignTo = useCallback((id: string) => team.some(p => p.id === id), [team]);

  const createTask = useCallback(async (d: TaskDraft) => {
    const { data, error } = await supabase.from('tasks').insert(d).select().single();
    if (error) { fail(error); return null; }
    const t = data as Task;
    setTasks(ts => [...ts, t]);
    return t;
  }, [fail]);

  const updateTask = useCallback(async (id: number, patch: Partial<TaskDraft>) => {
    const prev = tasks;
    setTasks(ts => ts.map(t => (t.id === id ? { ...t, ...patch } : t)));
    const { data, error } = await supabase.from('tasks').update(patch).eq('id', id).select().maybeSingle();
    if (error || !data) {
      setTasks(prev);
      fail(error ?? new Error("You don't have permission to change that task."));
      return null;
    }
    const t = data as Task;
    setTasks(ts => ts.map(x => (x.id === id ? t : x)));
    refreshNotices();
    return t;
  }, [tasks, fail, refreshNotices]);

  const deleteTask = useCallback(async (id: number) => {
    const { error, count } = await supabase.from('tasks').delete({ count: 'exact' }).eq('id', id);
    if (error) { fail(error); return false; }
    if (count === 0) { toast('You can only delete tasks you created.', 'error'); return false; }
    setTasks(ts => ts.filter(t => t.id !== id));
    return true;
  }, [fail, toast]);

  const canDelete = useCallback((t: Task) => fullView || t.created_by === me.id, [fullView, me.id]);

  const value: TasksStore = {
    inDept, fullView, isLead, team, canAssignTo, tasks, loaded, refresh,
    createTask, updateTask, deleteTask, canDelete, drawer,
    openTask: (id) => setDrawer({ mode: 'edit', id }),
    newTask: (defaults = {}) => setDrawer({ mode: 'new', defaults }),
    closeDrawer: () => setDrawer(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Platform + Tasks data in one hook, for the Tasks app's pages. */
export const useTaskApp = () => ({ ...usePlatform(), ...useTasks() });
