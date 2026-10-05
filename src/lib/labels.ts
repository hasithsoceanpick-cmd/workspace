import type { Role } from '../platform/types';

export const ROLES: { value: Role; label: string }[] = [
  { value: 'manager', label: 'Manager' },
  { value: 'senior', label: 'Senior Executive' },
  { value: 'member', label: 'Member' },
];
export const roleLabel = (r: string) => ROLES.find(x => x.value === r)?.label ?? r;

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

export const firstName = (name: string) => name.split(/\s+/)[0] || name;
