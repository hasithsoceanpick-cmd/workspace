import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/core';
import { supabase } from '../../supabase';
import { go } from '../../lib/route';
import { ago } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import { uploadFile } from '../../platform/files';
import Avatar from '../../platform/Avatar';
import { useNotesApp } from './store';
import { NOTE_COLS, untitled, type Note, type NoteRow } from './types';
import NoteEditor from './Editor';
import NoteFiles, { useNoteFiles } from './NoteFiles';
import LinkedTasks from './LinkedTasks';
import ShareDialog, { shareLabel } from './ShareDialog';

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

export default function NotePage({ row }: { row: NoteRow }) {
  const app = useNotesApp();
  const { me, person, accessOf, rootOf, byId, childrenOf, createNote, deleteNote, patchLocal, fail, toast, myAppKeys, shares } = app;
  const id = row.id;
  const access = accessOf(row);
  const editable = access === 'edit';
  const root = rootOf(row);
  const isRootOwner = root.owner_id === me.id && editable;
  const canDelete = editable && (row.parent_id !== null || row.owner_id === me.id);

  const [note, setNote] = useState<Note | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [title, setTitle] = useState(row.title);
  const [state, setState] = useState<SaveState>('saved');
  const [sharing, setSharing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const base = useRef('');                                     // updated_at of the version we're editing
  const pending = useRef<{ title?: string; content?: JSONContent }>({});
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef<Promise<void> | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const savedDoc = useRef('');                                  // content as last loaded/saved, to skip no-op saves
  const files = useNoteFiles(id, editable);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('notes_pages').select('*').eq('id', id).maybeSingle();
    if (error) return fail(error);
    if (!data) return;
    const n = data as Note;
    base.current = n.updated_at;
    savedDoc.current = JSON.stringify(n.content ?? {});
    pending.current = {};
    setNote(n);
    setTitle(n.title);
    setEditorKey(k => k + 1);
    setState('saved');
  }, [id, fail]);

  useEffect(() => { setNote(null); load(); }, [load]);

  // ---------- autosave ----------
  const flush = useCallback(async (force = false): Promise<void> => {
    window.clearTimeout(timer.current);
    if (inflight.current) await inflight.current;
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    pending.current = {};
    setState('saving');
    const run = (async () => {
      let q = supabase.from('notes_pages').update(patch).eq('id', id);
      if (!force) q = q.eq('updated_at', base.current);   // someone else saved in between → don't overwrite
      const { data, error } = await q.select(NOTE_COLS).maybeSingle();
      if (error || !data) {
        pending.current = { ...patch, ...pending.current };
        setState(error ? 'error' : 'conflict');
        if (error) fail(error);
        return;
      }
      const saved = data as NoteRow;
      base.current = saved.updated_at;
      patchLocal(id, saved);
      setState(Object.keys(pending.current).length ? 'unsaved' : 'saved');
    })();
    inflight.current = run;
    await run;
    inflight.current = null;
  }, [id, fail, patchLocal]);

  const queue = useCallback((patch: { title?: string; content?: JSONContent }) => {
    Object.assign(pending.current, patch);
    setState(s => (s === 'conflict' ? s : 'unsaved'));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void flush(); }, 800);
  }, [flush]);

  // save when leaving the page, warn when closing the tab with unsaved work
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (Object.keys(pending.current).length) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); void flush(); };
  }, [flush]);

  // someone else changed this page and I have nothing unsaved → show their version
  useEffect(() => {
    if (!note || state !== 'saved' || !base.current || row.updated_at <= base.current) return;
    const focused = document.activeElement?.closest('.note-main');
    if (!focused) load();
  }, [row.updated_at, note, state, load]);

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
  }, [title, note]);

  async function uploadImage(f: File) {
    const up = await uploadFile(`notes/${id}`, f);
    if ('error' in up) { toast(up.error, 'error'); return null; }
    const { error } = await supabase.from('notes_files')
      .insert({ note_id: id, name: f.name, path: up.path, size: f.size, mime: f.type || null, inline: true });
    if (error) { fail(error); return null; }
    return up.path;
  }

  async function addSubPage() {
    await flush();
    const n = await createNote(id);
    if (n) go('notes', '', { note: String(n.id) });
  }

  async function remove() {
    await flush();
    if (await deleteNote(row)) {
      toast('Page deleted');
      go('notes', '', row.parent_id ? { note: String(row.parent_id) } : {});
    }
  }

  // breadcrumb: top-level page › … › this page
  const trail: NoteRow[] = [];
  for (let p = byId(row.parent_id); p; p = byId(p.parent_id)) trail.unshift(p);
  const kids = childrenOf(id);
  const owner = person(row.owner_id);
  const editor = person(row.updated_by);
  const label = shareLabel(root, shares, me.id, access);

  return (
    <article className="note-main">
      <div className="note-top">
        <nav className="crumbs" aria-label="Page path">
          {trail.map(p => (
            <span key={p.id}><button className="link" onClick={() => go('notes', '', { note: String(p.id) })}>{untitled(p.title)}</button> › </span>
          ))}
          <span className="muted">{untitled(title)}</span>
        </nav>
        <div className="row gap note-actions">
          <span className={`save-state s-${state}`} aria-live="polite">
            {state === 'saving' ? 'Saving…' : state === 'unsaved' ? 'Editing…' : state === 'error' ? "Couldn't save" : state === 'conflict' ? 'Not saved' : editable ? 'Saved' : 'View only'}
          </span>
          {row.parent_id === null && isRootOwner ? (
            <button className="btn sm share-btn" onClick={() => setSharing(true)}>{label}</button>
          ) : (
            <span className="share-tag" title={row.parent_id !== null ? `Sharing follows “${untitled(root.title)}”` : undefined}>{label}</span>
          )}
          {editable && <button className="btn sm" onClick={addSubPage}>+ Sub-page</button>}
          {canDelete && (confirmDel ? (
            <span className="confirm-inline">
              <span className="small">Delete{kids.length ? ' with its sub-pages' : ''}?</span>
              <button className="btn danger sm" onClick={remove}>Delete</button>
              <button className="btn sm" onClick={() => setConfirmDel(false)}>Keep</button>
            </span>
          ) : <button className="btn sm ghost-danger" onClick={() => setConfirmDel(true)}>Delete</button>)}
        </div>
      </div>

      {state === 'conflict' && (
        <div className="conflict-bar">
          <span>Someone else changed this page while you were editing.</span>
          <button className="btn sm" onClick={load}>Show their version</button>
          <button className="btn sm primary" onClick={() => flush(true)}>Keep mine</button>
        </div>
      )}

      <textarea ref={titleRef} className="note-title" rows={1} placeholder="Untitled page" value={title}
        readOnly={!editable} aria-label="Page title"
        onChange={e => { setTitle(e.target.value); patchLocal(id, { title: e.target.value }); queue({ title: e.target.value }); }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (document.querySelector('.note-doc') as HTMLElement | null)?.focus(); } }} />
      <div className="note-meta muted small">
        {row.owner_id !== me.id && <><Avatar p={owner} size={18} /> {owner?.full_name ?? 'Former member'}'s page · </>}
        Edited {ago(row.updated_at)}{editor && row.updated_by !== row.owner_id ? ` by ${row.updated_by === me.id ? 'you' : firstName(editor.full_name)}` : ''}
      </div>

      {note ? (
        <NoteEditor key={`${id}-${editorKey}`} content={note.content} editable={editable}
          onChange={doc => {
            const json = JSON.stringify(doc);
            if (!editable || json === savedDoc.current) return;
            savedDoc.current = json;
            queue({ content: doc });
          }}
          uploadImage={uploadImage}
          attachFiles={fs => files.addFiles(fs)} />
      ) : <div className="empty">Loading…</div>}

      {(kids.length > 0 || editable) && (
        <section className="note-section">
          <div className="section-head">
            <span className="section-title">Sub-pages {kids.length > 0 && <span className="count">{kids.length}</span>}</span>
            {editable && <button className="btn sm" onClick={addSubPage}>+ Add sub-page</button>}
          </div>
          {kids.length === 0 ? <div className="muted small">No sub-pages yet.</div> : (
            <ul className="subpages">
              {kids.map(k => (
                <li key={k.id}><button className="link" onClick={() => go('notes', '', { note: String(k.id) })}>📄 {untitled(k.title)}</button></li>
              ))}
            </ul>
          )}
        </section>
      )}

      <NoteFiles files={files} />
      {myAppKeys.includes('tasks') && <LinkedTasks noteId={id} departmentId={row.department_id} />}

      {sharing && <ShareDialog note={row} onClose={() => setSharing(false)} />}
    </article>
  );
}
