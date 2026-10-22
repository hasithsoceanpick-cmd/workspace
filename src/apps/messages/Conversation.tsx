import { Fragment, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import Avatar from '../../platform/Avatar';
import { fileUrls, isImage, removeFiles } from '../../platform/files';
import { MESSAGE_WORK, type WorkKind } from '../../platform/slots';
import type { Profile } from '../../platform/types';
import { go } from '../../lib/route';
import { localDayOf } from '../../lib/dates';
import { roleLabel } from '../../lib/labels';
import { syncNow } from './sync';
import { dayLine, threadTitle } from './text';
import Bubble, { type AckInfo, type Tick } from './Bubble';
import Composer from './Composer';
import { EDIT_MINUTES, type Msg, type MsgAck, type MsgFile, type MsgItem, type MsgRead, type ThreadInfo } from './types';

const PAGE = 60;
const POLL_MS = 4_000;

async function rows<T>(q: PromiseLike<{ data: unknown }> | null): Promise<T[]> {
  if (!q) return [];
  const r = await q;
  return (r.data ?? []) as T[];
}
const at = (ts: string | null | undefined) => (ts ? Date.parse(ts) : 0);

/** One conversation: its messages (newest at the bottom, checked every few seconds) and the message box. */
export default function Conversation({ info, members, jump }: { info: ThreadInfo; members: Profile[]; jump: number }) {
  const { me, isAdmin, dept, person, myAppKeys, userHasApp, fail, toast, refreshNotices } = usePlatform();
  const id = info.thread_id;
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [quoted, setQuoted] = useState<Msg[]>([]);
  const [items, setItems] = useState<MsgItem[]>([]);
  const [files, setFiles] = useState<MsgFile[]>([]);
  const [reads, setReads] = useState<MsgRead[]>([]);
  const [acks, setAcks] = useState<MsgAck[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [floor, setFloor] = useState<number | null>(jump || null);
  const [older, setOlder] = useState(false);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const [making, setMaking] = useState<{ msg: Msg; kind: WorkKind } | null>(null);
  const [fresh, setFresh] = useState(0);
  const [flash, setFlash] = useState(jump || 0);
  const [, tick] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(!jump);
  const keepBottom = useRef<number | null>(null);
  const firstPaint = useRef(true);
  const lastId = useRef(0);
  const seenUpTo = useRef(0);
  const readAtOpen = useRef<string | null | undefined>(undefined);

  const other = info.kind === 'direct' ? person(info.other_id) : undefined;
  const othersHere = useMemo(() => (info.kind === 'direct'
    ? (other ? [other] : [])
    : members.filter(p => p.id !== me.id)), [info.kind, other, members, me.id]);
  const isManager = isAdmin || (me.role === 'manager' && me.department_id === dept?.id);
  const canPost = info.kind === 'announce' ? isManager
    : info.kind === 'direct' ? !!other && other.active && other.department_id === dept?.id
    : true;

  const load = useCallback(async (checkOlder = false) => {
    let q = supabase.from('msg_messages').select('*').eq('thread_id', id).order('id', { ascending: false });
    q = floor ? q.gte('id', floor).limit(5000) : q.limit(PAGE);
    const { data, error } = await q;
    if (error) { fail(error); return; }
    const list = ((data ?? []) as Msg[]).slice().reverse();
    const ids = list.map(m => m.id);
    const missing = [...new Set(list.map(m => m.reply_to).filter((r): r is number => !!r && !ids.includes(r)))];
    const [it, fl, rd, ak, qt] = await Promise.all([
      rows<MsgItem>(ids.length ? supabase.from('msg_items').select('*').in('message_id', ids).order('id') : null),
      rows<MsgFile>(ids.length ? supabase.from('msg_files').select('*').in('message_id', ids).order('id') : null),
      rows<MsgRead>(supabase.from('msg_reads').select('*').eq('thread_id', id)),
      rows<MsgAck>(info.kind === 'announce' && ids.length ? supabase.from('msg_acks').select('*').in('message_id', ids) : null),
      rows<Msg>(missing.length ? supabase.from('msg_messages').select('*').in('id', missing) : null),
    ]);
    if (readAtOpen.current === undefined) readAtOpen.current = rd.find(r => r.user_id === me.id)?.read_at ?? null;
    setMsgs(list);
    setItems(it);
    setFiles(fl);
    setReads(rd);
    setAcks(ak);
    setQuoted(qt);
    if (checkOlder) {
      const before = list.length
        ? await rows<{ id: number }>(supabase.from('msg_messages').select('id').eq('thread_id', id).lt('id', list[0].id).limit(1))
        : [];
      setOlder(before.length > 0);
    }
    // pictures: short-lived private links
    const imgs = fl.filter(f => isImage(f.mime, f.name)).map(f => f.path);
    if (imgs.length) {
      const got = await fileUrls(imgs);
      setUrls(u => ({ ...u, ...got }));
    }
  }, [id, floor, info.kind, fail, me.id]);

  // first look, then every few seconds while the page is in front
  useEffect(() => { load(true); }, [load]);
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') load(); };
    const timer = setInterval(again, POLL_MS);
    window.addEventListener('focus', again);
    window.addEventListener('workspace:pushed', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', again);
      window.removeEventListener('workspace:pushed', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [load]);
  // a search result in this same conversation: go to that message
  const handledJump = useRef(jump);
  useEffect(() => {
    if (!jump || jump === handledJump.current) return;
    handledJump.current = jump;
    jumpTo(jump);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump]);
  // keep the "can still edit" menu honest
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30_000); return () => clearInterval(t); }, []);

  // seen: when I'm looking at new messages from others (also clears this conversation's alerts in the bell)
  useEffect(() => {
    if (!msgs || document.visibilityState !== 'visible') return;
    const newest = msgs.filter(m => m.author_id !== me.id).at(-1)?.id ?? 0;
    if (seenUpTo.current && newest <= seenUpTo.current) return;
    seenUpTo.current = Math.max(newest, 1);
    (async () => {
      await supabase.rpc('msg_seen', { p_thread: id });
      syncNow();
      refreshNotices();
    })();
  }, [msgs, id, me.id, refreshNotices]);

  // scrolling: start at the bottom (or at the message searched for); follow new ones if already at the bottom
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !msgs) return;
    const newest = msgs.at(-1)?.id ?? 0;
    if (keepBottom.current !== null) {
      el.scrollTop = el.scrollHeight - keepBottom.current;
      keepBottom.current = null;
    } else if (firstPaint.current) {
      firstPaint.current = false;
      const target = flash ? document.getElementById(`msg-${flash}`) : null;
      if (target) target.scrollIntoView({ block: 'center' });
      else el.scrollTop = el.scrollHeight;
    } else if (newest > lastId.current) {
      const fromOthers = msgs.filter(m => m.id > lastId.current && m.author_id !== me.id).length;
      if (stick.current || !fromOthers) el.scrollTop = el.scrollHeight;
      else setFresh(n => n + fromOthers);
    }
    lastId.current = newest;
  }, [msgs, flash, me.id]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(0), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stick.current && fresh) setFresh(0);
  }
  function toBottom() {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    stick.current = true;
    setFresh(0);
  }

  async function earlier() {
    const first = msgs?.[0]?.id;
    if (!first) return;
    const prev = await rows<{ id: number }>(supabase.from('msg_messages').select('id').eq('thread_id', id).lt('id', first)
      .order('id', { ascending: false }).limit(PAGE));
    if (!prev.length) { setOlder(false); return; }
    const el = scroller.current;
    if (el) keepBottom.current = el.scrollHeight - el.scrollTop;
    setFloor(Math.min(...prev.map(r => r.id)));
  }

  async function jumpTo(mid: number) {
    if (msgs?.some(m => m.id === mid)) {
      document.getElementById(`msg-${mid}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFlash(mid);
      return;
    }
    firstPaint.current = true;
    setFlash(mid);
    setFloor(mid);
  }

  async function remove(m: Msg) {
    const fs = files.filter(f => f.message_id === m.id);
    if (fs.length) {
      await removeFiles(fs.map(f => f.path));
      await supabase.from('msg_files').delete().in('id', fs.map(f => f.id));
    }
    const { error } = await supabase.from('msg_messages').update({ deleted_at: new Date().toISOString() }).eq('id', m.id);
    if (error) fail(error);
    if (editing?.id === m.id) setEditing(null);
    load();
    syncNow();
  }

  async function gotIt(m: Msg) {
    setAcks(a => [...a, { message_id: m.id, user_id: me.id, acked_at: new Date().toISOString() }]);
    const { error } = await supabase.from('msg_acks').insert({ message_id: m.id });
    if (error && !String(error.message).includes('duplicate')) fail(error);
    load();
  }

  async function made(m: Msg, it: { kind: WorkKind; ref_id: number; title: string; for_id?: string | null; remind_at?: string | null }) {
    const { error } = await supabase.from('msg_items').insert({
      message_id: m.id, kind: it.kind, ref_id: it.ref_id, relation: 'made', title: it.title,
      for_id: it.for_id ?? null, remind_at: it.remind_at ?? null,
    });
    if (error) fail(error);
    load();
  }

  // who may I give work to? (the database checks this again)
  const mayGive = useCallback((pid: string) => {
    if (pid === me.id || !userHasApp(pid, 'tasks')) return false;
    if (isAdmin || me.role === 'manager') return true;
    return me.role === 'senior' && person(pid)?.role === 'member';
  }, [me.id, me.role, isAdmin, userHasApp, person]);

  const makers = MESSAGE_WORK.filter(w => myAppKeys.includes(w.app));
  const Maker = making ? makers.find(w => w.kind === making.kind)?.component : undefined;
  const list = msgs ?? [];
  const byId = new Map<number, Msg>([...quoted, ...list].map(m => [m.id, m]));
  const now = Date.now();
  const firstNew = readAtOpen.current === undefined ? 0
    : list.find(m => m.author_id !== me.id && at(m.created_at) > at(readAtOpen.current))?.id ?? 0;

  function tickOf(m: Msg): Tick {
    if (!othersHere.length) return 'sent';
    const t = at(m.created_at);
    const r = (uid: string) => reads.find(x => x.user_id === uid);
    if (othersHere.every(p => at(r(p.id)?.read_at) >= t)) return 'seen';
    if (othersHere.every(p => at(r(p.id)?.delivered_at) >= t)) return 'delivered';
    return 'sent';
  }
  function seenOf(m: Msg) {
    const t = at(m.created_at);
    const yes = othersHere.filter(p => at(reads.find(x => x.user_id === p.id)?.read_at) >= t);
    return { yes, no: othersHere.filter(p => !yes.includes(p)) };
  }
  function ackOf(m: Msg): AckInfo {
    const mine = acks.some(a => a.message_id === m.id && a.user_id === me.id);
    const who = members.filter(p => p.id !== m.author_id && acks.some(a => a.message_id === m.id && a.user_id === p.id));
    const waiting = members.filter(p => p.id !== m.author_id && !who.includes(p));
    return { mine, canSee: m.author_id === me.id || isManager, who, waiting };
  }

  const title = threadTitle(info, person);
  const sub = info.kind === 'direct'
    ? `${other ? roleLabel(other.role) : ''} · only the two of you can read this`
    : info.kind === 'team'
      ? `${members.length} ${members.length === 1 ? 'person' : 'people'} · type @ to alert someone`
      : isManager ? 'Everyone is alerted when you post' : 'From your managers — press Got it on each one';

  return (
    <div className={`convo k-${info.kind}`}>
      <div className="convo-head">
        <button className="icon-btn convo-back" onClick={() => go('messages')} aria-label="Back to conversations">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        {info.kind === 'direct' ? <Avatar p={other} size={34} /> : <span className={`msg-icon k-${info.kind}`} aria-hidden>{info.kind === 'team' ? '#' : '📣'}</span>}
        <div className="convo-title">
          <strong>{title}</strong>
          <span className="muted tiny">{sub}</span>
        </div>
        {info.kind !== 'direct' && (
          <div className="convo-people" title={members.map(p => p.full_name).join(', ')}>
            {members.slice(0, 5).map(p => <Avatar key={p.id} p={p} size={24} />)}
            {members.length > 5 && <span className="muted tiny">+{members.length - 5}</span>}
          </div>
        )}
      </div>

      <div className="convo-body" ref={scroller} onScroll={onScroll}>
        {msgs === null && <div className="muted small pad">Loading…</div>}
        {older && <div className="convo-older"><button className="btn sm" onClick={earlier}>Load earlier messages</button></div>}
        {msgs && !list.length && (
          <div className="convo-start">
            {info.kind === 'direct' ? <>This is the start of your chat with <strong>{other?.full_name ?? 'them'}</strong>. Only the two of you can read it — not even managers or the administrator.</>
              : info.kind === 'team' ? <>The whole team chat for {dept?.name}. Type <strong>@</strong> and a name to alert someone.</>
              : <>Announcements from managers. Everyone is alerted, and each person presses <strong>Got it</strong>.</>}
          </div>
        )}
        {list.map((m, i) => {
          const prev = list[i - 1];
          const day = localDayOf(m.created_at);
          const newDay = !prev || localDayOf(prev.created_at) !== day;
          const compact = !newDay && !!prev && prev.author_id === m.author_id && m.id !== firstNew
            && at(m.created_at) - at(prev.created_at) < 5 * 60_000 && info.kind !== 'announce';
          const mine = m.author_id === me.id;
          const quote = m.reply_to ? byId.get(m.reply_to) : undefined;
          return (
            <Fragment key={m.id}>
              {newDay && <div className="convo-day"><span>{dayLine(day)}</span></div>}
              {m.id === firstNew && <div className="convo-new"><span>New messages</span></div>}
              <Bubble m={m} kind={info.kind} me={me.id} mine={mine} compact={compact}
                author={person(m.author_id)} quote={quote} quoteAuthor={quote ? person(quote.author_id) : undefined}
                items={items.filter(x => x.message_id === m.id)} files={files.filter(f => f.message_id === m.id)} urls={urls}
                mentioned={(m.mentions ?? []).map(uid => person(uid)).filter((x): x is Profile => !!x)}
                tick={mine && info.kind !== 'announce' ? tickOf(m) : undefined}
                seen={mine && info.kind === 'team' ? seenOf(m) : undefined}
                ack={info.kind === 'announce' ? ackOf(m) : undefined}
                canChange={mine && !m.deleted_at && now - at(m.created_at) < EDIT_MINUTES * 60_000}
                canReply={canPost}
                workKinds={makers.map(w => ({ kind: w.kind, label: w.label }))}
                flash={flash === m.id} personOf={person}
                onReply={() => { setEditing(null); setReplyTo(m); }}
                onEdit={() => { setReplyTo(null); setEditing(m); }}
                onDelete={() => remove(m)}
                onMake={k => setMaking({ msg: m, kind: k })}
                onAck={() => gotIt(m)}
                onJump={jumpTo}
                onCopy={() => { navigator.clipboard?.writeText(m.body).then(() => toast('Copied'), () => { /* not allowed */ }); }} />
            </Fragment>
          );
        })}
      </div>
      {fresh > 0 && <button className="convo-fresh" onClick={toBottom}>↓ {fresh} new {fresh === 1 ? 'message' : 'messages'}</button>}

      <Composer info={info} members={members} canPost={canPost}
        closedNote={info.kind === 'announce'
          ? 'Only managers post announcements. Press Got it on each one so they know you have read it.'
          : `${other?.full_name ?? 'This person'} is no longer in ${dept?.name ?? 'the department'}.`}
        replyTo={replyTo} onCancelReply={() => setReplyTo(null)}
        editing={editing} onCancelEdit={() => setEditing(null)}
        onSent={() => { stick.current = true; load(); syncNow(); }}
        mayGive={mayGive} />

      {Maker && making && (
        <Suspense fallback={null}>
          <Maker kind={making.kind} text={making.msg.body} suggest={[me.id]} mode="make"
            onDone={it => { const m = making.msg; setMaking(null); if (it) made(m, it); }} />
        </Suspense>
      )}
    </div>
  );
}
