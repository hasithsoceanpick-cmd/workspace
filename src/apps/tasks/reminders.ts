import { supabase } from '../../supabase';
import { toISO } from '../../lib/dates';
import type { Profile } from '../../platform/types';
import type { Reminder, ReminderRepeat } from './types';

/** Quick reminders: a note to yourself (or someone in your team) that pops up at a set time. */
export const REMINDER_REPEATS: { value: ReminderRepeat; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
];
export const repeatName = (r: string | null) => REMINDER_REPEATS.find(x => x.value === r)?.label ?? '';

/** tell every reminder list on the page to reload */
export const remindersChanged = () => window.dispatchEvent(new Event('workspace:reminders'));

export async function loadReminders(): Promise<Reminder[]> {
  const { data, error } = await supabase.from('task_reminders').select('*').order('remind_at');
  if (error) throw error;
  return (data as Reminder[]) ?? [];
}

/** Who I may set a reminder for: myself, plus (like giving work) my team if I'm a manager or senior executive. */
export function remindable(me: Profile, isAdmin: boolean, people: Profile[], hasTasks: (id: string) => boolean): Profile[] {
  const others = people.filter(p => p.id !== me.id && hasTasks(p.id) && (
    isAdmin || (me.department_id === p.department_id && (me.role === 'manager' || (me.role === 'senior' && p.role === 'member')))));
  return [me, ...others.sort((a, b) => a.full_name.localeCompare(b.full_name))];
}

const at = (base: Date, days: number, h: number, m = 0) => {
  const x = new Date(base);
  x.setDate(x.getDate() + days);
  x.setHours(h, m, 0, 0);
  return x;
};

/** One-tap times for a new reminder */
export function presets(now = new Date()): { label: string; at: Date }[] {
  const list = [{ label: 'In 1 hour', at: new Date(now.getTime() + 3600_000) }];
  if (now.getHours() < 16) list.push({ label: 'Today 5 pm', at: at(now, 0, 17) });
  list.push({ label: 'Tomorrow 9 am', at: at(now, 1, 9) });
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  if (toMonday > 1) list.push({ label: 'Monday 9 am', at: at(now, toMonday, 9) });
  return list;
}

export function snoozes(now = new Date()): { label: string; at: Date }[] {
  return [
    { label: '10 min', at: new Date(now.getTime() + 600_000) },
    { label: '1 hour', at: new Date(now.getTime() + 3600_000) },
    { label: 'Tomorrow 9 am', at: at(now, 1, 9) },
  ];
}

const pad = (n: number) => String(n).padStart(2, '0');
/** value for <input type="datetime-local"> */
export const toLocalInput = (d: Date) => `${toISO(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "Today 15:30", "Tomorrow 09:00", "Fri 10 Oct, 09:00" */
export function fmtWhen(ts: string): string {
  const d = new Date(ts);
  const day = toISO(d), now = new Date();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (day === toISO(now)) return `Today ${time}`;
  if (day === toISO(at(now, 1, 0))) return `Tomorrow ${time}`;
  if (day === toISO(at(now, -1, 0))) return `Yesterday ${time}`;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${wd} ${d.getDate()} ${mo}${d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : ''}, ${time}`;
}

/** due = its time has come and it isn't done; upcoming = later */
export const isDue = (r: Reminder) => !r.done_at && new Date(r.remind_at).getTime() <= Date.now();
