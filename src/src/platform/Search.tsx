import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { usePlatform } from './store';
import { SEARCH, type SearchHit } from './slots';

/** Cut long text down to the part around the first match. */
function around(text: string, q: string, size = 110): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const i = flat.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0 || flat.length <= size) return flat.slice(0, size) + (flat.length > size ? '…' : '');
  const start = Math.max(0, i - Math.floor((size - q.length) / 2));
  return (start > 0 ? '…' : '') + flat.slice(start, start + size) + (start + size < flat.length ? '…' : '');
}

function Mark({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (!q || i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

/**
 * Search everything (Ctrl+K / ⌘K, or the magnifier in the top bar).
 * Each app searches its own data through the database, so people only ever find what they can already open.
 */
export default function Search() {
  const { dept, myAppKeys, person, fail } = usePlatform();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ label: string; hits: SearchHit[] }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const providers = useMemo(() => SEARCH.filter(p => myAppKeys.includes(p.app)), [myAppKeys]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
    else { setQ(''); setResults(null); setSel(0); }
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2 || !dept) { setResults(null); return; }
    let live = true;
    const timer = setTimeout(async () => {
      setBusy(true);
      const nameOf = (id: string | null) => person(id)?.full_name ?? 'Someone';
      const found = await Promise.all(providers.map(async p => {
        try { return { label: p.label, hits: await p.search(term, dept.id, { nameOf }) }; }
        catch (e) { fail(e); return { label: p.label, hits: [] }; }
      }));
      if (!live) return;
      setResults(found.filter(g => g.hits.length));
      setSel(0);
      setBusy(false);
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [q, open, dept, providers, person, fail]);

  const flat = (results ?? []).flatMap(g => g.hits);
  function choose(h: SearchHit | undefined) {
    if (!h) return;
    setOpen(false);
    h.open();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(flat[sel]); }
  }

  if (!providers.length) return null;
  const term = q.trim();
  let n = -1;

  return (
    <>
      <button className="icon-btn search-btn" onClick={() => setOpen(true)} aria-label="Search (Ctrl+K)" title="Search (Ctrl+K)">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
        </svg>
      </button>
      {open && (
        <div className="search-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="search-box" role="dialog" aria-label="Search">
            <div className="search-input">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input ref={input} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
                placeholder={`Search ${providers.map(p => p.label.toLowerCase()).join(' and ')} in ${dept?.name ?? ''}…`} aria-label="Search" />
              <kbd>Esc</kbd>
            </div>
            <div className="search-results">
              {term.length < 2 ? (
                <div className="muted small pad">Type at least 2 letters. Finds words in task titles, notes, comments and checklist steps{providers.some(p => p.app === 'notes') ? ', and in note pages' : ''} — only what you can already open.</div>
              ) : results === null || (busy && !flat.length) ? (
                <div className="muted small pad">Searching…</div>
              ) : !flat.length ? (
                <div className="muted small pad">Nothing found for “{term}”.</div>
              ) : results.map(g => (
                <section key={g.label}>
                  <h4>{g.label}</h4>
                  {g.hits.map(h => {
                    n += 1;
                    const i = n;
                    return (
                      <button key={h.key} className={`search-hit ${i === sel ? 'sel' : ''} ${h.done ? 'done' : ''}`}
                        onMouseEnter={() => setSel(i)} onClick={() => choose(h)}>
                        <span className="sh-title"><Mark text={h.title} q={term} /></span>
                        {h.detail && <span className="sh-detail">{h.detail}</span>}
                        {h.snippet && <span className="sh-snippet"><Mark text={around(h.snippet, term)} q={term} /></span>}
                      </button>
                    );
                  })}
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
