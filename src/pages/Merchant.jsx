import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db, rpc, uploadMine } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { lkr, ref, fmtDate, fmtDateTime, personName, todayISO } from '../lib/format';
import { STATUS } from '../lib/workflow';
import { checkStatement, COMMISSION_RATE } from '../lib/merchant';
import { compressImage } from '../lib/image';
import { isPdf } from '../lib/merchantPdf';
import SignedImage from '../components/SignedImage';
import BankLinePicker from '../components/BankLinePicker';
import { cardNo } from '../components/DraftPicker';
import SaleInvoices, { useInvoicesOfAmount } from '../components/SaleInvoices';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const dayGap = (a, b) => Math.abs((new Date(`${a}T00:00:00`) - new Date(`${b}T00:00:00`)) / 86400000);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : /(s|sh|ch|x)$/.test(w) ? 'es' : 's'}`;

export function batchState(b) {
  if (b.post_status === 'posted') return { label: 'Posted in BC', tone: 'green' };
  if (b.post_status === 'posted_diff') return { label: 'BC differs', tone: 'red' };
  if (b.doc_no) return { label: 'Exported to BC', tone: 'blue' };
  if (b.drafts_open > 0) return { label: `${b.drafts_open} to set off`, tone: 'amber' };
  if (b.drafts_review > 0) return { label: `${b.drafts_review} with finance`, tone: 'amber' };
  if (!b.line_id) return { label: 'No Amana credit yet', tone: 'amber' };
  return { label: 'Ready for BC', tone: 'teal' };
}

// ---------------------------------------------------------------------------
// One merchant batch (one Pres. Dt, one HNBMS number) with its sales.
function BatchCard({ b, open, onToggle, parked, onChanged, focus }) {
  const { role } = useAuth();
  const [drafts, setDrafts] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [linking, setLinking] = useState(false);
  const [line, setLine] = useState(null);
  const [fix, setFix] = useState(null);
  const el = useRef(null);
  const exported = Boolean(b.doc_no);
  const fin = role === 'finance';
  const showNet = role !== 'sales';   // Sales see each sale at what the customer paid (the invoice value), not net of HNB's commission
  const openAmounts = useMemo(() => (exported ? [] : (drafts ?? []).filter((d) => !d.collection_id).map((d) => Number(d.amount))), [drafts, exported]);
  const invoicesOf = useInvoicesOfAmount(role === 'sales' || fin ? openAmounts : []);

  const loadDrafts = useCallback(async () => {
    const { data, error: e } = await db.from('merchant_drafts')
      .select('*, collection:collections(id, customer_name, customer_no, status, invoice_refs)')
      .eq('batch_id', b.id).order('txn_date').order('id');
    if (e) setError(e.message); else setDrafts(data ?? []);
  }, [b.id]);
  useEffect(() => { if (open) loadDrafts(); }, [open, loadDrafts, b.drafts_open, b.drafts_review]);
  useEffect(() => { if (focus) el.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [focus]);

  async function act(fn) {
    setBusy(true); setError('');
    try { await fn(); setLinking(false); setLine(null); setFix(null); await onChanged(); await loadDrafts(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  function setOff(d) {
    if (d.collection) return (
      <><Link to={`/c/${d.collection.id}`}>{ref(d.collection.id)}</Link> {d.collection.customer_name}
        <div className="muted small">{d.collection.invoice_refs ? `${d.collection.invoice_refs} · ` : ''}{STATUS[d.collection.status]?.label ?? d.collection.status}</div></>
    );
    if (d.collection_id) return <span className="muted">Set off by another sales person</span>;
    if (exported) return <span className="muted">—</span>;
    const mine = role === 'sales' ? parked.filter((p) => Math.abs(Number(p.collected_amount) - Number(d.amount)) < 0.005 && (!p.card_date || dayGap(p.card_date, d.txn_date) <= 1)) : [];
    return (
      <div className="ms-setoff">
        {mine.map((p) => (p.card_last4 && d.card_last4 && p.card_last4 !== d.card_last4
          ? <Link key={p.id} className="btn small" to={`/c/${p.id}`} title={`Card ending ${p.card_last4} on the slip, ${d.card_last4} here: check it on the payment`}>Check {ref(p.id)} {p.customer_name}</Link>
          : <button key={p.id} className="btn small primary" disabled={busy} onClick={() => act(() => rpc('cc_card_send', { p_id: p.id, p_draft_id: d.id, p_allow_mismatch: false }))}>
              Set off {ref(p.id)} {p.customer_name}</button>))}
        {(role === 'sales' || fin) && <Link className="small" to={`/card?draft=${d.id}`}>{mine.length ? 'Another customer' : 'Record card payment'}</Link>}
        {fin && <button className="link small" onClick={() => setFix({ id: d.id, txn_date: d.txn_date, card_first6: d.card_first6 ?? '', card_last4: d.card_last4 ?? '' })}>Correct</button>}
        {!fin && role !== 'sales' && <span className="warn-text small">Not set off</span>}
        {(role === 'sales' || fin) && !mine.length && <SaleInvoices draft={d} invoices={invoicesOf(d.amount)} />}
      </div>
    );
  }

  const st = batchState(b);
  return (
    <div className={`facts mbatch${focus ? ' focus' : ''}`} ref={el} id={`b${b.id}`}>
      <button type="button" className="mb-head" onClick={onToggle} aria-expanded={open}>
        <span className="mb-no">{b.hnbms_no}</span>
        <span className="mb-date">Batch {fmtDate(b.pres_date)}</span>
        <span className="mb-meta">{plural(Number(b.drafts), 'sale')} · {Number(b.drafts) - Number(b.drafts_open)} set off</span>
        <span className="mb-amt">LKR {lkr(b.gross)}{showNet && <span className="mb-net"> · net {lkr(b.net)}</span>}</span>
        <span className={`stamp tone-${st.tone}`}>{st.label}</span>
      </button>
      {open && (
        <div className="mb-body">
          <dl className="mb-facts">
            <dt>Sales (what customers paid)</dt><dd>LKR {lkr(b.gross)}</dd>
            {showNet && <><dt>HNB commission</dt><dd>LKR {lkr(b.commission)}</dd>
            <dt>Paid into Amana</dt><dd>{b.line_id ? <>LKR {lkr(b.bank_credit)} on {fmtDate(b.bank_date)}, ref {b.bank_ref}</> : <span className="warn-text">No Amana credit of LKR {lkr(b.net)} matched yet</span>}</dd></>}
            <dt>Business Central</dt><dd>{b.doc_no ? <>{b.doc_no}: {b.post_status === 'posted' ? 'posted' : b.post_status === 'posted_diff' ? 'posted with differences (see BC check)' : `exported ${b.export_count}×, not confirmed yet`}</> : <span className="muted">Not exported</span>}</dd>
            <dt>On statement{(b.statements ?? []).length === 1 ? '' : 's'}</dt><dd>{(b.statements ?? []).map((s, i) => <span key={s}>{i > 0 && ', '}<Link to={`/merchant/s/${s}`}>No. {s}</Link></span>)}</dd>
          </dl>
          {error && <p className="error">{error}</p>}
          {drafts === null ? <p className="muted">Loading the sales…</p> : (
            <div className="table-wrap flat">
              <table className="table">
                <thead><tr><th>Sale date</th><th>Card</th><th className="num">{showNet ? 'Amount' : 'Sale value'}</th>{showNet && <><th className="num hide-sm">Commission</th><th className="num hide-sm">Net</th></>}<th>Set off against</th></tr></thead>
                <tbody>
                  {drafts.map((d) => (
                    <Fragment key={d.id}>
                      <tr className={!d.collection_id && !exported ? 'row-open' : ''}>
                        <td>{fmtDate(d.txn_date)}</td><td className="mono">{cardNo(d.card_first6, d.card_last4)}</td>
                        <td className="num">{lkr(d.amount)}</td>{showNet && <><td className="num hide-sm">{lkr(d.commission)}</td><td className="num hide-sm">{lkr(d.net)}</td></>}
                        <td>{setOff(d)}</td>
                      </tr>
                      {fix?.id === d.id && (
                        <tr className="sub-row"><td colSpan={showNet ? 6 : 4}>
                          <div className="row">
                            <label className="inline-field">Sale date <input type="date" value={fix.txn_date} max={b.pres_date} onChange={(e) => setFix({ ...fix, txn_date: e.target.value })} /></label>
                            <label className="inline-field">Card first 6 <input inputMode="numeric" maxLength={6} value={fix.card_first6} onChange={(e) => setFix({ ...fix, card_first6: e.target.value })} /></label>
                            <label className="inline-field">Last 4 <input inputMode="numeric" maxLength={4} value={fix.card_last4} onChange={(e) => setFix({ ...fix, card_last4: e.target.value })} /></label>
                            <button className="btn small primary" disabled={busy} onClick={() => act(() => rpc('cc_merchant_fix_draft', { p_draft_id: d.id, p: fix }))}>Save</button>
                            <button className="link" onClick={() => setFix(null)}>Cancel</button>
                          </div>
                          <p className="hint">Only the date and card number can be corrected. A wrong amount means the statement was misread: remove the statement and add it again.</p>
                        </td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={2}>Batch total{showNet && b.printed_total != null ? ` (statement prints ${lkr(b.printed_total)} net)` : ''}</td>
                  <td className="num">{lkr(b.gross)}</td>{showNet && <><td className="num hide-sm">{lkr(b.commission)}</td><td className="num hide-sm">{lkr(b.net)}</td></>}<td /></tr></tfoot>
              </table>
            </div>
          )}
          {fin && !exported && (
            <div className="mb-link">
              {b.line_id ? (
                <button className="btn small ghost" disabled={busy} onClick={() => act(() => rpc('cc_merchant_link_line', { p_batch_id: b.id, p_line_id: null }))}>Unlink the Amana credit</button>
              ) : linking ? (
                <>
                  <p className="hint">Amana credits from HNB of exactly LKR {lkr(b.net)} not linked to a batch:</p>
                  <BankLinePicker merchant exact={r2(b.net)} value={line?.id} onChange={setLine} showAccount />
                  <div className="row">
                    <button className="btn small primary" disabled={busy || !line} onClick={() => act(() => rpc('cc_merchant_link_line', { p_batch_id: b.id, p_line_id: line.id }))}>Link</button>
                    <button className="link" onClick={() => setLinking(false)}>Cancel</button>
                  </div>
                </>
              ) : <button className="btn small" onClick={() => setLinking(true)}>Link the Amana credit</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function useParkedCards(role) {
  const [parked, setParked] = useState([]);
  const load = useCallback(async () => {
    if (role !== 'sales') { setParked([]); return; }
    const { data } = await db.from('collections').select('id, customer_name, collected_amount, card_date, card_last4')
      .eq('kind', 'card').eq('status', 'parked');
    setParked(data ?? []);
  }, [role]);
  useEffect(() => { load(); }, [load]);
  return [parked, load];
}

// ---------------------------------------------------------------------------
// The list: batches still to finish, all batches, statements, and HNB credits with no batch yet.
export function MerchantPage() {
  const { role } = useAuth();
  const [params] = useSearchParams();
  const focusId = Number(params.get('batch')) || null;
  const [batches, setBatches] = useState(null);
  const [stmts, setStmts] = useState([]);
  const [waiting, setWaiting] = useState([]);
  const [parked, loadParked] = useParkedCards(role);
  const [tab, setTab] = useState(null);
  const [openIds, setOpenIds] = useState(() => new Set(focusId ? [focusId] : []));
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [b, s, w] = await Promise.all([
        rpc('cc_merchant_batches'),
        db.from('merchant_statements').select('id, as_at, drafts_in, net_in, created_at, note, creator:profiles(full_name, email), merchant_statement_batches(batch_id)').order('id', { ascending: false }),
        db.from('bank_credits').select('*').is('link_kind', null).ilike('narration', '%MERCHANT SLIPS%').order('txn_date'),
      ]);
      if (s.error) throw new Error(s.error.message);
      setBatches(b ?? []); setStmts(s.data ?? []); setWaiting(w.data ?? []);
    } catch (e) { setError(e.message); setBatches((x) => x ?? []); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const reload = async () => { await Promise.all([load(), loadParked()]); };

  const byId = useMemo(() => Object.fromEntries((batches ?? []).map((b) => [b.id, b])), [batches]);
  if (batches === null) return <p className="muted">Loading…</p>;
  const unfinished = batches.filter((b) => b.post_status !== 'posted');
  const toSetOff = batches.filter((b) => !b.doc_no).reduce((a, b) => a + Number(b.drafts_open), 0);
  const withFinance = batches.reduce((a, b) => a + Number(b.drafts_review), 0);
  const focusPosted = focusId && byId[focusId]?.post_status === 'posted';
  const active = tab ?? (focusPosted ? 'all' : 'open');
  const toggle = (id) => setOpenIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const range = (s) => {
    const nos = (s.merchant_statement_batches ?? []).map((x) => byId[x.batch_id]).filter(Boolean).sort((a, b) => a.pres_date.localeCompare(b.pres_date));
    if (!nos.length) return <span className="muted">nothing taken over</span>;
    return `${nos[0].hnbms_no}${nos.length > 1 ? ` to ${nos[nos.length - 1].hnbms_no}` : ''} (${fmtDate(nos[0].pres_date)}${nos.length > 1 ? ` – ${fmtDate(nos[nos.length - 1].pres_date)}` : ''})`;
  };
  const gross = (s) => (s.merchant_statement_batches ?? []).reduce((a, x) => a + Number(byId[x.batch_id]?.gross ?? 0), 0);
  const tabs = [
    { key: 'open', label: 'To finish', n: unfinished.length },
    { key: 'all', label: 'All batches', n: batches.length },
    { key: 'statements', label: 'Statements', n: stmts.length },
    ...(role !== 'sales' ? [{ key: 'amana', label: 'Amana credits without a batch', n: waiting.length }] : []),
  ];
  const list = active === 'open' ? unfinished : batches;

  return (
    <section className="wide">
      <div className="page-head">
        <h1>HNB merchant statements</h1>
        <div className="row">
          {role === 'finance' && <Link className="btn primary" to="/merchant/new">Add a statement</Link>}
          {(role === 'sales' || role === 'finance') && <Link className="btn" to="/card">Record card payment</Link>}
        </div>
      </div>
      {role === 'sales' ? (
        <p className="lede">Every card sale on HNB's statements, at what the customer paid (the invoice value). Set each sale off against its card payment;
          for a sale nobody has recorded yet, the open invoices of exactly that value are shown under it.</p>
      ) : (
        <p className="lede">HNB pays card sales in batches: each batch (one processing date) gets an HNBMS number, and its net after the 3% commission arrives in Amana.
          Sales set each sale off against the card payment it belongs to; when every sale in a batch is set off, reviewed and its Amana credit matched, the batch goes to BC as one BAKRC document.</p>
      )}
      {error && <p className="error">{error}</p>}

      <div className="kpis">
        <div><span>{toSetOff}</span>sales not set off yet<small>across {plural(batches.filter((b) => Number(b.drafts_open) > 0 && !b.doc_no).length, 'batch')}</small></div>
        <div><span>{withFinance}</span>card payments with finance<small>set off, waiting for review</small></div>
        {role !== 'sales' && <div><span>{waiting.length}</span>Amana credits without a batch<small>LKR {lkr(waiting.reduce((a, l) => a + Number(l.credit), 0))}</small></div>}
        {role === 'sales' && <div><span>{parked.length}</span>your parked card payments<small>waiting for their statement</small></div>}
      </div>

      <div className="tabs report-tabs" role="tablist">
        {tabs.map((t) => <button key={t.key} role="tab" aria-selected={active === t.key} className={active === t.key ? 'tab on' : 'tab'} onClick={() => setTab(t.key)}>{t.label} <span className="count">{t.n}</span></button>)}
      </div>

      {(active === 'open' || active === 'all') && (
        <div className="mbatches">
          {list.length === 0 && <div className="empty"><p>{active === 'open' ? 'Every batch is posted in BC.' : 'No merchant statements added yet.'}</p></div>}
          {list.map((b) => <BatchCard key={b.id} b={b} open={openIds.has(b.id)} onToggle={() => toggle(b.id)} parked={parked} onChanged={reload} focus={b.id === focusId} />)}
        </div>
      )}

      {active === 'statements' && (
        stmts.length === 0 ? <div className="empty"><p>No statements added yet.</p></div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>No.</th><th>As at</th><th>Batches</th><th className="num">Sales</th><th className="num">Sale value LKR</th>{role !== 'sales' && <th className="num">Net LKR</th>}<th>Added</th></tr></thead>
              <tbody>{stmts.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/merchant/s/${s.id}`}><strong>No. {s.id}</strong></Link></td>
                  <td>{fmtDate(s.as_at)}</td><td>{range(s)}</td>
                  <td className="num">{s.drafts_in}</td><td className="num">{lkr(gross(s))}</td>{role !== 'sales' && <td className="num">{lkr(s.net_in)}</td>}
                  <td>{fmtDateTime(s.created_at)}<div className="muted small">{personName(s.creator)}</div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )
      )}

      {active === 'amana' && (
        <div className="facts">
          <h2>HNB settlements in Amana with no batch</h2>
          <p className="hint">Each should match a batch once its merchant statement is added (exact net, credited on or within a week after the batch date).
            If two credits have the same amount, link the right one on the batch by hand.</p>
          {waiting.length === 0 ? <p className="muted">None.</p> : (
            <div className="table-wrap flat"><table className="table">
              <thead><tr><th>Date</th><th>Narration</th><th className="num">LKR</th></tr></thead>
              <tbody>{waiting.map((l) => <tr key={l.id}><td>{fmtDate(l.txn_date)}</td><td className="narr">{l.narration}</td><td className="num">{lkr(l.credit)}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// One statement as added: its screenshots and the batches it brought.
export function MerchantStatement() {
  const { id } = useParams();
  const { role } = useAuth();
  const nav = useNavigate();
  const saved = useLocation().state?.saved ?? null;
  const [s, setS] = useState(undefined);
  const [batches, setBatches] = useState([]);
  const [parked, loadParked] = useParkedCards(role);
  const [openIds, setOpenIds] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        db.from('merchant_statements').select('*, creator:profiles(full_name, email), merchant_statement_batches(batch_id)').eq('id', id).maybeSingle(),
        rpc('cc_merchant_batches'),
      ]);
      if (a.error) throw new Error(a.error.message);
      setS(a.data ?? null);
      const ids = new Set((a.data?.merchant_statement_batches ?? []).map((x) => x.batch_id));
      const mine = (b ?? []).filter((x) => ids.has(x.id)).sort((x, y) => x.pres_date.localeCompare(y.pres_date));
      setBatches(mine);
      setOpenIds((o) => o ?? new Set(mine.map((x) => x.id)));
    } catch (e) { setError(e.message); setS((x) => (x === undefined ? null : x)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function remove() {
    if (!window.confirm(`Remove merchant statement No. ${id}? Sales it brought are removed, and batches left with no sales are deleted (their HNBMS numbers are not reused).`)) return;
    setBusy(true); setError('');
    try { await rpc('cc_merchant_delete', { p_statement_id: Number(id) }); nav('/merchant'); }
    catch (e) { setError(e.message); setBusy(false); }
  }

  if (s === undefined) return <p className="muted">Loading…</p>;
  if (s === null) return <div className="empty"><p>{error || 'This statement doesn\'t exist.'}</p><Link to="/merchant">Back to merchant statements</Link></div>;
  const toggle = (bid) => setOpenIds((o) => { const n = new Set(o); n.has(bid) ? n.delete(bid) : n.add(bid); return n; });

  return (
    <section className="wide">
      <Link to="/merchant" className="back">Merchant statements</Link>
      <div className="page-head"><h1>Merchant statement No. {s.id}</h1></div>
      <p className="lede">As at {fmtDate(s.as_at)} · {plural(s.drafts_in, 'sale')}, {role === 'sales'
        ? `LKR ${lkr(batches.reduce((a, x) => a + Number(x.gross ?? 0), 0))} paid by customers`
        : `net LKR ${lkr(s.net_in)}`} · added {fmtDateTime(s.created_at)} by {personName(s.creator)}</p>
      {s.note && <p className="quote">{s.note}</p>}
      {saved && (
        <div className="facts ok-box">
          <h2>Statement saved</h2>
          <ul className="plain">
            {saved.new_batches.length > 0 && <li>New batch{saved.new_batches.length > 1 ? 'es' : ''}: {saved.new_batches.map((x) => `${x.hnbms_no} (${fmtDate(x.pres_date)})`).join(', ')}</li>}
            {saved.known_batches.length > 0 && <li>Already held from an earlier statement: {saved.known_batches.map((x) => `${x.hnbms_no} (${fmtDate(x.pres_date)})`).join(', ')}</li>}
            <li>{plural(saved.new_drafts, 'new sale')} added{saved.already_held > 0 ? `; ${plural(saved.already_held, 'sale')} already held, not added again` : ''}.</li>
            {saved.skipped.length > 0 && <li>Not taken over (before the app's start date, kept in the workbook): {saved.skipped.map((x) => `${fmtDate(x.pres_date)} (${plural(x.drafts, 'sale')})`).join(', ')}</li>}
          </ul>
          <p className="hint">Sales with a parked card payment of a matching amount have been told.</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <div className="mbatches">
        {batches.length === 0 && <p className="muted">No batches from this statement were taken over.</p>}
        {batches.map((b) => <BatchCard key={b.id} b={b} open={openIds?.has(b.id)} onToggle={() => toggle(b.id)} parked={parked} onChanged={async () => { await load(); await loadParked(); }} />)}
      </div>

      <div className="facts">
        <h2>{s.images.some((p) => /\.pdf$/i.test(p)) ? 'Statement PDF' : 'Screenshots'}</h2>
        {s.images.length === 0 ? <p className="muted">None attached.</p> : (
          <div className="ms-shots">{s.images.map((p, i) => (/\.pdf$/i.test(p)
            ? <div key={p}><SignedImage path={p} alt="the statement" /><p className="hint">It opens with the HNB statement password.</p></div>
            : <div key={p}><span className="muted small">Screenshot {i + 1}</span><SignedImage path={p} alt={`Screenshot ${i + 1}`} /></div>))}</div>
        )}
      </div>
      {role === 'finance' && (
        <div className="quiet-actions">
          <button className="btn ghost danger-text" disabled={busy} onClick={remove}>Remove this statement</button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Finance adds a statement: screenshots → the app reads them → finance checks every line → save.
let seq = 0;
const key = () => `k${++seq}`;
const asText = (n) => (n == null || Number.isNaN(n) ? '' : Number(n).toFixed(2));
const num = (v) => {
  const t = String(v ?? '').replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? r2(n) : null;
};
const blankDraft = (date = '') => ({ k: key(), txn_date: date, card_first6: '', card_last4: '', amount: '', commission: '', net: '', raw: '' });

function toGrid(st) {
  return {
    asAt: st.asAt ?? '',
    batches: st.batches.map((b) => ({
      k: key(), pres_date: b.pres_date ?? '', printed_total: asText(b.printed_total),
      drafts: b.drafts.map((d) => ({ k: key(), txn_date: d.txn_date ?? '', card_first6: d.card_first6 ?? '', card_last4: d.card_last4 ?? '',
        amount: asText(d.amount), commission: asText(d.commission), net: asText(d.net), raw: d.raw ?? '' })),
    })),
  };
}

// A batch the app already holds is never re-read: its sales are taken from the app
// (a processed batch doesn't change), and what the screenshot shows is only compared.
function gridToStatement(g, rate, held = {}, start = '') {
  const read = (b) => b.drafts.map((d) => ({ txn_date: d.txn_date || null, card_first6: d.card_first6.replace(/\D/g, ''), card_last4: d.card_last4.replace(/\D/g, ''),
    amount: num(d.amount), commission: num(d.commission), net: num(d.net) }));
  const st = checkStatement({
    asAt: g.asAt || null, unread: [],
    batches: g.batches.map((b) => {
      const h = b.pres_date && b.pres_date >= start ? held[b.pres_date] : null;
      if (!h) return { pres_date: b.pres_date || null, printed_total: num(b.printed_total), drafts: read(b) };
      const shown = read(b);
      const sum = (l, k) => r2(l.reduce((a, d) => a + (Number(d[k]) || 0), 0));
      const drafts = h.merchant_drafts.map((d) => ({ ...d, amount: Number(d.amount), commission: Number(d.commission), net: Number(d.net) }))
        .sort((x, y) => x.txn_date.localeCompare(y.txn_date));
      return { pres_date: b.pres_date, printed_total: h.printed_total != null ? Number(h.printed_total) : sum(drafts, 'net'), drafts,
        held: h, readCount: shown.length, readNet: sum(shown, 'net'), differs: shown.length !== drafts.length || Math.abs(sum(shown, 'net') - sum(drafts, 'net')) >= 0.005 };
    }),
  }, rate);
  const seen = new Set();
  for (const b of st.batches) {
    if (b.pres_date && seen.has(b.pres_date)) { b.problems.push('Another batch has the same date: merge them'); st.problems++; }
    seen.add(b.pres_date);
  }
  return st;
}

export function MerchantAdd() {
  const nav = useNavigate();
  const [files, setFiles] = useState([]);   // [{ k, file, url }]
  const [pdf, setPdf] = useState(null);     // { k, file } — a statement PDF instead of screenshots
  const [pw, setPw] = useState({ ask: false, wrong: false, value: '', remember: true });
  const [pages, setPages] = useState([]);   // the PDF's pages drawn, to check against
  const [footerFromPdf, setFooterFromPdf] = useState(false);
  const [stage, setStage] = useState('pick');
  const [progress, setProgress] = useState({ text: '', f: 0 });
  const [grid, setGrid] = useState(null);
  const [unread, setUnread] = useState([]);
  const [dropped, setDropped] = useState(0);
  const [texts, setTexts] = useState([]);
  const [footerCount, setFooterCount] = useState('');
  const [footerNet, setFooterNet] = useState('');
  const [firstNo, setFirstNo] = useState('');
  const [note, setNote] = useState('');
  const [known, setKnown] = useState({});
  const [settings, setSettings] = useState(null);
  const [series, setSeries] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const uploaded = useRef({});

  useEffect(() => {
    Promise.all([
      db.from('merchant_settings').select('*').maybeSingle(),
      db.from('doc_series').select('prefix, width, next_no').eq('code', 'HNBMS').maybeSingle(),
      db.from('merchant_batches').select('id, pres_date, hnbms_no, printed_total, merchant_drafts(txn_date, card_first6, card_last4, amount, commission, net)'),
    ]).then(([a, b, c]) => {
      setSettings(a.data ?? { rate: COMMISSION_RATE, start_date: '2026-10-01' });
      setSeries(b.data ?? { prefix: 'HNBMS-', width: 4, next_no: null });
      setKnown(Object.fromEntries((c.data ?? []).map((x) => [x.pres_date, x])));
    });
  }, []);

  const addFiles = useCallback((list) => {
    const all = [...list];
    const doc = all.find(isPdf);
    if (doc) {   // one PDF is the whole statement: it replaces any screenshots
      setPdf({ k: key(), file: doc }); setFiles([]); setPw((x) => ({ ...x, ask: false, wrong: false })); setError('');
      return;
    }
    const imgs = all.filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    setPdf(null);
    setFiles((fs) => [...fs, ...imgs.map((file) => ({ k: key(), file, url: URL.createObjectURL(file) }))]);
  }, []);
  useEffect(() => {
    if (stage !== 'pick') return undefined;
    const onPaste = (e) => { const fl = e.clipboardData?.files; if (fl?.length) { e.preventDefault(); addFiles(fl); } };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [stage, addFiles]);

  const move = (i, d) => setFiles((fs) => { const n = [...fs]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); return n; });
  const rate = Number(settings?.rate ?? COMMISSION_RATE);

  async function read() {
    if (pdf) return readPdf();
    setStage('reading'); setError(''); setProgress({ text: 'Starting…', f: 0 });
    try {
      const { readStatementImages } = await import('../lib/merchantOcr');
      const r = await readStatementImages(files.map((f) => f.file), (text, f) => setProgress({ text, f }));
      setGrid(toGrid(r.statement)); setUnread(r.statement.unread); setDropped(r.dropped); setTexts(r.texts);
      setStage('review');
    } catch (e) {
      setError(`The screenshots couldn't be read (${e.message}). You can type the statement in instead.`);
      setStage('pick');
    }
  }
  async function readPdf() {
    setStage('reading'); setError(''); setProgress({ text: 'Opening the PDF…', f: 0 });
    const typed = pw.ask && pw.value.trim();
    try {
      const { readStatementPdf, PdfPasswordError } = await import('../lib/merchantPdf');
      let r;
      try {
        r = await readStatementPdf(pdf.file, typed || settings?.pdf_password || '', (text, f) => setProgress({ text, f }));
      } catch (e) {
        if (e instanceof PdfPasswordError) {
          setPw((x) => ({ ...x, ask: true, wrong: Boolean(typed) }));
          setStage('pick');
          return;
        }
        throw e;
      }
      if (typed && pw.remember && typed !== settings?.pdf_password) {
        rpc('cc_merchant_set_pdf_password', { p_password: typed }).then(() => setSettings((x) => ({ ...x, pdf_password: typed }))).catch(() => {});
      }
      setGrid(toGrid(r.statement)); setUnread(r.statement.unread); setDropped(r.dropped); setTexts(r.texts); setPages(r.pages);
      if (r.footer) { setFooterCount(String(r.footer.count)); setFooterNet(r.footer.net.toFixed(2)); setFooterFromPdf(true); } else setFooterFromPdf(false);
      setStage('review');
    } catch (e) {
      setError(`The PDF couldn't be read (${e.message}). You can add screenshots or type the statement in instead.`);
      setStage('pick');
    }
  }
  const typeIn = () => { setGrid({ asAt: '', batches: [{ k: key(), pres_date: '', printed_total: '', drafts: [blankDraft()] }] }); setStage('review'); };

  // grid edits
  const setB = (bk, patch) => setGrid((g) => ({ ...g, batches: g.batches.map((b) => (b.k === bk ? { ...b, ...patch } : b)) }));
  const setD = (bk, dk, field, value) => setGrid((g) => ({
    ...g, batches: g.batches.map((b) => (b.k !== bk ? b : { ...b, drafts: b.drafts.map((d) => {
      if (d.k !== dk) return d;
      const n = { ...d, [field]: value };
      const a = num(n.amount);
      if (field === 'amount' && a != null) { n.commission = asText(r2(a * rate)); n.net = asText(r2(a - r2(a * rate))); }
      if (field === 'commission' && a != null && num(value) != null) n.net = asText(r2(a - num(value)));
      return n;
    }) })),
  }));
  const addDraft = (bk) => setGrid((g) => ({ ...g, batches: g.batches.map((b) => (b.k === bk ? { ...b, drafts: [...b.drafts, blankDraft(b.drafts[b.drafts.length - 1]?.txn_date ?? '')] } : b)) }));
  const delDraft = (bk, dk) => setGrid((g) => ({ ...g, batches: g.batches.map((b) => (b.k === bk ? { ...b, drafts: b.drafts.filter((d) => d.k !== dk) } : b)) }));
  const addBatch = () => setGrid((g) => ({ ...g, batches: [...g.batches, { k: key(), pres_date: '', printed_total: '', drafts: [blankDraft()] }] }));
  const delBatch = (bk) => setGrid((g) => ({ ...g, batches: g.batches.filter((b) => b.k !== bk) }));

  const start = settings?.start_date ?? '2026-10-01';
  const st = useMemo(() => (grid ? gridToStatement(grid, rate, known, start) : null), [grid, rate, known, start]);
  const nextNo = series?.next_no ?? (Number(firstNo) || null);
  const fmtNo = (n) => `${series?.prefix ?? 'HNBMS-'}${String(n).padStart(series?.width ?? 4, '0')}`;
  const newBatches = useMemo(() => (st ? [...new Set(st.batches.map((b) => b.pres_date).filter((d) => d && d >= start && !known[d]))].sort() : []), [st, start, known]);
  const lastDate = st ? st.batches.map((b) => b.pres_date).filter(Boolean).sort().pop() : null;
  const fCount = footerCount.trim() === '' ? null : Number(footerCount);
  const fNet = num(footerNet);
  const footerOk = st && fCount != null && fNet != null && fCount === st.count && Math.abs(fNet - st.net) < 0.005;
  const canSave = st && st.problems === 0 && st.count > 0 && footerOk && (!newBatches.length || nextNo) && !busy;

  async function save() {
    setBusy(true); setError('');
    try {
      const images = [];
      if (pdf) {   // the PDF itself is kept, as received (still password protected)
        if (!uploaded.current[pdf.k]) uploaded.current[pdf.k] = await uploadMine(pdf.file, 'merchant', 'pdf', 'application/pdf');
        images.push(uploaded.current[pdf.k]);
      }
      for (const f of files) {
        if (!uploaded.current[f.k]) uploaded.current[f.k] = await uploadMine(await compressImage(f.file, 2400, 0.92), 'merchant', 'jpg', 'image/jpeg');
        images.push(uploaded.current[f.k]);
      }
      const p = {
        as_at: grid.asAt || lastDate, images, note, footer_count: fCount, footer_net: fNet,
        first_hnbms: series?.next_no ? null : Number(firstNo) || null,
        batches: st.batches.map((b) => ({ pres_date: b.pres_date, printed_total: b.printed_total,
          drafts: b.drafts.map((d) => ({ txn_date: d.txn_date, card_first6: d.card_first6 || null, card_last4: d.card_last4 || null, amount: d.amount, commission: d.commission, net: d.net })) })),
      };
      const r = await rpc('cc_merchant_save', { p });
      nav(`/merchant/s/${r.statement_id}`, { state: { saved: r } });
    } catch (e) { setError(e.message); setBusy(false); }
  }

  if (stage === 'pick' || stage === 'reading') return (
    <section className="narrow">
      <Link to="/merchant" className="back">Merchant statements</Link>
      <div className="page-head"><h1>Add a merchant statement</h1></div>
      <p className="lede">Add the HNB merchant statement PDF, as HNB sent it: the app opens it with the statement password and reads every line exactly.
        Screenshots still work (in order, top to bottom; overlaps are counted once). Either way you check every line before saving.</p>
      <div className="facts">
        <div className="row">
          <label className="btn file-btn primary">Choose the PDF<input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} /></label>
          <label className="btn file-btn">Choose screenshots<input type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} /></label>
          <span className="hint">or paste screenshots here (Ctrl+V)</span>
        </div>
        {pdf && (
          <div className="ms-pdf">
            <span className="ms-pdf-name">{pdf.file.name}</span>
            <button className="link danger-text" disabled={stage === 'reading'} onClick={() => { setPdf(null); setPw((x) => ({ ...x, ask: false, wrong: false, value: '' })); }}>Remove</button>
          </div>
        )}
        {pdf && pw.ask && stage !== 'reading' && (
          <div className="ms-password">
            <p className={pw.wrong ? 'error' : 'warn-text'}>{pw.wrong ? "That password doesn't open this PDF. Check it and try again." : settings?.pdf_password ? "The saved statement password doesn't open this PDF. Enter its password." : 'This PDF is password protected. Enter its password.'}</p>
            <div className="row">
              <label className="field"><span className="flabel">PDF password</span>
                <input type="password" autoComplete="off" value={pw.value} onChange={(e) => setPw((x) => ({ ...x, value: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && pw.value.trim()) read(); }} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={pw.remember} onChange={(e) => setPw((x) => ({ ...x, remember: e.target.checked }))} /> Use this password for statements from now on</label>
          </div>
        )}
        {files.length > 0 && (
          <ol className="ms-files">
            {files.map((f, i) => (
              <li key={f.k}>
                <img src={f.url} alt={`Screenshot ${i + 1}`} />
                <span>{i + 1}. {f.file.name || 'Pasted screenshot'}</span>
                <span className="row">
                  <button className="link" disabled={i === 0 || stage === 'reading'} onClick={() => move(i, -1)} aria-label="Move up">Up</button>
                  <button className="link" disabled={i === files.length - 1 || stage === 'reading'} onClick={() => move(i, 1)} aria-label="Move down">Down</button>
                  <button className="link danger-text" disabled={stage === 'reading'} onClick={() => setFiles((fs) => fs.filter((x) => x.k !== f.k))}>Remove</button>
                </span>
              </li>
            ))}
          </ol>
        )}
        {stage === 'reading' ? (
          <div className="ms-progress" role="status">
            <div className="ms-bar"><i style={{ width: `${Math.round(progress.f * 100)}%` }} /></div>
            <span>{progress.text}</span>
          </div>
        ) : (
          <div className="row">
            <button className="btn primary" disabled={!files.length && !pdf} onClick={read}>{pdf ? 'Read the PDF' : 'Read the screenshots'}</button>
            <button className="btn ghost" onClick={typeIn}>Type it in instead</button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </section>
  );

  const stateOf = (b) => {
    if (!b.pres_date) return { label: 'Enter the batch date', tone: 'red' };
    if (b.pres_date < start) return { label: `Before ${fmtDate(start)}: not taken over`, tone: 'grey' };
    if (known[b.pres_date]) return { label: `Already held as ${known[b.pres_date].hnbms_no}: nothing changes`, tone: 'blue' };
    const i = newBatches.indexOf(b.pres_date);
    return { label: nextNo ? `New: ${fmtNo(nextNo + i)}` : 'New: enter the first HNBMS number below', tone: 'teal' };
  };

  return (
    <div className="split-page ms-review">
      <section className="ms-main">
        <Link to="/merchant" className="back">Merchant statements</Link>
        <div className="page-head"><h1>Check the statement</h1></div>
        <p className="lede">Compare every line with the {pdf ? 'statement' : 'screenshots'}. Each sale must have commission = {Math.round(rate * 100)}% of the amount and net = amount less commission,
          and each batch must add up to its printed total. Changing an amount fills in the commission and net.</p>
        {dropped > 0 && <p className="hint">{plural(dropped, 'row')} showed in two screenshots and {dropped === 1 ? 'was' : 'were'} counted once. Check the join between screenshots.</p>}
        {unread.length > 0 && (
          <div className="notice">
            <strong>Lines the reader couldn't place.</strong> Check each against the screenshot and add it if it's a sale:
            <ul className="plain mono small">{unread.map((u) => <li key={u}>{u}</li>)}</ul>
          </div>
        )}

        {grid.batches.map((b, bi) => {
          const sb = st.batches[bi];
          const s = stateOf(b);
          return (
            <div className="facts ms-batch" key={b.k}>
              <div className="ms-batch-head">
                <label className="inline-field">Batch date (Pres. Dt)<input type="date" value={b.pres_date} onChange={(e) => setB(b.k, { pres_date: e.target.value })} /></label>
                {!sb.held && <label className="inline-field">Printed total (Processing Dt. Ttl)<input inputMode="decimal" value={b.printed_total} onChange={(e) => setB(b.k, { printed_total: e.target.value })} /></label>}
                <span className={`stamp tone-${s.tone}`}>{s.label}</span>
                <button className="link danger-text" onClick={() => delBatch(b.k)}>Remove batch</button>
              </div>
              {sb.held ? (
                <div className="ms-held">
                  <p className="hint">The app already holds this batch, so its sales are taken from the app and nothing is added.
                    {sb.differs
                      ? <strong className="warn-text"> The screenshot reads {plural(sb.readCount, 'sale')}, net {lkr(sb.readNet)}; the app holds {plural(sb.drafts.length, 'sale')}, net {lkr(sb.net_total)}. Check the screenshot: the app keeps its copy.</strong>
                      : ' The screenshot agrees with it.'}</p>
                  <div className="table-wrap flat"><table className="table">
                    <thead><tr><th>Sale date</th><th>Card</th><th className="num">Amount</th><th className="num">Commission</th><th className="num">Net</th></tr></thead>
                    <tbody>{sb.drafts.map((d, i) => <tr key={i}><td>{fmtDate(d.txn_date)}</td><td className="mono">{cardNo(d.card_first6, d.card_last4)}</td>
                      <td className="num">{lkr(d.amount)}</td><td className="num">{lkr(d.commission)}</td><td className="num">{lkr(d.net)}</td></tr>)}</tbody>
                    <tfoot><tr><td colSpan={4}>Held net</td><td className="num">{lkr(sb.net_total)}</td></tr></tfoot>
                  </table></div>
                </div>
              ) : (
                <>
                <div className="table-wrap flat">
                  <table className="table ms-grid">
                    <thead><tr><th>Sale date</th><th>Card first 6</th><th>Last 4</th><th className="num">Amount</th><th className="num">Commission</th><th className="num">Net</th><th aria-label="Remove" /></tr></thead>
                    <tbody>
                      {b.drafts.map((d, di) => {
                        const sd = sb.drafts[di];
                        return (
                          <Fragment key={d.k}>
                            <tr className={sd.problems.length ? 'bad' : ''}>
                              <td><input type="date" value={d.txn_date} max={b.pres_date || undefined} onChange={(e) => setD(b.k, d.k, 'txn_date', e.target.value)} aria-label="Sale date" /></td>
                              <td><input className="mono" inputMode="numeric" maxLength={6} value={d.card_first6} onChange={(e) => setD(b.k, d.k, 'card_first6', e.target.value)} aria-label="Card first 6" /></td>
                              <td><input className="mono" inputMode="numeric" maxLength={4} value={d.card_last4} onChange={(e) => setD(b.k, d.k, 'card_last4', e.target.value)} aria-label="Card last 4" /></td>
                              <td><input className="num" inputMode="decimal" value={d.amount} onChange={(e) => setD(b.k, d.k, 'amount', e.target.value)} aria-label="Amount" /></td>
                              <td><input className="num" inputMode="decimal" value={d.commission} onChange={(e) => setD(b.k, d.k, 'commission', e.target.value)} aria-label="Commission" /></td>
                              <td><input className="num" inputMode="decimal" value={d.net} onChange={(e) => setD(b.k, d.k, 'net', e.target.value)} aria-label="Net" /></td>
                              <td><button className="link danger-text ms-x" onClick={() => delDraft(b.k, d.k)} aria-label="Remove this sale" title="Remove this sale">✕</button></td>
                            </tr>
                            {(sd.problems.length > 0 || sd.warnings.length > 0) && (
                              <tr className="sub-row"><td colSpan={7}>
                                {sd.problems.map((p) => <span key={p} className="error small">{p}. </span>)}
                                {sd.warnings.map((p) => <span key={p} className="warn-text small">{p}. </span>)}
                                {d.raw && <div className="muted small mono">Read as: {d.raw}</div>}
                              </td></tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot><tr><td colSpan={5}>Sales add up to (net)</td><td className="num">{lkr(sb.net_total)}</td><td /></tr></tfoot>
                  </table>
                </div>
                {sb.problems.map((p) => <p key={p} className="error small">{p}</p>)}
                {sb.warnings.map((p) => <p key={p} className="warn-text small">{p}</p>)}
                <button className="btn small" onClick={() => addDraft(b.k)}>Add a sale</button>
                </>
              )}
            </div>
          );
        })}
        <p><button className="btn small ghost" onClick={addBatch}>Add a batch</button></p>

        <div className="facts ms-save">
          <h2>Statement totals</h2>
          <dl>
            <dt>Sales read</dt><dd>{st.count}</dd>
            <dt>Gross</dt><dd>LKR {lkr(st.gross)}</dd>
            <dt>Commission</dt><dd>LKR {lkr(st.commission)}</dd>
            <dt>Net</dt><dd>LKR {lkr(st.net)}</dd>
          </dl>
          <p className="hint">{footerFromPdf
            ? "Read from the totals box at the bottom of the PDF. They must equal what's above, so a missed line can't slip through."
            : "Type the totals printed at the bottom of the statement. They must equal what's above, so a missed or misread line can't slip through."}</p>
          <div className="grid2">
            <label className="field"><span className="flabel">Number of sales on the statement</span>
              <input inputMode="numeric" value={footerCount} onChange={(e) => setFooterCount(e.target.value.replace(/\D/g, ''))} /></label>
            <label className="field"><span className="flabel">Total net amount on the statement (LKR)</span>
              <input inputMode="decimal" value={footerNet} onChange={(e) => setFooterNet(e.target.value)} /></label>
          </div>
          {fCount != null && fNet != null && !footerOk && (
            <p className="error">The statement says {plural(fCount, 'sale')}, LKR {lkr(fNet)}; the lines above are {plural(st.count, 'sale')}, LKR {lkr(st.net)}. Find the missing or misread line.</p>
          )}
          <div className="grid2">
            <label className="field"><span className="flabel">Statement as at</span>
              <input type="date" value={grid.asAt || ''} max={todayISO()} onChange={(e) => setGrid({ ...grid, asAt: e.target.value })} />
              {!grid.asAt && lastDate && <span className="hint">Left blank: the last batch date, {fmtDate(lastDate)}.</span>}</label>
            {series && !series.next_no && newBatches.length > 0 && (
              <label className="field"><span className="flabel">First HNBMS number</span>
                <input inputMode="numeric" value={firstNo} onChange={(e) => setFirstNo(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 15" />
                <span className="hint">Only asked once: continue from the last number used in the workbook. After this the app numbers batches itself.</span></label>
            )}
          </div>
          <label className="field"><span className="flabel">Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {st.problems > 0 && <p className="error">{plural(st.problems, 'problem')} to fix above before saving.</p>}
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button className="btn primary" disabled={!canSave} onClick={save}>{busy ? 'Saving…' : 'Save the statement'}</button>
            <button className="btn ghost" disabled={busy} onClick={() => { setStage('pick'); setGrid(null); }}>Start again</button>
          </div>
        </div>
        {texts.length > 0 && (
          <details className="facts"><summary>What the reader saw</summary>
            {texts.map((t, i) => <pre key={i} className="ms-raw">{`${pdf ? 'Page' : 'Screenshot'} ${i + 1}\n${t}`}</pre>)}
          </details>
        )}
      </section>
      <aside className="ms-shots-aside" aria-label={pdf ? 'Statement pages' : 'Screenshots'}>
        {pdf && pages.map((u, i) => (
          <figure key={u}><figcaption className="muted small">Page {i + 1}</figcaption>
            <a href={u} target="_blank" rel="noreferrer"><img src={u} alt={`Page ${i + 1}`} /></a></figure>
        ))}
        {files.map((f, i) => (
          <figure key={f.k}><figcaption className="muted small">Screenshot {i + 1}</figcaption>
            <a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={`Screenshot ${i + 1}`} /></a></figure>
        ))}
      </aside>
    </div>
  );
}
