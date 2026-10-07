/**
 * Plain Excel downloads for any app: one bold, frozen header row per sheet, sensible column
 * widths, real dates (dd-mmm-yyyy) and plain values — no formulas, easy to filter and sort.
 * The Excel writer only downloads when someone actually exports.
 */
export type XValue = string | number | boolean | null | undefined | { date: string };
export interface XColumn { header: string; width?: number }
export interface XSheet { name: string; columns: XColumn[]; rows: XValue[][] }

/** A 'YYYY-MM-DD' (or timestamp) shown as a real Excel date */
export const xDate = (iso: string | null | undefined): XValue => (iso ? { date: iso } : null);

function toCell(v: XValue) {
  if (v && typeof v === 'object' && 'date' in v) {
    const d = v.date.length > 10 ? localDay(v.date) : v.date;
    const [y, m, day] = d.split('-').map(Number);
    return { value: new Date(Date.UTC(y, m - 1, day)), type: Date, format: 'dd-mmm-yyyy' };
  }
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return { value: v, type: Number };
  if (typeof v === 'boolean') return { value: v ? 'Yes' : 'No', type: String };
  return { value: String(v), type: String, wrap: String(v).length > 60 };
}

function localDay(ts: string) {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function downloadXlsx(fileName: string, sheets: XSheet[]) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const data = sheets.map(s => ({
    sheet: s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31),
    stickyRowsCount: 1,
    columns: s.columns.map(c => ({ width: c.width ?? 14 })),
    data: [
      s.columns.map(c => ({ value: c.header, fontWeight: 'bold' as const, backgroundColor: '#E8EEF7', type: String })),
      ...s.rows.map(r => r.map(toCell)),
    ],
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await writeXlsxFile(data as any).toFile(fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}
