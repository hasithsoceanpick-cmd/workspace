import { supabase } from '../../supabase';
import { go } from '../../lib/route';
import { ago } from '../../lib/dates';
import type { SearchProvider } from '../../platform/slots';

/** Ctrl+K search: words in messages (only conversations you're in — one-to-one chats stay private). */
export const messagesSearch: SearchProvider = {
  app: 'messages',
  label: 'Messages',
  async search(q, deptId, { nameOf }) {
    const { data, error } = await supabase.rpc('msg_search', { p_q: q, p_dept: deptId });
    if (error) throw error;
    return ((data ?? []) as { id: number; thread_id: number; kind: string; other_id: string | null; author_id: string | null; snippet: string; created_at: string }[])
      .map(r => ({
        key: `m${r.id}`,
        title: r.kind === 'team' ? 'Team chat' : r.kind === 'announce' ? 'Announcements' : `Chat with ${nameOf(r.other_id)}`,
        detail: `${nameOf(r.author_id)} · ${ago(r.created_at)}`,
        snippet: r.snippet,
        open: () => go('messages', '', { thread: String(r.thread_id), m: String(r.id) }),
      }));
  },
};
