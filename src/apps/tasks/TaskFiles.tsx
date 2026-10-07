import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import { fileUrl, fileUrls, fmtSize, isImage, normaliseUrl, removeFiles, uploadFile, MAX_FILE_MB } from '../../platform/files';
import type { TaskAttachment } from './types';

type Pending =
  | { key: string; kind: 'file'; file: File; preview: string | null }
  | { key: string; kind: 'link'; name: string; url: string };

/** Files, screenshots and links on a task. Before the task exists they are queued and saved on create. */
export function useTaskFiles(taskId: number | null) {
  const { fail, toast } = usePlatform();
  const [items, setItems] = useState<TaskAttachment[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(0);

  const load = useCallback(async () => {
    if (!taskId) return;
    const { data } = await supabase.from('task_attachments').select('*').eq('task_id', taskId).order('created_at');
    const list = (data as TaskAttachment[]) ?? [];
    setItems(list);
    const imgs = list.filter(a => a.kind === 'file' && isImage(a.mime, a.name)).map(a => a.path!);
    if (imgs.length) setUrls(await fileUrls(imgs));
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  async function saveFile(id: number, f: File) {
    const up = await uploadFile(`tasks/${id}`, f);
    if ('error' in up) { toast(up.error, 'error'); return; }
    const { error } = await supabase.from('task_attachments')
      .insert({ task_id: id, kind: 'file', name: f.name, path: up.path, size: f.size, mime: f.type || null });
    if (error) { fail(error); removeFiles([up.path]); }
  }

  const addFiles = useCallback(async (files: File[]) => {
    const tooBig = files.filter(f => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig.length) toast(`${tooBig.map(f => f.name).join(', ')}: larger than ${MAX_FILE_MB} MB`, 'error');
    const okFiles = files.filter(f => f.size <= MAX_FILE_MB * 1024 * 1024);
    if (!okFiles.length) return;
    if (!taskId) {
      setPending(p => [...p, ...okFiles.map(f => ({
        key: Math.random().toString(36).slice(2), kind: 'file' as const, file: f,
        preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      }))]);
      return;
    }
    setBusy(b => b + okFiles.length);
    for (const f of okFiles) { await saveFile(taskId, f); setBusy(b => b - 1); }
    load();
  }, [taskId, load, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const addLink = useCallback(async (name: string, url: string) => {
    const u = normaliseUrl(url);
    const n = name.trim() || u.replace(/^https?:\/\//, '').slice(0, 60);
    if (!u) return false;
    if (!taskId) {
      setPending(p => [...p, { key: Math.random().toString(36).slice(2), kind: 'link', name: n, url: u }]);
      return true;
    }
    const { error } = await supabase.from('task_attachments').insert({ task_id: taskId, kind: 'link', name: n, url: u });
    if (error) { fail(error); return false; }
    load();
    return true;
  }, [taskId, load, fail]);

  const remove = useCallback(async (a: TaskAttachment) => {
    const { error, count } = await supabase.from('task_attachments').delete({ count: 'exact' }).eq('id', a.id);
    if (error || !count) return fail(error ?? new Error('You can only remove files you added.'));
    if (a.path) removeFiles([a.path]);
    setItems(xs => xs.filter(x => x.id !== a.id));
  }, [fail]);

  const removePending = (key: string) => setPending(p => p.filter(x => x.key !== key));

  /** Save everything queued while the task was being created */
  const flush = useCallback(async (id: number) => {
    for (const p of pending) {
      if (p.kind === 'file') await saveFile(id, p.file);
      else await supabase.from('task_attachments').insert({ task_id: id, kind: 'link', name: p.name, url: p.url });
    }
    setPending([]);
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  return { items, urls, pending, busy, addFiles, addLink, remove, removePending, flush };
}

export function TaskFiles({ files, canRemove }: {
  files: ReturnType<typeof useTaskFiles>;
  canRemove: (a: TaskAttachment) => boolean;
}) {
  const { items, urls, pending, busy, addFiles, addLink, remove, removePending } = files;
  const input = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState({ name: '', url: '' });
  const [dragOver, setDragOver] = useState(false);

  async function open(a: TaskAttachment) {
    if (a.kind === 'link') return window.open(a.url!, '_blank', 'noopener');
    const u = await fileUrl(a.path!);
    if (u) window.open(u, '_blank', 'noopener');
  }

  const count = items.length + pending.length;

  return (
    <section className={`files ${dragOver ? 'over' : ''}`}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragOver(false); addFiles(Array.from(e.dataTransfer.files)); } }}>
      <div className="section-head">
        <span className="section-title">Files &amp; links {count > 0 && <span className="count">{count}</span>}</span>
        <div className="row gap">
          <button type="button" className="btn sm" onClick={() => input.current?.click()}>Attach file</button>
          <button type="button" className="btn sm" onClick={() => setLinkOpen(o => !o)}>Add link</button>
        </div>
      </div>
      <input ref={input} type="file" multiple hidden onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />

      {linkOpen && (
        <form className="link-form" onSubmit={async e => {
          e.preventDefault();
          if (await addLink(link.name, link.url)) { setLink({ name: '', url: '' }); setLinkOpen(false); }
        }}>
          <input type="text" placeholder="Name (optional)" value={link.name} onChange={e => setLink(l => ({ ...l, name: e.target.value }))} aria-label="Link name" />
          <input type="text" placeholder="https://…" value={link.url} onChange={e => setLink(l => ({ ...l, url: e.target.value }))} aria-label="Link address" autoFocus />
          <button className="btn primary sm" disabled={!link.url.trim()}>Add</button>
        </form>
      )}

      {count === 0 && !busy ? (
        <div className="files-empty">Paste a screenshot here with <kbd>Ctrl</kbd>+<kbd>V</kbd>, drop files, or use the buttons. Up to 10 MB each.</div>
      ) : (
        <div className="file-grid">
          {items.map(a => (
            <div key={a.id} className={`file-item ${a.kind}`}>
              <button type="button" className="file-open" onClick={() => open(a)} title={a.kind === 'link' ? a.url! : a.name}>
                {a.kind === 'file' && isImage(a.mime, a.name) && urls[a.path!]
                  ? <img src={urls[a.path!]} alt={a.name} />
                  : <span className="file-icon">{a.kind === 'link' ? '↗' : (a.name.split('.').pop() ?? '').slice(0, 4).toUpperCase()}</span>}
                <span className="file-name">{a.name}</span>
                <span className="file-meta">{a.kind === 'link' ? a.url!.replace(/^https?:\/\//, '').slice(0, 40) : fmtSize(a.size)}</span>
              </button>
              {canRemove(a) && <button type="button" className="file-x" onClick={() => remove(a)} aria-label={`Remove ${a.name}`}>✕</button>}
            </div>
          ))}
          {pending.map(p => (
            <div key={p.key} className={`file-item ${p.kind} pending`}>
              <div className="file-open">
                {p.kind === 'file' && p.preview ? <img src={p.preview} alt={p.file.name} /> : <span className="file-icon">{p.kind === 'link' ? '↗' : 'FILE'}</span>}
                <span className="file-name">{p.kind === 'file' ? p.file.name : p.name}</span>
                <span className="file-meta">saved with the task</span>
              </div>
              <button type="button" className="file-x" onClick={() => removePending(p.key)} aria-label="Remove">✕</button>
            </div>
          ))}
          {busy > 0 && <div className="file-item uploading"><div className="file-open"><span className="file-icon">…</span><span className="file-name">Uploading {busy}…</span></div></div>}
        </div>
      )}
    </section>
  );
}
