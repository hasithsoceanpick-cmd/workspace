import { useState, type FormEvent } from 'react';
import { useTaskApp } from './store';
import type { Contact } from './types';

/** Add or change someone outside the app (no login): name, where they work, how to reach them. */
export default function ContactForm({ initial, onSaved, onCancel, withNote = true }: {
  initial?: Contact; onSaved: (c: Contact) => void; onCancel: () => void; withNote?: boolean;
}) {
  const { saveContact } = useTaskApp();
  const [f, setF] = useState({
    name: initial?.name ?? '', organisation: initial?.organisation ?? '', phone: initial?.phone ?? '',
    email: initial?.email ?? '', note: initial?.note ?? '',
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!f.name.trim()) return;
    setBusy(true);
    const c = await saveContact({ ...f, id: initial?.id });
    setBusy(false);
    if (c) onSaved(c);
  }

  return (
    <form className="contact-form" onSubmit={submit}>
      <div className="cf-grid">
        <label className="field"><span>Name</span>
          <input autoFocus required maxLength={120} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. Sampath Perera" />
        </label>
        <label className="field"><span>Company / role</span>
          <input maxLength={120} value={f.organisation} onChange={e => setF({ ...f, organisation: e.target.value })} placeholder="e.g. DFCC Bank, relationship officer" />
        </label>
        <label className="field"><span>Phone</span>
          <input maxLength={40} value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="optional" inputMode="tel" />
        </label>
        <label className="field"><span>Email</span>
          <input maxLength={200} type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="optional" />
        </label>
      </div>
      {withNote && (
        <label className="field"><span>Note</span>
          <input maxLength={500} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="optional — e.g. best after 10 am" />
        </label>
      )}
      <div className="row gap end">
        <button type="button" className="btn sm" onClick={onCancel}>Cancel</button>
        <button className="btn primary sm" disabled={busy || !f.name.trim()}>{busy ? 'Saving…' : initial ? 'Save' : 'Add person'}</button>
      </div>
    </form>
  );
}
