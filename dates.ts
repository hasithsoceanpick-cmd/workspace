// All task dates are plain 'YYYY-MM-DD' strings in the team's local time.

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const today = () => toISO(new Date());

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function addMonths(iso: string, n: number): string {
  const d = fromISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

/** Monday of the week containing iso */
export function startOfWeek(iso: string): string {
  const d = fromISO(iso);
  const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(iso, -dow);
}

export function startOfMonth(iso: string): string {
  const d = fromISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 86400000);
}

/** Full weeks (Mon–Sun) covering the month of iso */
export function monthGrid(iso: string): string[] {
  const first = startOfMonth(iso);
  const last = addDays(addMonths(first, 1), -1);
  let d = startOfWeek(first);
  const out: string[] = [];
  while (d <= last || out.length % 7 !== 0) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export function weekDays(iso: string): string[] {
  const s = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const weekdayShort = (iso: string) => WD[fromISO(iso).getDay()];
export const dayNum = (iso: string) => fromISO(iso).getDate();

/** "Tue 6 Oct" */
export function fmtDay(iso: string): string {
  const d = fromISO(iso);
  return `${WD[d.getDay()]} ${d.getDate()} ${MO[d.getMonth()]}`;
}

/** "Tuesday, 6 October 2026" */
export function fmtLong(iso: string): string {
  const d = fromISO(iso);
  const long = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
  return `${long}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtMonth(iso: string): string {
  const d = fromISO(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtWeekRange(iso: string): string {
  const s = startOfWeek(iso), e = addDays(s, 6);
  const a = fromISO(s), b = fromISO(e);
  if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${b.getDate()} ${MO[b.getMonth()]} ${b.getFullYear()}`;
  return `${a.getDate()} ${MO[a.getMonth()]} – ${b.getDate()} ${MO[b.getMonth()]} ${b.getFullYear()}`;
}

/** Friendly due label: Today, Tomorrow, Yesterday, Fri, 12 Oct */
export function fmtDue(iso: string): string {
  const diff = daysBetween(today(), iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return WD[fromISO(iso).getDay()];
  const d = fromISO(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MO[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}`;
}

/** "14:05" */
export function fmtTime(ts: string): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "4 Oct, 14:05" or "14:05" if today */
export function fmtStamp(ts: string): string {
  const d = new Date(ts);
  if (toISO(d) === today()) return fmtTime(ts);
  return `${d.getDate()} ${MO[d.getMonth()]}, ${fmtTime(ts)}`;
}

/** "just now", "5m", "3h", "2d" */
export function ago(ts: string): string {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return fmtStamp(ts);
}

/** Start/end timestamps (UTC ISO) of a local calendar day */
export function dayBounds(iso: string): [string, string] {
  return [fromISO(iso).toISOString(), fromISO(addDays(iso, 1)).toISOString()];
}

export const localDayOf = (ts: string) => toISO(new Date(ts));
