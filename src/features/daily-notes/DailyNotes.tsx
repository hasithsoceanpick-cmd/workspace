import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import { fmtStamp, today } from '../../lib/dates';
import Avatar from '../../platform/Avatar';

interface Note { id: number; department_id: string; user_id: string; day: string; body: string; updated_at: string }

/** Department feature "daily_notes" — shown at the bottom of Tasks → Day review. */
export default function DailyNotes({ day }: { day: string }) {
  const { me, dept, person, toast, fail } = usePlatform();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!dept) return;
    const { data, error } = await supabase.from('daily_notes').select('*')
      .eq('department_id', dept.id).eq('day', day).order('updated_at');
    if (error) return fail(error);
    const list = (data as Note[]) ?? [];
    setNotes(list);
    setDraft(list.find(n => n.user_id === me.id)?.body ?? '');
  }, [dept, day, me.id, fail]);

  useEffect(() => { load(); }, [load]);

  const mine = notes?.find(n => n.user_id === me.id);
  const canWrite = me.department_id === dept?.id && day <= today();
  const others = (notes ?? []).filter(n => n.user_id !== me.id && n.body.trim());

  async function save() {
    setBusy(true);
    const res = mine
      ? await supabase.from('daily_notes').update({ body: draft }).eq('id', mine.id)
      : await supabase.from('daily_notes').insert({ day, body: draft });
    setBusy(false);
    if (res.error) return fail(res.error);
    toast('Note saved');
    load();
  }

  return (
    <section className="card feature-card">
      <div className="feature-head">
        <h2>Daily notes</h2>
        <span className="muted tiny">What got done, what's blocked, anything to flag</span>
      </div>

      {canWrite && (
        <div className="note-write">
          <textarea rows={3} placeholder={day === today() ? 'Your note for today…' : 'Your note for this day…'}
            value={draft} onChange={e => setDraft(e.target.value)} />
          <div className="row gap end">
            {mine && <span className="muted tiny">Saved {fmtStamp(mine.updated_at)}</span>}
            <button className="btn primary sm" disabled={busy || draft === (mine?.body ?? '')} onClick={save}>
              {busy ? 'Saving…' : 'Save note'}
            </button>
          </div>
        </div>
      )}

      {notes === null ? <div className="muted small">Loading…</div> : others.length === 0 ? (
        !canWrite && <div className="muted small">No notes for this day.</div>
      ) : (
        <div className="note-list">
          {others.map(n => (
            <div key={n.id} className="note-item">
              <Avatar p={person(n.user_id)} size={26} />
              <div className="grow">
                <div className="strong small">{person(n.user_id)?.full_name ?? 'Someone'}</div>
                <div className="note-body">{n.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
