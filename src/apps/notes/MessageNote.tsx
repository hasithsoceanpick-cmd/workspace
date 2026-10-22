import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import type { WorkCardProps } from '../../platform/slots';
import { go } from '../../lib/route';
import { firstName } from '../../lib/labels';
import { untitled } from './types';

/** A Notes page inside a message (Messages app). Opens it if it's shared with you. */
export default function MessageNote({ item, by }: WorkCardProps) {
  const { person, toast } = usePlatform();
  const [live, setLive] = useState<{ id: number; title: string } | null | undefined>(undefined);

  useEffect(() => {
    let on = true;
    supabase.from('notes_pages').select('id,title').eq('id', item.ref_id).maybeSingle()
      .then(({ data }) => { if (on) setLive((data as { id: number; title: string } | null) ?? null); });
    return () => { on = false; };
  }, [item.ref_id]);

  const open = () => (live
    ? go('notes', '', { note: String(item.ref_id) })
    : toast(`This page isn't shared with you — ask ${firstName(person(by)?.full_name ?? 'whoever sent it')} to share it.`, 'error'));

  return (
    <button className={`wcard k-note ${live === null ? 'locked' : ''}`} onClick={open} title={live ? 'Open the page' : "You can't open this page"}>
      <span className="wcard-icon" aria-hidden>📝</span>
      <span className="wcard-main">
        <span className="wcard-kind">Note</span>
        <span className="wcard-title">{untitled(live?.title ?? item.title)}</span>
      </span>
      {live === null && <span className="muted tiny">🔒</span>}
    </button>
  );
}
