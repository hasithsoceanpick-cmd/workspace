import { useEffect, useRef } from 'react';
import { usePlatform } from '../../platform/store';
import { go, useRoute } from '../../lib/route';
import { useThreads } from './sync';

/** The chat button in the top bar, with the number of unread messages. */
export default function ChatButton() {
  const { dept, refreshNotices } = usePlatform();
  const route = useRoute();
  const threads = useThreads(dept?.id, 20_000);
  const unread = (threads ?? []).reduce((n, t) => n + t.unread, 0);
  const here = route.app === 'messages';
  // something new arrived: mentions and announcements also go in the bell, so bring it up to date now
  const before = useRef(unread);
  useEffect(() => {
    if (unread > before.current) refreshNotices();
    before.current = unread;
  }, [unread, refreshNotices]);
  return (
    <div className="chat-btn">
      <button className={`icon-btn ${here ? 'on' : ''}`} onClick={() => go('messages')}
        aria-label={unread ? `Messages, ${unread} unread` : 'Messages'} title="Messages">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.6-4.4A8 8 0 0 1 3 11.5 8.6 8.6 0 0 1 12 3a8.6 8.6 0 0 1 9 8.5z" />
        </svg>
        {unread > 0 && <span className="dot-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
    </div>
  );
}
