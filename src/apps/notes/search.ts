import { supabase } from '../../supabase';
import { go } from '../../lib/route';
import type { SearchProvider } from '../../platform/slots';

/** Ctrl+K search: note titles and text (only pages you can already open). */
export const notesSearch: SearchProvider = {
  app: 'notes',
  label: 'Notes',
  async search(q, deptId) {
    const { data, error } = await supabase.rpc('notes_search', { p_q: q, p_dept: deptId });
    if (error) throw error;
    return ((data ?? []) as { id: number; title: string; parent_id: number | null; found_in: string; snippet: string }[])
      .map(r => ({
        key: `n${r.id}`,
        title: r.title || 'Untitled',
        detail: r.parent_id ? 'Sub-page' : 'Page',
        snippet: r.found_in === 'title' ? '' : r.snippet,
        open: () => go('notes', '', { note: String(r.id) }),
      }));
  },
};
