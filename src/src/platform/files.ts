import type { ClipboardEvent as ReactClipboardEvent } from 'react';
import { supabase } from '../supabase';

/** All files live in one private bucket; each app keeps them under its own folder (tasks/…, notes/…). */
export const BUCKET = 'workspace-files';
export const MAX_FILE_MB = 10;

const safeName = (name: string) =>
  name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(-80) || 'file';

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Upload a file under `folder` (e.g. "tasks/123"). Returns the stored path. */
export async function uploadFile(folder: string, file: File): Promise<{ path: string } | { error: string }> {
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    return { error: `${file.name} is larger than ${MAX_FILE_MB} MB.` };
  }
  const path = `${folder}/${randomId()}-${safeName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) return { error: error.message.includes('row-level security') ? "You don't have permission to add files here." : error.message };
  return { path };
}

export async function removeFiles(paths: string[]) {
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
}

// Private files are opened through short-lived links. Keep them for ~50 minutes.
const cache = new Map<string, { url: string; until: number }>();

export async function fileUrl(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  cache.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60_000 });
  return data.signedUrl;
}

export async function fileUrls(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing = paths.filter(p => {
    const hit = cache.get(p);
    if (hit && hit.until > Date.now()) { out[p] = hit.url; return false; }
    return true;
  });
  if (missing.length) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(missing, 3600);
    for (const d of data ?? []) {
      if (d.signedUrl && d.path) {
        out[d.path] = d.signedUrl;
        cache.set(d.path, { url: d.signedUrl, until: Date.now() + 50 * 60_000 });
      }
    }
  }
  return out;
}

/** Files on the clipboard (e.g. a screenshot taken with Win+Shift+S), given friendly names. */
export function clipboardFiles(e: ClipboardEvent | ReactClipboardEvent): File[] {
  const items = Array.from(e.clipboardData?.items ?? []);
  const files: File[] = [];
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.');
  for (const it of items) {
    if (it.kind !== 'file') continue;
    const f = it.getAsFile();
    if (!f) continue;
    const isImage = f.type.startsWith('image/');
    const name = isImage && (!f.name || f.name === 'image.png') ? `Screenshot ${stamp}.png` : f.name;
    files.push(new File([f], name, { type: f.type }));
  }
  return files;
}

export const isImage = (mime?: string | null, name?: string) =>
  (mime ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name ?? '');

export function fmtSize(bytes?: number | null) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Accept "bank.lk" as well as "https://bank.lk". Only web and mail links are allowed. */
export function normaliseUrl(u: string) {
  const t = u.trim();
  if (!t) return '';
  if (/^(https?:\/\/|mailto:)/i.test(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[\w.-]+:\d+/.test(t)) return '';   // javascript:, data:, file: …
  return `https://${t}`;
}
