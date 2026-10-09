import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import { removeFiles } from '../../platform/files';
import type { Profile } from '../../platform/types';
import type { Task, TaskDraft, TaskFollow, TaskHelper } from './types';

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
  /** May I sign this task off? (whoever gave it, a manager, the admin — never its owner) */
  canCheck: (t: Task) => boolean;
  /** Who is asked to sign it off */
  checkerOf: (t: Task) => Profile | undefined;
  /** "Got it": the owner has seen a task someone gave them */
  acknowledge: (id: number) => Promise<void>;
  sendBack: (id: number, reason: string) => Promise<boolean>;
  /** Given to me by someone else and I haven't pressed Got it yet: lives only in the New tab */
  inInbox: (t: Task) => boolean;
  inbox: Task[];
  /** my pin / follow marks */
  marks: (taskId: number) => { pinned: boolean; following: boolean };
  setMark: (taskId: number, patch: { pinned?: boolean; following?: boolean }) => Promise<void>;
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
  const [follows, setFollows] = useState<TaskFollow[]>([]);
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
    const [t, h, f] = await Promise.all([
      supabase.from('tasks').select('*').eq('department_id', deptId).order('due_date').order('id'),
      supabase.from('task_helpers').select('*').eq('department_id', deptId),
      supabase.from('task_follows').select('*').eq('user_id', me.id),
    ]);
    if (t.error) return fail(t.error);
    setTasks(t.data as Task[]);
    if (h.data) setHelpers(h.data as TaskHelper[]);
    if (f.data) setFollows(f.data as TaskFollow[]);
    setLoaded(true);
    refreshChecklist();
  }, [deptId, fail, refreshChecklist, me.id]);

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
    const was = prev.find(x => x.id === id);
    // reassigned, or a repeating task finished (its next one was just created): reload the list
    if (patch.assignee_id || (t.status === 'done' && was?.status !== 'done' && was?.repeat && !was.next_task_id)) refresh();
    refreshNotices();
    return t;
  }, [tasks, fail, refreshNotices, refresh]);

  const canDelete = useCallback((t: Task) => fullView || t.created_by === me.id, [fullView, me.id]);

  const inInbox = useCallback((t: Task) =>
    t.assignee_id === me.id && !t.acknowledged_at && t.created_by !== me.id && t.status !== 'done' && t.status !== 'review',
  [me.id]);
  const inbox = useMemo(() => tasks.filter(inInbox).sort((a, b) => a.due_date.localeCompare(b.due_date)), [tasks, inInbox]);

  const marks = useCallback((id: number) => {
    const f = follows.find(x => x.task_id === id);
    return { pinned: !!f?.pinned, following: !!f?.following };
  }, [follows]);
  const setMark = useCallback(async (id: number, patch: { pinned?: boolean; following?: boolean }) => {
    const had = follows.find(x => x.task_id === id);
    const next = { pinned: patch.pinned ?? !!had?.pinned, following: patch.following ?? !!had?.following };
    setFollows(fs => had ? fs.map(x => (x.task_id === id ? { ...x, ...next } : x))
      : [...fs, { task_id: id, user_id: me.id, department_id: deptId, ...next }]);
    const res = had
      ? await supabase.from('task_follows').update(next).eq('task_id', id).eq('user_id', me.id)
      : await supabase.from('task_follows').insert({ task_id: id, ...next });
    if (res.error) { fail(res.error); refresh(); }
  }, [follows, me.id, deptId, fail, refresh]);

  const canCheck = useCallback((t: Task) =>
    t.assignee_id !== me.id && (isAdmin || (inDept && (t.created_by === me.id || myRole === 'manager'))),
  [me.id, isAdmin, inDept, myRole]);

  const checkerOf = useCallback((t: Task) => {
    const giver = person(t.created_by);
    if (giver?.active) return giver;           // (in another department only when it's the admin)
    return deptPeople.find(p => p.role === 'manager');
  }, [person, deptPeople]);

  const acknowledge = useCallback(async (id: number) => {
    const now = new Date().toISOString();
    setTasks(ts => ts.map(t => (t.id === id ? { ...t, acknowledged_at: t.acknowledged_at ?? now } : t)));
    const { data, error } = await supabase.from('tasks').update({ acknowledged_at: now }).eq('id', id).select().maybeSingle();
    if (error) return fail(error);
    if (data) setTasks(ts => ts.map(t => (t.id === id ? data as Task : t)));
  }, [fail]);

  const sendBack = useCallback(async (id: number, reason: string) => {
    const { error } = await supabase.rpc('tasks_send_back', { p_task: id, p_reason: reason });
    if (error) { fail(error); return false; }
    await refresh();
    refreshNotices();
    return true;
  }, [fail, refresh, refreshNotices]);

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
    progressOf, refreshChecklist, canCheck, checkerOf, acknowledge, sendBack, inInbox, inbox, marks, setMark,
    drawer,
    openTask: (id) => setDrawer({ mode: 'edit', id }),
    newTask: (defaults = {}) => setDrawer({ mode: 'new', defaults }),
    closeDrawer: () => setDrawer(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Platform + Tasks data in one hook, for the Tasks app's pages. */
export const useTaskApp = () => ({ ...usePlatform(), ...useTasks() });
