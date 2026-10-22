import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import Avatar from '../../platform/Avatar';
import { clipboardFiles, fmtSize, removeFiles, uploadFile } from '../../platform/files';
import { MESSAGE_ATTACH, MESSAGE_WORK, type WorkItem, type WorkKind } from '../../platform/slots';
import type { Profile } from '../../platform/types';
import { firstName } from '../../lib/labels';
import { workName } from './Card';
import type { Msg, ThreadInfo } from './types';

interface Props {
  info: ThreadInfo;
  /** everyone in the conversation (team: the department's people with Messages) */
  members: Profile[];
  canPost: boolean;
  /** why not, when canPost is false */
  closedNote?: string;
  replyTo: Msg | null;
  onCancelReply: () => void;
  editing: Msg | null;
  onCancelEdit: () => void;
  onSent: () => void;
  /** may I give work ("Send as") to this person? */
  mayGive: (id: string) => boolean;
}

const touch = () => window.matchMedia('(hover: none)').matches;

/** The message box: words, @mentions, files and screenshots, attached work, "Send as", replies and edits. */
export default function Composer(p: Props) {
  const { me, myAppKeys, person, fail, toast } = usePlatform();
  const { info } = p;
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [cards, setCards] = useState<WorkItem[]>([]);
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [mq, setMq] = useState<{ q: string; at: number } | null>(null);
  const [msel, setMsel] = useState(0);
  const [menu, setMenu] = useState<'attach' | 'send' | null>(null);
  const [picker, setPicker] = useState<WorkKind | null>(null);
  const [sendAs, setSendAs] = useState<WorkKind | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const caretTo = useRef<number | null>(null);

  const others = useMemo(() => p.members.filter(x => x.id !== me.id), [p.members, me.id]);
  const audience = info.kind === 'direct' ? (info.other_id ? [info.other_id] : []) : others.map(x => x.id);
  const attachers = MESSAGE_ATTACH.filter(a => myAppKeys.includes(a.app));
  const makers = MESSAGE_WORK.filter(a => myAppKeys.includes(a.app));
  const givable = info.kind === 'direct' ? audience.filter(p.mayGive) : others.map(x => x.id).filter(p.mayGive);
  const sendKinds = info.kind === 'announce' || !givable.length ? [] : makers;

  // editing: the box holds that message's words
  useEffect(() => {
    if (p.editing) { setText(p.editing.body); setTimeout(() => box.current?.focus(), 0); }
  }, [p.editing]);
  useEffect(() => { if (p.replyTo) box.current?.focus(); }, [p.replyTo]);

  // after a name is picked, the cursor goes straight after it (before the next key press lands)
  useLayoutEffect(() => {
    if (caretTo.current === null || !box.current) return;
    box.current.focus();
    box.current.setSelectionRange(caretTo.current, caretTo.current);
    caretTo.current = null;
  }, [text]);

  // grow with the text
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  // @mentions (team chat): suggestions for the word being typed
  const suggestions = useMemo(() => {
    if (!mq) return [];
    const q = mq.q.toLowerCase();
    return others.filter(x => !q || x.full_name.toLowerCase().split(/\s+/).some(w => w.startsWith(q)) || x.full_name.toLowerCase().startsWith(q)).slice(0, 6);
  }, [mq, others]);

  function onChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setText(v);
    if (info.kind !== 'team') return;
    const caret = e.target.selectionStart ?? v.length;
    const m = v.slice(0, caret).match(/(?:^|\s)@([^\s@]{0,30})$/);
    if (m) { setMq({ q: m[1], at: caret - m[1].length - 1 }); setMsel(0); } else setMq(null);
  }

  function pickMention(x: Profile) {
    if (!mq) return;
    const end = mq.at + 1 + mq.q.length;
    const ins = `@${x.full_name} `;
    const v = text.slice(0, mq.at) + ins + text.slice(end);
    setText(v);
    setMentionIds(ids => (ids.includes(x.id) ? ids : [...ids, x.id]));
    setMq(null);
    caretTo.current = mq.at + ins.length;
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mq && suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMsel(s => (s + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMsel(s => (s - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(suggestions[msel]); return; }
      if (e.key === 'Escape') { setMq(null); return; }
    }
    if (e.key === 'Escape') { if (p.editing) cancelEdit(); else if (p.replyTo) p.onCancelReply(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !touch()) { e.preventDefault(); send(); }
  }

  function addFiles(list: File[]) {
    if (!list.length) return;
    setFiles(fs => [...fs, ...list].slice(0, 10));
  }

  function cancelEdit() {
    setText('');
    p.onCancelEdit();
  }

  const mentionsIn = (body: string) => info.kind !== 'team' ? [] :
    mentionIds.filter(uid => { const x = person(uid); return !!x && body.includes(`@${x.full_name}`); });

  async function send(sent?: WorkItem) {
    if (busy) return;
    const body = text.trim();
    if (p.editing) {
      if (!body) return toast('Type something, or use Delete to remove the message.', 'error');
      setBusy(true);
      const { data, error } = await supabase.from('msg_messages').update({ body }).eq('id', p.editing.id).select().maybeSingle();
      setBusy(false);
      if (error || !data) return fail(error ?? new Error('That message can no longer be changed.'));
      setText('');
      p.onCancelEdit();
      p.onSent();
      return;
    }
    if (!body && !files.length && !cards.length && !sent) return;
    setBusy(true);
    const uploaded: { path: string; file: File }[] = [];
    for (const f of files) {
      const r = await uploadFile(`messages/${info.thread_id}`, f);
      if ('error' in r) {
        await removeFiles(uploaded.map(u => u.path));
        setBusy(false);
        return fail(new Error(r.error));
      }
      uploaded.push({ path: r.path, file: f });
    }
    const { data, error } = await supabase.from('msg_messages')
      .insert({ thread_id: info.thread_id, body, reply_to: p.replyTo?.id ?? null, mentions: mentionsIn(body) })
      .select().single();
    if (error || !data) {
      await removeFiles(uploaded.map(u => u.path));
      setBusy(false);
      return fail(error);
    }
    const msg = data as Msg;
    if (uploaded.length) {
      const { error: e } = await supabase.from('msg_files').insert(uploaded.map(u => ({
        message_id: msg.id, path: u.path, name: u.file.name, size: u.file.size, mime: u.file.type || null,
      })));
      if (e) fail(e);
    }
    const all = [...cards.map(c => ({ ...c, relation: 'attached' })), ...(sent ? [{ ...sent, relation: 'sent' }] : [])];
    if (all.length) {
      const { error: e } = await supabase.from('msg_items').insert(all.map(c => ({
        message_id: msg.id, kind: c.kind, ref_id: c.ref_id, relation: c.relation, title: c.title,
        for_id: c.for_id ?? null, remind_at: c.remind_at ?? null,
      })));
      if (e) fail(e);
    }
    setBusy(false);
    setText('');
    setFiles([]);
    setCards([]);
    setMentionIds([]);
    p.onCancelReply();
    p.onSent();
    box.current?.focus();
  }

  if (!p.canPost) return <div className="msg-closed">{p.closedNote}</div>;

  const Picker = picker ? attachers.find(a => a.kind === picker)?.component : undefined;
  const Maker = sendAs ? makers.find(a => a.kind === sendAs)?.component : undefined;
  const suggest = info.kind === 'direct' ? givable : mentionsIn(text).filter(p.mayGive);
  const replyName = p.replyTo ? (p.replyTo.author_id === me.id ? 'yourself' : firstName(person(p.replyTo.author_id)?.full_name ?? 'Someone')) : '';
  const empty = !text.trim() && !files.length && !cards.length;

  return (
    <div className="composer"
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)); } }}>
      {p.replyTo && (
        <div className="composer-bar">
          <span>↩ Replying to <strong>{replyName}</strong>: <span className="muted">{p.replyTo.body.slice(0, 90) || '📎 Attachment'}</span></span>
          <button className="icon-btn sm" onClick={p.onCancelReply} aria-label="Cancel reply">✕</button>
        </div>
      )}
      {p.editing && (
        <div className="composer-bar edit">
          <span>✎ Editing your message</span>
          <button className="icon-btn sm" onClick={cancelEdit} aria-label="Cancel edit">✕</button>
        </div>
      )}
      {(files.length > 0 || cards.length > 0) && (
        <div className="composer-chips">
          {files.map((f, i) => (
            <span key={`f${i}`} className="cchip">📎 {f.name} <span className="muted tiny">{fmtSize(f.size)}</span>
              <button onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>✕</button></span>
          ))}
          {cards.map((c, i) => (
            <span key={`c${i}`} className="cchip">{workName(c.kind)}: {c.title}
              <button onClick={() => setCards(cs => cs.filter((_, j) => j !== i))} aria-label={`Remove ${c.title}`}>✕</button></span>
          ))}
        </div>
      )}

      {mq && suggestions.length > 0 && (
        <div className="mention-pop" role="listbox" aria-label="Mention someone">
          {suggestions.map((x, i) => (
            <button key={x.id} role="option" aria-selected={i === msel} className={i === msel ? 'on' : ''}
              onMouseDown={e => { e.preventDefault(); pickMention(x); }}>
              <Avatar p={x} size={22} /> {x.full_name}
            </button>
          ))}
        </div>
      )}

      <div className="composer-row" ref={menuRef}>
        {!p.editing && (
          <div className="composer-menu-wrap">
            <button className="icon-btn" onClick={() => setMenu(m => (m === 'attach' ? null : 'attach'))} aria-label="Attach" title="Attach a file, screenshot or work">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.4 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l8-8" /></svg>
            </button>
            {menu === 'attach' && (
              <div className="popover composer-menu up">
                <button className="menu-item" onClick={() => { setMenu(null); fileInput.current?.click(); }}>📎 File or picture</button>
                {attachers.map(a => (
                  <button key={a.kind} className="menu-item" onClick={() => { setMenu(null); setPicker(a.kind); }}>{a.kind === 'task' ? '📋' : a.kind === 'note' ? '📝' : '⏰'} {a.label}</button>
                ))}
                <div className="muted tiny pad">Tip: paste a screenshot straight into the box.</div>
              </div>
            )}
          </div>
        )}
        <input ref={fileInput} type="file" multiple hidden onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        <textarea ref={box} rows={1} value={text} onChange={onChange} onKeyDown={onKey} maxLength={4000}
          onPaste={e => { const fs = clipboardFiles(e); if (fs.length) { e.preventDefault(); addFiles(fs); } }}
          placeholder={info.kind === 'team' ? 'Message the team… (type @ to mention someone)' : info.kind === 'announce' ? 'Write an announcement — everyone is alerted' : 'Write a message…'}
          aria-label="Message" />
        {!p.editing && sendKinds.length > 0 && (
          <div className="composer-menu-wrap">
            <button className="btn sm" onClick={() => setMenu(m => (m === 'send' ? null : 'send'))} title="Send it as a task, mini task or reminder">Send as ▾</button>
            {menu === 'send' && (
              <div className="popover composer-menu up right">
                {sendKinds.map(k => (
                  <button key={k.kind} className="menu-item" onClick={() => { setMenu(null); setSendAs(k.kind); }}>{k.label}</button>
                ))}
              </div>
            )}
          </div>
        )}
        <button className="btn primary composer-send" disabled={busy || (empty && !p.editing)} onClick={() => send()} aria-label={p.editing ? 'Save' : 'Send'}>
          {p.editing ? 'Save' : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></svg>
          )}
        </button>
      </div>

      {Picker && picker && (
        <Suspense fallback={null}>
          <Picker kind={picker} audience={audience} where={info.kind}
            onPick={it => { setPicker(null); setCards(cs => [...cs, it]); box.current?.focus(); }}
            onCancel={() => setPicker(null)} />
        </Suspense>
      )}
      {Maker && sendAs && (
        <Suspense fallback={null}>
          <Maker kind={sendAs} text={text.trim()} suggest={suggest} mode="send"
            onDone={it => { setSendAs(null); if (it) send(it); }} />
        </Suspense>
      )}
    </div>
  );
}
