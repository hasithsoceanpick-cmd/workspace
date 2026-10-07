import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import { removeFiles } from '../../platform/files';
import type { Profile } from '../../platform/types';
import type { Task, TaskDraft, TaskHelper } from './types';

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
  /** helpers per task id */
  helpersOf: (taskId: number) => string[];
  /** I'm only a helper on this task (can't change it, can't mark it done) */
  helperOnly: (t: Task) => boolean;
  /** People I may add as helpers to this task (managers/seniors only) */
  helperCandidates: (t: Pick<Task, 'assignee_id'>) => Profile[];
  addHelper: (taskId: number, userId: string) => Promise<boolean>;
  removeHelper: (taskId: number, userId: string) => Promise<boolean>;
  /** checklist progress per task id */
  progressOf: (taskId: number) => { done: number; total: number } | null;
  refreshChecklist: () => Promise<void>;
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
  const { me, isAdmin, dept, deptPeople, person, userHasApp, fail, toast, refreshNotices } = usePlatform();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [helpers, setHelpers] = useState<TaskHelper[]>([]);
  const [steps, setSteps] = useState<{ task_id: number; done: boolean }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState>(null);

  const deptId = dept!.id;
  const inDept = me.department_id === deptId;
  const myRole = inDept ? me.role : null;
  const fullView = isAdmin || myRole === 'manager';
  const isLead = fullView || myRole === 'senior';

  const refreshChecklist = useCallback(async () => {
    const { data } = await supabase.from('task_checklist').select('task_id,done').eq('department_id', deptId);
    if (data) setSteps(data as { task_id: number; done: boolean }[]);
  }, [deptId]);

  const refresh = useCallback(async () => {
    const [t, h] = await Promise.all([
      supabase.from('tasks').select('*').eq('department_id', deptId).order('due_date').order('id'),
      supabase.from('task_helpers').select('*').eq('department_id', deptId),
    ]);
    if (t.error) return fail(t.error);
    setTasks(t.data as Task[]);
    if (h.data) setHelpers(h.data as TaskHelper[]);
    setLoaded(true);
    refreshChecklist();
  }, [deptId, fail, refreshChecklist]);

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

  const helpersByTask = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const h of helpers) {
      if (!m.has(h.task_id)) m.set(h.task_id, []);
      m.get(h.task_id)!.push(h.user_id);
    }
    return m;
  }, [helpers]);
  const helpersOf = useCallback((id: number) => helpersByTask.get(id) ?? [], [helpersByTask]);

  // Mirrors the database rule: owner, creator, managers, and seniors (for members' work) run a task.
  const runsTask = useCallback((t: Task) =>
    fullView || t.assignee_id === me.id || t.created_by === me.id ||
    (myRole === 'senior' && person(t.assignee_id)?.role === 'member'), [fullView, me.id, myRole, person]);
  const helperOnly = useCallback((t: Task) => !runsTask(t), [runsTask]);

  const helperCandidates = useCallback((t: Pick<Task, 'assignee_id'>) => {
    if (!isLead) return [];
    return team.filter(p => p.id !== t.assignee_id);
  }, [isLead, team]);

  const addHelper = useCallback(async (taskId: number, userId: string) => {
    const { data, error } = await supabase.from('task_helpers').insert({ task_id: taskId, user_id: userId }).select().single();
    if (error) { fail(error); return false; }
    setHelpers(hs => [...hs, data as TaskHelper]);
    return true;
  }, [fail]);

  const removeHelper = useCallback(async (taskId: number, userId: string) => {
    const { error, count } = await supabase.from('task_helpers').delete({ count: 'exact' })
      .eq('task_id', taskId).eq('user_id', userId);
    if (error || !count) { fail(error ?? new Error("You don't have permission to remove that helper.")); return false; }
    setHelpers(hs => hs.filter(h => !(h.task_id === taskId && h.user_id === userId)));
    return true;
  }, [fail]);

  const progress = useMemo(() => {
    const m = new Map<number, { done: number; total: number }>();
    for (const s of steps) {
      const p = m.get(s.task_id) ?? { done: 0, total: 0 };
      p.total += 1;
      if (s.done) p.done += 1;
      m.set(s.task_id, p);
    }
    return m;
  }, [steps]);
  const progressOf = useCallback((id: number) => progress.get(id) ?? null, [progress]);

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
    if (patch.assignee_id) refresh();
    refreshNotices();
    return t;
  }, [tasks, fail, refreshNotices, refresh]);

  const canDelete = useCallback((t: Task) => fullView || t.created_by === me.id, [fullView, me.id]);

  const deleteTask = useCallback(async (id: number) => {
    const t = tasks.find(x => x.id === id);
    if (!t || !canDelete(t)) { toast('You can only delete tasks you created.', 'error'); return false; }
    // stored files go first: once the task is gone, nobody may touch its folder any more
    const { data: files } = await supabase.from('task_attachments').select('path').eq('task_id', id).eq('kind', 'file');
    await removeFiles(((files ?? []) as { path: string }[]).map(f => f.path));
    const { error, count } = await supabase.from('tasks').delete({ count: 'exact' }).eq('id', id);
    if (error) { fail(error); return false; }
    if (count === 0) { toast('You can only delete tasks you created.', 'error'); return false; }
    setTasks(ts => ts.filter(x => x.id !== id));
    return true;
  }, [tasks, canDelete, fail, toast]);

  const value: TasksStore = {
    inDept, fullView, isLead, team, canAssignTo, tasks, loaded, refresh,
    createTask, updateTask, deleteTask, canDelete,
    helpersOf, helperOnly, helperCandidates, addHelper, removeHelper,
    progressOf, refreshChecklist,
    drawer,
    openTask: (id) => setDrawer({ mode: 'edit', id }),
    newTask: (defaults = {}) => setDrawer({ mode: 'new', defaults }),
    closeDrawer: () => setDrawer(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Platform + Tasks data in one hook, for the Tasks app's pages. */
export const useTaskApp = () => ({ ...usePlatform(), ...useTasks() });
