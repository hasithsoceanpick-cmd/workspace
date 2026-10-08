import type { Profile } from './types';
import { initials } from '../lib/labels';

export default function Avatar({ p, size = 24, title }: { p?: Profile; size?: number; title?: string }) {
  return (
    <span
      className="avatar"
      title={title ?? p?.full_name}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: p?.color ?? '#94a3b8' }}
    >
      {initials(p?.full_name ?? '?')}
    </span>
  );
}
