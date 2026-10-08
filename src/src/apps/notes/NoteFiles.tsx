import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import { fileUrl, fileUrls, fmtSize, isImage, removeFiles, uploadFile, MAX_FILE_MB } from '../../platform/files';
import type { NoteAttachment } from './types';

/** Files attached to a page (images pasted into the text are kept separately as inline files) */
export function useNoteFiles(noteId: number, editable: boolean) {
  const { fail, toast } = usePlatform();
  const [items, setItems] = useState<NoteAttachment[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(0);

  const load = useCallback(async () => {
    const { data } = await supabase.from('notes_files').select('*').eq('note_id', noteId).eq('inline', false).order('created_at');
    const list = (data as NoteAttachment[]) ?? [];
    setItems(list);
    const imgs = list.filter(a => isImage(a.mime, a.name)).map(a => a.path);
    if (imgs.length) setUrls(await fileUrls(imgs));
  }, [noteId]);
  useEffect(() => { setItems([]); load(); }, [load]);

  const addFiles = useCallback(async (files: File[]) => {
    if (!editable) return toast('You can only view this page.', 'error');
    const ok = files.filter(f => f.size <= MAX_FILE_MB * 1024 * 1024);
    if (ok.length < files.length) toast(`Files larger than ${MAX_FILE_MB} MB were skipped.`, 'error');
    setBusy(b => b + ok.length);
    for (const f of ok) {
      const up = await uploadFile(`notes/${noteId}`, f);
      if ('error' in up) toast(up.error, 'error');
      else {
        const { error } = await supabase.from('notes_files')
          .insert({ note_id: noteId, name: f.name, path: up.path, size: f.size, mime: f.type || null, inline: false });
        if (error) { fail(error); removeFiles([up.path]); }
      }
      setBusy(b => b - 1);
    }
    load();
  }, [noteId, editable, toast, fail, load]);

  const remove = useCallback(async (a: NoteAttachment) => {
    const { error, count } = await supabase.from('notes_files').delete({ count: 'exact' }).eq('id', a.id);
    if (error || !count) return fail(error ?? new Error('You can only view this page.'));
    removeFiles([a.path]);
    setItems(xs => xs.filter(x => x.id !== a.id));
  }, [fail]);

  return { items, urls, busy, editable, addFiles, remove };
}

export default function NoteFiles({ files }: { files: ReturnType<typeof useNoteFiles> }) {
  const { items, urls, busy, editable, addFiles, remove } = files;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  if (!editable && items.length === 0) return null;

  async function open(a: NoteAttachment) {
    const u = await fileUrl(a.path);
    if (u) window.open(u, '_blank', 'noopener');
  }

  return (
    <section className={`note-section files ${over ? 'over' : ''}`}
      onDragOver={e => { if (editable && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { if (editable && e.dataTransfer.files.length) { e.preventDefault(); setOver(false); addFiles(Array.from(e.dataTransfer.files)); } }}>
      <div className="section-head">
        <span className="section-title">Files {items.length > 0 && <span className="count">{items.length}</span>}</span>
        {editable && <button type="button" className="btn sm" onClick={() => input.current?.click()}>Attach file</button>}
      </div>
      <input ref={input} type="file" multiple hidden onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      {items.length === 0 && !busy ? (
        <div className="files-empty">Drop files here or use Attach file. Up to {MAX_FILE_MB} MB each. Images pasted into the page appear in the text.</div>
      ) : (
        <div className="file-grid">
          {items.map(a => (
            <div key={a.id} className="file-item file">
              <button type="button" className="file-open" onClick={() => open(a)} title={a.name}>
                {isImage(a.mime, a.name) && urls[a.path]
                  ? <img src={urls[a.path]} alt={a.name} />
                  : <span className="file-icon">{(a.name.split('.').pop() ?? '').slice(0, 4).toUpperCase()}</span>}
                <span className="file-name">{a.name}</span>
                <span className="file-meta">{fmtSize(a.size)}</span>
              </button>
              {editable && <button type="button" className="file-x" onClick={() => remove(a)} aria-label={`Remove ${a.name}`}>✕</button>}
            </div>
          ))}
          {busy > 0 && <div className="file-item uploading"><div className="file-open"><span className="file-icon">…</span><span className="file-name">Uploading {busy}…</span></div></div>}
        </div>
      )}
    </section>
  );
}
