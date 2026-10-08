import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import { removeFiles } from '../../platform/files';
import { NOTE_COLS, type Access, type NoteRow, type NoteShare } from './types';

interface NotesStore {
  /** I belong to the department being viewed (the admin visiting another one can only read) */
  inDept: boolean;
  notes: NoteRow[];
  shares: NoteShare[];
  loaded: boolean;
  refresh: () => Promise<void>;
  byId: (id: number | null | undefined) => NoteRow | undefined;
  rootOf: (n: NoteRow) => NoteRow;
  childrenOf: (id: number | null) => NoteRow[];
  /** 'edit', 'view' or null — mirrors notes_access() in the database */
  accessOf: (n: NoteRow) => Access | null;
  createNote: (parentId?: number | null, title?: string) => Promise<NoteRow | null>;
  deleteNote: (n: NoteRow) => Promise<boolean>;
  patchLocal: (id: number, patch: Partial<NoteRow>) => void;
}

const Ctx = createContext<NotesStore | null>(null);
export const useNotes = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('Notes store missing');
  return s;
};
export const useNotesApp = () => ({ ...usePlatform(), ...useNotes() });

export function NotesProvider({ children }: { children: ReactNode }) {
  const { me, isAdmin, dept, fail, toast } = usePlatform();
  const deptId = dept!.id;
  const inDept = me.department_id === deptId;
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [shares, setShares] = useState<NoteShare[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.from('notes_pages').select(NOTE_COLS)
      .eq('department_id', deptId).order('position').order('id');
    if (error) return fail(error);
    const list = (data as NoteRow[]) ?? [];
    setNotes(list);
    const ids = new Set(list.map(n => n.id));
    const s = await supabase.from('notes_shares').select('*');
    if (s.data) setShares((s.data as NoteShare[]).filter(x => ids.has(x.note_id)));
    setLoaded(true);
  }, [deptId, fail]);

  useEffect(() => {
    refresh();
    const tick = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [refresh]);

  const map = useMemo(() => new Map(notes.map(n => [n.id, n])), [notes]);
  const byId = useCallback((id: number | null | undefined) => (id == null ? undefined : map.get(id)), [map]);
  const rootOf = useCallback((n: NoteRow) => map.get(n.root_id ?? n.id) ?? n, [map]);
  const childrenOf = useCallback((id: number | null) =>
    notes.filter(n => n.parent_id === id).sort((a, b) => a.position - b.position || a.id - b.id), [notes]);

  const myShare = useMemo(() => new Map(shares.filter(s => s.user_id === me.id).map(s => [s.note_id, s.access])), [shares, me.id]);
  const accessOf = useCallback((n: NoteRow): Access | null => {
    const root = rootOf(n);
    if (root.owner_id === me.id && inDept) return 'edit';
    if (isAdmin) return 'view';
    if (root.share_scope === 'department') return root.dept_access;
    if (root.share_scope === 'people') return myShare.get(root.id) ?? null;
    return null;
  }, [rootOf, me.id, inDept, isAdmin, myShare]);

  const createNote = useCallback(async (parentId: number | null = null, title = '') => {
    const siblings = notes.filter(n => n.parent_id === parentId);
    const position = siblings.reduce((m, n) => Math.max(m, n.position), 0) + 1;
    const { data, error } = await supabase.from('notes_pages')
      .insert({ parent_id: parentId, title, position }).select(NOTE_COLS).single();
    if (error) { fail(error); return null; }
    const n = data as NoteRow;
    setNotes(ns => [...ns, n]);
    return n;
  }, [notes, fail]);

  const deleteNote = useCallback(async (n: NoteRow) => {
    // the page and every page under it
    const ids: number[] = [];
    const walk = (id: number) => { ids.push(id); notes.filter(x => x.parent_id === id).forEach(x => walk(x.id)); };
    walk(n.id);
    // stored files go first: once the page is gone, nobody may touch its folder any more
    const { data: files } = await supabase.from('notes_files').select('path').in('note_id', ids);
    await removeFiles(((files ?? []) as { path: string }[]).map(f => f.path));
    const { error, count } = await supabase.from('notes_pages').delete({ count: 'exact' }).eq('id', n.id);
    if (error) { fail(error); return false; }
    if (!count) { toast("You don't have permission to delete this page.", 'error'); return false; }
    setNotes(ns => ns.filter(x => !ids.includes(x.id)));
    return true;
  }, [notes, fail, toast]);

  const patchLocal = useCallback((id: number, patch: Partial<NoteRow>) =>
    setNotes(ns => ns.map(n => (n.id === id ? { ...n, ...patch } : n))), []);

  const value: NotesStore = {
    inDept, notes, shares, loaded, refresh, byId, rootOf, childrenOf, accessOf, createNote, deleteNote, patchLocal,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
