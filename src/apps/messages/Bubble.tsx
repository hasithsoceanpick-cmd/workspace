import { useEffect, useRef, useState } from 'react';
import Avatar from '../../platform/Avatar';
import { fileUrl, fmtSize, isImage } from '../../platform/files';
import type { Profile } from '../../platform/types';
import type { WorkKind } from '../../platform/slots';
import { fmtTime } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import { Body } from './text';
import Card, { workName } from './Card';
import type { Msg, MsgFile, MsgItem, ThreadKind } from './types';

export type Tick = 'sent' | 'delivered' | 'seen';

export interface AckInfo {
  /** I pressed Got it */
  mine: boolean;
  /** I may see who has (the author, managers, the admin) */
  canSee: boolean;
  who: Profile[];
  waiting: Profile[];
}

interface Props {
  m: Msg;
  kind: ThreadKind;
  me: string;
  mine: boolean;
  compact: boolean;
  author?: Profile;
  quote?: Msg;
  quoteAuthor?: Profile;
  items: MsgItem[];
  files: MsgFile[];
  urls: Record<string, string>;
  mentioned: Profile[];
  tick?: Tick;
  seen?: { yes: Profile[]; no: Profile[] };
  ack?: AckInfo;
  canChange: boolean;
  canReply: boolean;
  workKinds: { kind: WorkKind; label: string }[];
  flash: boolean;
  personOf: (id: string | null) => Profile | undefined;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMake: (k: WorkKind) => void;
  onAck: () => void;
  onJump: (id: number) => void;
  onCopy: () => void;
}

function Ticks({ t }: { t: Tick }) {
  const label = t === 'seen' ? 'Seen' : t === 'delivered' ? 'Delivered' : 'Sent';
  return (
    <span className={`ticks t-${t}`} title={label} aria-label={label}>
      <svg viewBox="0 0 18 12" width="17" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1.5 6.5l3 3 6-7" />
        {t !== 'sent' && <path d="M7.5 9.5l.5.3 6-7.3" />}
      </svg>
    </span>
  );
}

