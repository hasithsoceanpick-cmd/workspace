import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { fmtDate, lkr } from '../lib/format';

const key = (n) => Math.round(Number(n) * 100);

// Open invoices (any customer) of exactly these values, still free in the app. → (amount) => invoices
export function useInvoicesOfAmount(amounts) {
  const sig = [...new Set((amounts ?? []).map(key))].sort((a, b) => a - b).join(',');
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!sig) { setRows([]); return undefined; }
    let live = true;
    rpc('cc_invoices_of_amount', { p_amounts: sig.split(',').map((c) => Number(c) / 100) })
      .then((d) => { if (live) setRows(d ?? []); }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [sig]);
  const by = useMemo(() => { const m = {}; for (const r of rows) (m[key(r.amount)] ??= []).push(r); return m; }, [rows]);
  return (amount) => by[key(amount)] ?? [];
}

// Invoices nearest the sale date first: issued on or before it, then after.
export function nearSale(invoices, saleDate) {
  const gap = (d) => Math.abs((new Date(`${d}T00:00:00`) - new Date(`${saleDate}T00:00:00`)) / 86400000);
  return [...invoices].sort((a, b) => ((a.posting_date > saleDate) - (b.posting_date > saleDate)) || gap(a.posting_date) - gap(b.posting_date));
}

// Under a sale nobody has recorded yet: the open invoices of exactly its value, each one click from a card payment.
export default function SaleInvoices({ draft, invoices, max = 4 }) {
  const [all, setAll] = useState(false);
  if (!invoices.length) return <span className="muted small sale-inv-none">No open invoice of LKR {lkr(draft.amount)}</span>;
  const list = nearSale(invoices, draft.txn_date);
  const shown = all ? list : list.slice(0, max);
  return (
    <div className="sale-inv">
      <span className="small muted">Open invoice{list.length === 1 ? '' : 's'} of LKR {lkr(draft.amount)}:</span>
      <ul>
        {shown.map((i) => (
          <li key={`${i.customer_no}-${i.document_no}`}>
            <Link to={`/card?draft=${draft.id}&customer=${encodeURIComponent(i.customer_no)}&invoice=${encodeURIComponent(i.document_no)}`}>
              {i.document_no} · {i.customer_name}</Link>
            <span className="muted small"> {fmtDate(i.posting_date)}</span>
          </li>
        ))}
      </ul>
      {list.length > max && <button type="button" className="link small" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `All ${list.length}`}</button>}
    </div>
  );
}
