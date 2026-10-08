import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { niceError, supabase } from '../supabase';
import { PLATFORM_NAME } from './config';
import type { AppMember, AppRow, Department, DeptApp, DeptFeature, Notice, Profile } from './types';

type Toast = { id: number; text: string; kind: 'ok' | 'error' };

export interface Platform {
  me: Profile;
  isAdmin: boolean;
  departments: Department[];
  /** The department being viewed. Everyone except the admin is locked to their own. */
  dept: Department | null;
  setDeptId: (id: string) => void;
  profiles: Profile[];
  person: (id: string | null | undefined) => Profile | undefined;
  /** Approved people in the current department */
  deptPeople: Profile[];
  apps: AppRow[];
  deptApps: DeptApp[];
  appMembers: AppMember[];
  deptFeatures: DeptFeature[];
  userHasApp: (userId: string, appKey: string, deptId?: string) => boolean;
  /** App keys I can open in the current department */
  myAppKeys: string[];
  hasFeature: (featureKey: string, deptId?: string) => boolean;
  notices: Notice[];
  unread: number;
  markRead: (ids?: number[]) => Promise<void>;
  refreshNotices: () => Promise<void>;
  reload: () => Promise<void>;
  toasts: Toast[];
  toast: (text: string, kind?: 'ok' | 'error') => void;
  fail: (e: unknown) => void;
}

const Ctx = createContext<Platform | null>(null);
export const usePlatform = () => {
  const p = useContext(Ctx);
  if (!p) throw new Error('Platform missing');
  return p;
};

const DEPT_KEY = 'workspace.dept';
const readSaved = () => { try { return localStorage.getItem(DEPT_KEY); } catch { return null; } };
const save = (id: string) => { try { localStorage.setItem(DEPT_KEY, id); } catch { /* ignore */ } };

export function PlatformProvider({ me: initialMe, isAdmin, children }: { me: Profile; isAdmin: boolean; children: ReactNode }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([initialMe]);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [deptApps, setDeptApps] = useState<DeptApp[]>([]);
  const [appMembers, setAppMembers] = useState<AppMember[]>([]);
  const [deptFeatures, setDeptFeatures] = useState<DeptFeature[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [chosen, setChosen] = useState<string | null>(isAdmin ? readSaved() : null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, text, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);
  const fail = useCallback((e: unknown) => toast(niceError(e), 'error'), [toast]);

  const refreshNotices = useCallback(async () => {
    const { data } = await supabase.from('notifications').select('*')
      .eq('user_id', initialMe.id).order('created_at', { ascending: false }).limit(60);
    if (data) setNotices(data as Notice[]);
  }, [initialMe.id]);

  const reload = useCallback(async () => {
    const [d, p, a, da, am, df] = await Promise.all([
      supabase.from('departments').select('*').order('name'),
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('apps').select('*').order('sort'),
      supabase.from('department_apps').select('*'),
      supabase.from('app_members').select('*'),
      supabase.from('department_features').select('*'),
    ]);
    const err = [d, p, a, da, am, df].find(x => x.error)?.error;
    if (err) fail(err);
    if (d.data) setDepartments(d.data as Department[]);
    if (p.data) setProfiles(p.data as Profile[]);
    if (a.data) setApps(a.data as AppRow[]);
    if (da.data) setDeptApps(da.data as DeptApp[]);
    if (am.data) setAppMembers(am.data as AppMember[]);
    if (df.data) setDeptFeatures(df.data as DeptFeature[]);
    setLoaded(true);
  }, [fail]);

  useEffect(() => {
    reload();
    refreshNotices();
    const tick = () => { if (document.visibilityState === 'visible') { reload(); refreshNotices(); } };
    const timer = setInterval(tick, 60_000);
    const pushed = () => refreshNotices();   // a phone alert just arrived while the app is open
    window.addEventListener('focus', tick);
    window.addEventListener('workspace:pushed', pushed);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      window.removeEventListener('workspace:pushed', pushed);
    };
  }, [reload, refreshNotices]);

  const me = profiles.find(p => p.id === initialMe.id) ?? initialMe;
  const person = useCallback((id: string | null | undefined) => profiles.find(p => p.id === id), [profiles]);

  // which department are we looking at?
  const dept = useMemo(() => {
    if (!isAdmin) return departments.find(d => d.id === me.department_id) ?? null;
    return departments.find(d => d.id === chosen)
      ?? departments.find(d => d.id === me.department_id)
      ?? departments[0] ?? null;
  }, [isAdmin, departments, chosen, me.department_id]);

  const setDeptId = useCallback((id: string) => {
    if (!isAdmin) return;
    setChosen(id);
    save(id);
  }, [isAdmin]);

  const deptPeople = useMemo(
    () => profiles.filter(p => p.active && dept && p.department_id === dept.id),
    [profiles, dept]);

  const userHasApp = useCallback((userId: string, appKey: string, deptId = dept?.id) => {
    if (!deptId) return false;
    const p = profiles.find(x => x.id === userId);
    if (!p || !p.active || p.department_id !== deptId) return false;
    const da = deptApps.find(x => x.department_id === deptId && x.app_key === appKey);
    if (!da) return false;
    return da.everyone || appMembers.some(m => m.department_id === deptId && m.app_key === appKey && m.user_id === userId);
  }, [profiles, deptApps, appMembers, dept?.id]);

  const myAppKeys = useMemo(() => {
    if (!dept) return [];
    return apps
      .filter(a => isAdmin
        ? deptApps.some(x => x.department_id === dept.id && x.app_key === a.key)
        : userHasApp(me.id, a.key, dept.id))
      .map(a => a.key);
  }, [apps, deptApps, dept, isAdmin, me.id, userHasApp]);

  const hasFeature = useCallback((key: string, deptId = dept?.id) =>
    !!deptId && deptFeatures.some(f => f.department_id === deptId && f.feature_key === key), [deptFeatures, dept?.id]);

  const markRead = useCallback(async (ids?: number[]) => {
    const now = new Date().toISOString();
    const targets = ids ?? notices.filter(n => !n.read_at).map(n => n.id);
    if (!targets.length) return;
    setNotices(ns => ns.map(n => (targets.includes(n.id) ? { ...n, read_at: n.read_at ?? now } : n)));
    await supabase.from('notifications').update({ read_at: now }).in('id', targets);
  }, [notices]);

  const unread = notices.filter(n => !n.read_at).length;
  useEffect(() => {
    document.title = unread ? `(${unread}) ${PLATFORM_NAME}` : PLATFORM_NAME;
    // the number on the installed app's icon
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    (unread ? nav.setAppBadge?.(unread) : nav.clearAppBadge?.())?.catch(() => { /* not supported */ });
  }, [unread]);

  if (!loaded) return <div className="splash">Loading…</div>;

  const value: Platform = {
    me, isAdmin, departments, dept, setDeptId, profiles, person, deptPeople,
    apps, deptApps, appMembers, deptFeatures, userHasApp, myAppKeys, hasFeature,
    notices, unread, markRead, refreshNotices, reload, toasts, toast, fail,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