export default function Bubble(p: Props) {
  const { m, mine } = p;
  const [menu, setMenu] = useState(false);
  const [sure, setSure] = useState(false);
  const [info, setInfo] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const gone = !!m.deleted_at;
  const announce = p.kind === 'announce';

  useEffect(() => {
    if (!menu && !info) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setMenu(false); setSure(false); setInfo(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(false); setSure(false); setInfo(false); } };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [menu, info]);

  const shown = p.items.filter(i => i.relation !== 'made');
  const made = p.items.filter(i => i.relation === 'made');
  const imgs = p.files.filter(f => isImage(f.mime, f.name));
  const docs = p.files.filter(f => !isImage(f.mime, f.name));
  const open = async (f: MsgFile) => {
    const u = p.urls[f.path] ?? await fileUrl(f.path);
    if (u) window.open(u, '_blank', 'noopener');
  };
  const name = p.author?.full_name ?? 'Former colleague';
  const act = (fn: () => void) => () => { setMenu(false); setSure(false); fn(); };

  return (
    <div ref={ref} id={`msg-${m.id}`} data-id={m.id}
      className={`msg ${mine ? 'mine' : 'theirs'} ${p.compact ? 'compact' : ''} ${announce ? 'announce' : ''} ${gone ? 'gone' : ''} ${p.flash ? 'flash' : ''}`}>
      {!mine && !announce && p.kind !== 'direct' && (
        <span className="msg-av">{!p.compact && <Avatar p={p.author} size={30} />}</span>
      )}
      {announce && <Avatar p={p.author} size={34} />}
      <div className="msg-col">
        {(announce || (!mine && !p.compact && p.kind !== 'direct')) && (
          <div className="msg-name">{name}{announce && <span className="muted tiny"> · {fmtTime(m.created_at)}</span>}</div>
        )}
        <div className="msg-bubble">
          {gone ? (
            <span className="msg-gone">🚫 This message was deleted</span>
          ) : (
            <>
              {m.reply_to && (
                <button className="msg-quote" onClick={() => p.onJump(m.reply_to!)} title="Go to that message">
                  <strong>{p.quote ? (p.quote.author_id === p.me ? 'You' : firstName(p.quoteAuthor?.full_name ?? 'Someone')) : 'Earlier message'}</strong>
                  <span>{p.quote ? (p.quote.deleted_at ? 'Message deleted' : p.quote.body.slice(0, 140) || '📎 Attachment') : ''}</span>
                </button>
              )}
              {imgs.length > 0 && (
                <div className={`msg-imgs n${Math.min(imgs.length, 3)}`}>
                  {imgs.map(f => (
                    <button key={f.id} className="msg-img" onClick={() => open(f)} title={f.name}>
                      {p.urls[f.path] ? <img src={p.urls[f.path]} alt={f.name} loading="lazy" /> : <span className="muted tiny">{f.name}</span>}
                    </button>
                  ))}
                </div>
              )}
              {docs.map(f => (
                <button key={f.id} className="msg-doc" onClick={() => open(f)}>
                  <span aria-hidden>📄</span><span className="msg-doc-name">{f.name}</span><span className="muted tiny">{fmtSize(f.size)}</span>
                </button>
              ))}
              {shown.map(i => <Card key={i.id} item={i} />)}
              {m.body && <div className="msg-text"><Body text={m.body} mentioned={p.mentioned} me={p.me} /></div>}
            </>
          )}
          <span className="msg-meta">
            {m.edited_at && !gone && <span className="msg-edited">edited</span>}
            {!announce && <span>{fmtTime(m.created_at)}</span>}
            {mine && !gone && p.tick && (
              p.seen ? <button className="tick-btn" onClick={() => setInfo(o => !o)} aria-label="Who has seen it"><Ticks t={p.tick} /></button> : <Ticks t={p.tick} />
            )}
          </span>
          {!gone && (
            <button className="msg-more" onClick={() => setMenu(o => !o)} aria-label="Message options" title="Options">⋯</button>
          )}
        </div>

        {made.map(i => (
          <div key={i.id} className="msg-made">
            <span className="muted tiny">{i.created_by === p.me ? 'You' : firstName(p.personOf(i.created_by)?.full_name ?? 'Someone')} made this a {workName(i.kind).toLowerCase()}</span>
            <Card item={i} />
          </div>
        ))}

        {announce && !gone && p.ack && (
          <div className="ack-row">
            {!mine && (p.ack.mine
              ? <span className="ack-done">✓ You pressed Got it</span>
              : <button className="btn sm primary" onClick={p.onAck}>Got it</button>)}
            {p.ack.canSee && (
              <button className="link small" onClick={() => setInfo(o => !o)}>
                Got it: {p.ack.who.length} of {p.ack.who.length + p.ack.waiting.length}
              </button>
            )}
          </div>
        )}

        {info && p.ack?.canSee && (
          <div className="popover msg-info">
            <div className="msg-info-col"><strong className="small">Got it</strong>
              {p.ack.who.map(x => <span key={x.id} className="small">✓ {x.full_name}</span>)}
              {!p.ack.who.length && <span className="muted small">Nobody yet</span>}
            </div>
            <div className="msg-info-col"><strong className="small">Not yet</strong>
              {p.ack.waiting.map(x => <span key={x.id} className="small muted">{x.full_name}</span>)}
              {!p.ack.waiting.length && <span className="muted small">Everyone has 🎉</span>}
            </div>
          </div>
        )}
        {info && p.seen && !announce && (
          <div className="popover msg-info">
            <div className="msg-info-col"><strong className="small">Seen by</strong>
              {p.seen.yes.map(x => <span key={x.id} className="small">✓✓ {x.full_name}</span>)}
              {!p.seen.yes.length && <span className="muted small">Nobody yet</span>}
            </div>
            <div className="msg-info-col"><strong className="small">Not yet</strong>
              {p.seen.no.map(x => <span key={x.id} className="small muted">{x.full_name}</span>)}
              {!p.seen.no.length && <span className="muted small">Everyone 🎉</span>}
            </div>
          </div>
        )}

        {menu && (
          <div className="popover msg-menu" role="menu">
            {sure ? (
              <>
                <div className="small pad">Delete this message for everyone?</div>
                <button className="menu-item danger" onClick={act(p.onDelete)}>Yes, delete</button>
                <button className="menu-item" onClick={() => setSure(false)}>No</button>
              </>
            ) : (
              <>
                {p.canReply && <button className="menu-item" onClick={act(p.onReply)}>↩ Reply</button>}
                {p.workKinds.map(w => (
                  <button key={w.kind} className="menu-item" onClick={act(() => p.onMake(w.kind))}>Make it a {w.label.toLowerCase()}</button>
                ))}
                {m.body && <button className="menu-item" onClick={act(p.onCopy)}>Copy text</button>}
                {p.seen && mine && <button className="menu-item" onClick={() => { setMenu(false); setInfo(true); }}>Seen by…</button>}
                {p.canChange && m.body && <button className="menu-item" onClick={act(p.onEdit)}>Edit</button>}
                {p.canChange && <button className="menu-item danger" onClick={() => setSure(true)}>Delete</button>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
