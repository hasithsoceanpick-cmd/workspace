import { useCallback } from 'react';
import { go } from '../lib/route';
import { FEATURES } from '../features/registry';
import { APPS } from './registry';
import { usePlatform } from './store';
import type { Notice } from './types';

/** Open whatever a notification is about (used by the bell and by tapped phone alerts). */
export function useOpenNotice() {
  const { markRead, isAdmin, dept, setDeptId } = usePlatform();
  return useCallback((n: Notice) => {
    if (!n.read_at) markRead([n.id]);
    if (n.kind === 'signup') return go('admin', 'people');
    // the admin may need to hop to the right department first
    if (isAdmin && n.department_id && n.department_id !== dept?.id) setDeptId(n.department_id);
    if (!n.app_key) return;
    const app = APPS.find(a => a.key === n.app_key);
    const ref = app?.refParam;
    const params: Record<string, string> = ref && n.ref_id && n.kind !== 'due_today' ? { [ref]: String(n.ref_id) } : {};
    // some alerts open a page instead of an item: the app's own pages, or a department feature's page
    const feature = FEATURES.find(f => f.app === n.app_key && f.noticeKinds?.includes(n.kind) && f.pages?.length);
    const page = app?.kindPages?.[n.kind] ?? (feature ? `x-${feature.pages![0].id}` : '');
    setTimeout(() => go(n.app_key!, page, params), 0);
  }, [markRead, isAdmin, dept?.id, setDeptId]);
}
