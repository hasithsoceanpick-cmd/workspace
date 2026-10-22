import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import type { AppProps } from '../../platform/registry';
import Avatar from '../../platform/Avatar';
import { go, replaceRoute } from '../../lib/route';
import { roleLabel } from '../../lib/labels';
import { syncNow, useThreads } from './sync';
import { lastLine, listTime, threadTitle } from './text';
import Conversation from './Conversation';
import type { ThreadInfo } from './types';

/**
 * Messages: the department's announcements and team chat, and one-to-one chats.
 * Opened from the chat button in the top bar. Left: conversations. Right: the open one (phones show one at a time).
 */
export default function MessagesApp({ params }: AppProps) {
  const { dept, me, deptPeople, userHasApp, person, fail } = usePlatform();
  const threads = useThreads(dept!.id, 5_000);
  const id = Number(params.thread) || 0;
  const jump = Number(params.m) || 0;
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const pickRef = useRef<HTMLDivElement>(null);

  const members = useMemo(() => deptPeople.filter(p => userHasApp(p.id, 'messages')), [deptPeople, userHasApp]);
  const others = members.filter(p => p.id !== me.id);

  // on a computer, open the team chat when nothing is chosen and nothing is waiting to be read
  // (otherwise the list shows what's new; phones always show the list first)
  useEffect(() => {
    if (id || !threads || threads.some(t => t.unread > 0) || window.matchMedia('(max-width: 760px)').matches) return;
    const team = threads.find(t => t.kind === 'team');
    if (team) replaceRoute('messages', '', { thread: String(team.thread_id) });
  }, [id, threads]);

  useEffect(() => {
    if (!picking) return;
    const close = (e: MouseEvent) => { if (!pickRef.current?.contains(e.target as Node)) setPicking(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [picking]);

  const current = threads?.find(t => t.thread_id === id);

  async function chatWith(pid: string) {
    setPicking(false);
    setQ('');
    const known = threads?.find(t => t.kind === 'direct' && t.other_id === pid);
    if (known) return go('messages', '', { thread: String(known.thread_id) });
    const { data, error } = await supabase.rpc('msg_direct', { p_other: pid });
    if (error) return fail(error);
    await syncNow(dept!.id);
    go('messages', '', { thread: String(data) });
  }

  const found = others.filter(p => !q.trim() || p.full_name.toLowerCase().includes(q.trim().toLowerCase()));
  const shared = (threads ?? []).filter(t => t.kind !== 'direct');
  const directs = (threads ?? []).filter(t => t.kind === 'direct');

  const row = (t: ThreadInfo) => {
    const p = person(t.other_id);
    return (
      <button key={t.thread_id} className={`msg-thread ${t.thread_id === id ? 'on' : ''} ${t.unread ? 'unread' : ''}`}
        onClick={() => go('messages', '', { thread: String(t.thread_id) })} aria-label={threadTitle(t, person)}>
        {t.kind === 'direct' ? <Avatar p={p} size={36} /> : (
          <span className={`msg-icon k-${t.kind}`} aria-hidden>{t.kind === 'team' ? '#' : '📣'}</span>
        )}
        <span className="msg-thread-main">
          <span className="msg-thread-top">
            <span className="msg-thread-name">{threadTitle(t, person)}</span>
            {(t.last_body !== null || t.last_author) && <span className="msg-thread-time">{listTime(t.last_at)}</span>}
          </span>
          <span className="msg-thread-bottom">
            <span className="msg-thread-last">{lastLine(t, me.id, person)}</span>
            {t.mentions > 0 && <span className="msg-at" title="You were mentioned">@</span>}
            {t.unread > 0 && <span className="msg-unread" aria-label={`${t.unread} unread`}>{t.unread > 99 ? '99+' : t.unread}</span>}
          </span>
        </span>
      </button>
    );
  };

  return (
    <main className="msg-main">
      <div className={`msg-layout ${id ? 'has-thread' : ''}`}>
        <aside className="msg-side" aria-label="Conversations">
          <div className="msg-side-head">
            <h2>Messages</h2>
            <div className="msg-new" ref={pickRef}>
              <button className="btn sm primary" onClick={() => setPicking(o => !o)} disabled={!others.length}>+ New message</button>
              {picking && (
                <div className="popover msg-people">
                  <input autoFocus placeholder="Find someone…" value={q} onChange={e => setQ(e.target.value)} aria-label="Find someone"
                    onKeyDown={e => { if (e.key === 'Enter' && found[0]) chatWith(found[0].id); if (e.key === 'Escape') setPicking(false); }} />
                  <div className="msg-people-list">
                    {found.map(p => (
                      <button key={p.id} className="msg-person" onClick={() => chatWith(p.id)}>
                        <Avatar p={p} size={28} />
                        <span><strong>{p.full_name}</strong><span className="muted tiny">{roleLabel(p.role)}</span></span>
                      </button>
                    ))}
                    {!found.length && <div className="muted small pad">Nobody by that name.</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="msg-threads">
            {threads === null && <div className="muted small pad">Loading…</div>}
            {shared.map(row)}
            {directs.length > 0 && <div className="msg-sep">Direct messages</div>}
            {directs.map(row)}
            {threads && !directs.length && others.length > 0 && (
              <div className="muted small pad">Press <strong>+ New message</strong> to write to one person. Only the two of you can read it.</div>
            )}
          </div>
        </aside>

        <section className="msg-pane">
          {current ? (
            <Conversation key={current.thread_id} info={current} members={members} jump={jump} />
          ) : id && threads ? (
            <div className="empty">
              <h3>This conversation isn't available</h3>
              <p><button className="btn" onClick={() => go('messages')}>Back to messages</button></p>
            </div>
          ) : (
            <div className="empty msg-empty">
              {(threads ?? []).some(t => t.unread > 0) ? 'New messages are waiting — pick a conversation on the left.' : 'Pick a conversation.'}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
