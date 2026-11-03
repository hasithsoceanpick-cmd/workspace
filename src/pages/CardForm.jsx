import { useEffect, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { rpc, db } from '../lib/supabase';
import { fetchAll } from '../lib/bcimport';
import { lkr, fmtDate, todayISO } from '../lib/format';
import CustomerPicker from '../components/CustomerPicker';
import InvoicePicker from '../components/InvoicePicker';
import ReceiptInput, { keptItems, uploadReceiptItems, attachFiles } from '../components/ReceiptInput';
import DraftPicker from '../components/DraftPicker';
import { useInvoicesOfAmount, nearSale } from '../components/SaleInvoices';
import { useAuth } from '../lib/auth';

// A card payment taken on the HNB terminal: Sales records it against the invoices,
// then sets it off against its sale on the merchant statement (or parks it until
// finance adds that statement).
export default function CardForm() {
  const nav = useNavigate();
  const { role } = useAuth();
  const [params] = useSearchParams();
  const editId = Number(params.get('edit')) || null;     // a parked card payment
  const draftParam = Number(params.get('draft')) || null; // started from a sale on a merchant statement
  const custParam = params.get('customer');               // …and one of the open invoices of its value
  const invParam = params.get('invoice');
  const [saleDate, setSaleDate] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [docs, setDocs] = useState([]);
  const [snapshot, setSnapshot] = useState([]);
  const [invoiceTotal, setInvoiceTotal] = useState(null);
  const [instructions, setInstructions] = useState('');
  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [cardDate, setCardDate] = useState(todayISO());
  const [last4, setLast4] = useState('');
  const [draft, setDraft] = useState(null);
  const [mismatchOk, setMismatchOk] = useState(false);
  const [files, setFiles] = useState([]);                    // the slip's files (photos / PDFs)
  const [noSlip, setNoSlip] = useState(false);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAll(() => db.from('customers').select('customer_no,name').eq('in_latest_list', true).order('name'))
      .then(setCustomers).catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    if (!editId) return;
    db.from('collections').select('*').eq('id', editId).maybeSingle().then(({ data: c }) => {
      if (!c || c.kind !== 'card' || c.status !== 'parked') { setError('Only a parked card payment can be changed here.'); return; }
      setCustomer({ customer_no: c.customer_no, name: c.customer_name });
      setSnapshot(c.settlement ?? []); setDocs((c.settlement ?? []).map((x) => x.document_no));
      setInstructions(c.settlement_instructions ?? '');
      setAmount(Number(c.collected_amount).toFixed(2)); setAmountTouched(true);
      setCardDate(c.card_date ?? todayISO()); setLast4(c.card_last4 ?? ''); setNotes(c.notes ?? '');
      setFiles(keptItems(c));
      if (!c.receipt_path) { setNoSlip(true); setReason(c.no_receipt_reason ?? ''); }
    });
  }, [editId]);

  useEffect(() => {
    if (!draftParam) return;
    db.from('merchant_drafts').select('*').eq('id', draftParam).maybeSingle().then(({ data: d }) => {
      if (!d) return;
      if (d.collection_id) { setError('That sale is already set off against a card payment.'); return; }
      setAmount(Number(d.amount).toFixed(2)); setAmountTouched(true);
      setCardDate(d.txn_date); setLast4(d.card_last4 ?? ''); setSaleDate(d.txn_date);
    });
  }, [draftParam]);

  useEffect(() => {
    if (!custParam || editId || customer || !customers.length) return;
    const c = customers.find((x) => x.customer_no === custParam);
    if (!c) return;
    setCustomer(c);
    if (invParam) setDocs([invParam]);
  }, [custParam, invParam, customers]); // eslint-disable-line react-hooks/exhaustive-deps

  const amountNum = Math.round((Number(String(amount).replace(/,/g, '')) || 0) * 100) / 100;
  // started from a sale: the open invoices of exactly its value, to pick the customer and invoice in one go
  const invoicesOf = useInvoicesOfAmount(draftParam && !customer && !editId && amountNum > 0 ? [amountNum] : []);
  const matching = saleDate ? nearSale(invoicesOf(amountNum), saleDate) : [];
  const last4Clean = last4.replace(/\D/g, '');
  const mismatch = draft && draft.card_last4 && last4Clean.length === 4 && draft.card_last4 !== last4Clean;

  async function save(e, mode = 'send') {
    e?.preventDefault?.();
    setBusy(true); setError('');
    try {
      if (!customer) throw new Error('Choose the customer.');
      if (!(amountNum > 0)) throw new Error('Enter the card amount.');
      if (!cardDate) throw new Error('Enter the date the card was charged.');
      if (last4Clean && last4Clean.length !== 4) throw new Error('The last 4 digits should be 4 digits, or leave them blank.');
      if (mode === 'send' && !draft) throw new Error('Pick the sale on the merchant statement, or park it until the statement is in.');
      if (mode === 'send' && mismatch && !mismatchOk) throw new Error(`The statement shows the card ending ${draft.card_last4}, not ${last4Clean}. Tick that you've checked it, or pick another sale.`);
      if (noSlip ? !reason.trim() : !files.length) throw new Error('Attach the card slip, or tick "No slip" and give the reason.');
      const paths = noSlip ? [] : await uploadReceiptItems(files, 'card-slip');
      const path = paths[0] ?? null;
      const p = {
        id: editId, customer_no: customer.customer_no, customer_name: customer.name, settlement_docs: docs,
        settlement_instructions: instructions, amount: amountNum, card_date: cardDate, card_last4: last4Clean || null,
        receipt_path: path, no_receipt_reason: path ? null : reason, notes,
        draft_id: mode === 'send' ? draft.draft_id : null, allow_card_mismatch: Boolean(mismatch && mismatchOk),
      };
      const id = await rpc('cc_card_save', { p });
      if (paths.length > 1 || editId) await attachFiles(id, paths);
      nav(`/c/${id}`);
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <section className="narrow">
      <div className="page-head"><h1>{editId ? 'Change the parked card payment' : 'Record a card payment'}</h1></div>
      <p className="lede">A customer paid by card on the HNB machine. Pick the customer and invoices, the amount and the date the card was charged,
        then its sale on the merchant statement. If finance hasn't added that statement yet, park it: you'll be told when a sale of this amount shows.</p>

      <form onSubmit={save} className="stack">
        {draftParam && !customer && saleDate && (
          <div className="field sale-match"><span className="flabel">Open invoices of LKR {lkr(amountNum)}, the value of this sale</span>
            {matching.length === 0 ? <span className="hint">None in the app: pick the customer and invoices below.</span> : (
              <ul className="plain">
                {matching.map((i) => (
                  <li key={`${i.customer_no}-${i.document_no}`}>
                    <button type="button" className="btn small" onClick={() => { setCustomer({ customer_no: i.customer_no, name: i.customer_name }); setDocs([i.document_no]); }}>
                      {i.document_no} · {i.customer_name}</button>
                    <span className="muted small"> invoiced {fmtDate(i.posting_date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="field"><span className="flabel">Customer</span>
          <CustomerPicker customers={customers} selected={customer} onSelect={(c) => { setCustomer(c); setDocs([]); setInvoiceTotal(null); }} />
        </div>
        {customer?.customer_no && (
          <div className="field"><span className="flabel">Invoices being settled</span>
            <InvoicePicker key={customer.customer_no} customerNo={customer.customer_no} selected={docs} snapshot={snapshot} collectionId={editId}
              onChange={(d, t) => { setDocs(d); setInvoiceTotal(d.length ? t : null); if (!amountTouched && d.length) setAmount(t.toFixed(2)); }} />
          </div>
        )}
        {customer && (
          <label className="field"><span className="flabel">Settlement instructions{docs.length ? ' (optional)' : ''}</span>
            <textarea rows="2" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="E.g. settle oldest first, or advance" />
          </label>
        )}

        <div className="grid2">
          <label className="field"><span className="flabel">Card amount (LKR)</span>
            <input required inputMode="decimal" value={amount} placeholder="The full amount charged"
              onChange={(e) => { setAmountTouched(true); setAmount(e.target.value); }} />
          </label>
          <label className="field"><span className="flabel">Date the card was charged</span>
            <input type="date" required value={cardDate} max={todayISO()} onChange={(e) => setCardDate(e.target.value)} />
          </label>
        </div>
        {invoiceTotal != null && amountNum > 0 && Math.abs(amountNum - invoiceTotal) >= 0.005 && (
          <p className="warn-text">
            {amountNum < invoiceTotal
              ? `LKR ${lkr(invoiceTotal - amountNum)} less than the ticked invoices: it will settle the oldest invoices first.`
              : `LKR ${lkr(amountNum - invoiceTotal)} more than the ticked invoices: the excess stays unapplied on the customer.`}
          </p>
        )}
        <label className="field"><span className="flabel">Card number, last 4 digits (optional)</span>
          <input inputMode="numeric" maxLength={6} value={last4} onChange={(e) => setLast4(e.target.value)} placeholder="From the card slip, e.g. 9368" style={{ maxWidth: '10rem' }} />
          <span className="hint">Helps pick the right sale when two customers paid the same amount.</span>
        </label>

        <div className="field"><span className="flabel">The sale on the merchant statement</span>
          <DraftPicker amount={amountNum} cardDate={cardDate} value={draft} include={null} pick={draftParam}
            onChange={(d) => { setDraft(d); setMismatchOk(false); }} />
          {draftParam && !draft && <span className="hint">Pick the sale you came from to set this payment off against it.</span>}
        </div>
        {mismatch && (
          <div className="notice">
            The statement shows card {draft.card_first6}******<strong>{draft.card_last4}</strong>; you entered {last4Clean}.
            <label className="check"><input type="checkbox" checked={mismatchOk} onChange={(e) => setMismatchOk(e.target.checked)} /> I've checked the slip: this is the right sale</label>
          </div>
        )}

        {!noSlip && <ReceiptInput label="Card slip: one or more photos or PDFs" items={files} onChange={setFiles} />}
        <label className="check"><input type="checkbox" checked={noSlip} onChange={(e) => setNoSlip(e.target.checked)} /> No slip available</label>
        {noSlip && (
          <label className="field"><span className="flabel">Why is there no slip?</span>
            <input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Slip given to the customer" /></label>
        )}
        <label className="field"><span className="flabel">Notes for finance</span>
          <textarea rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

        {role === 'sales' && !draft && (
          <p className="hint">Not on a merchant statement yet? <strong>Park it</strong>: finance won't see it until you set it off and send it.
            {cardDate && ` HNB usually lists a sale on the statement the next working day after ${fmtDate(cardDate)}.`}</p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="btn primary" disabled={busy || !draft}>{busy ? 'Saving…' : 'Set off and send to finance'}</button>
          {role === 'sales' && (
            <button type="button" className="btn" disabled={busy} onClick={(e) => save(e, 'park')}
              title="Finance won't see it until you set it off and send it">{editId ? 'Save, keep parked' : 'Park until the statement is in'}</button>
          )}
          <Link className="btn ghost" to={editId ? `/c/${editId}` : '/'}>Cancel</Link>
        </div>
      </form>
    </section>
  );
}
