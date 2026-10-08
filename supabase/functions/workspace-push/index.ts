// =====================================================================
//  WORKSPACE — phone alerts sender  (Supabase Edge Function "workspace-push")
//
//  The database calls this whenever new notifications are created. It
//  delivers each one to the person's phones / computers using the Web Push
//  standard (RFC 8291 encryption + VAPID signing), with nothing but the
//  built-in Web Crypto API, so there are no libraries to install.
//
//  It holds no keys or data of its own: each batch from the database carries
//  what it needs, and it only ever sends to the official push services
//  (Google, Apple, Mozilla, Microsoft).
//
//  Deploy: Supabase → Edge Functions → Deploy a new function → Via Editor,
//  name it  workspace-push , paste this file, Deploy. Then in its settings
//  turn OFF "Verify JWT" (the database's call can't carry a login).
// =====================================================================

export interface Vapid {
  public_key: string;   // base64url, 65-byte uncompressed P-256 point
  private_key: string;  // base64url, 32-byte private scalar ("d")
  subject: string;      // https://… or mailto:… (who to contact about these alerts)
}

export interface Message {
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  notice?: number | null;
  tag?: string | null;
}

// Only the browsers' official push services — never an arbitrary address.
const PUSH_HOSTS = [
  'fcm.googleapis.com', 'android.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];

export function allowedEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

// ---------- small helpers ----------
const te = new TextEncoder();

function bytes(n: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(n));
}

export function b64u(data: Uint8Array): string {
  let s = '';
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = bytes(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = bytes(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const text = (s: string) => concat(te.encode(s));

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

// ---------- RFC 8291: encrypt the alert so only that device can read it ----------
export async function encrypt(p256dh: string, authSecret: string, plaintext: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = unb64u(p256dh);
  const auth = unb64u(authSecret);
  if (uaPublic.length !== 65 || auth.length < 16) throw new Error('bad subscription keys');

  const device = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const mine = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', mine.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: device }, mine.privateKey, 256));

  const ikm = await hkdf(auth, shared, concat(text('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(bytes(16));
  const cek = await hkdf(salt, ikm, text('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, text('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concat(plaintext, new Uint8Array([2]));            // 0x02 = last (and only) record
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record));

  const header = bytes(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);                  // record size
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, sealed);
}

// ---------- VAPID: sign each request so the push service knows it's from us ----------
export async function vapidAuth(endpoint: string, v: Vapid): Promise<string> {
  const pub = unb64u(v.public_key);
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256', ext: true,
    x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: v.private_key,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(text(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(text(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: v.subject,
  })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, text(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${v.public_key}`;
}

export async function sendOne(m: Message, v: Vapid): Promise<{ status: number; detail?: string }> {
  if (!allowedEndpoint(m.endpoint)) return { status: 0, detail: 'not a push service address' };
  const payload = text(JSON.stringify({ title: m.title, body: m.body, notice: m.notice ?? null, tag: m.tag ?? null }));
  const res = await fetch(m.endpoint, {
    method: 'POST',
    headers: {
      'TTL': '86400',                       // keep trying for a day if the phone is off
      'Urgency': 'normal',
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Authorization': await vapidAuth(m.endpoint, v),
    },
    body: await encrypt(m.p256dh, m.auth, payload),
  });
  const detail = res.ok ? undefined : (await res.text().catch(() => '')).slice(0, 200);
  return { status: res.status, detail };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let batch: { vapid?: Vapid; messages?: Message[] };
  try {
    batch = await req.json();
  } catch {
    return json({ error: 'expected JSON' }, 400);
  }
  const v = batch.vapid;
  const messages = Array.isArray(batch.messages) ? batch.messages.slice(0, 500) : [];
  if (!v?.public_key || !v.private_key || !v.subject) return json({ error: 'missing keys' }, 400);

  const results = await Promise.all(messages.map(async m => {
    try {
      return { endpoint: m.endpoint, ...(await sendOne(m, v)) };
    } catch (e) {
      return { endpoint: m.endpoint, status: 0, detail: String((e as Error)?.message ?? e).slice(0, 200) };
    }
  }));

  return json({
    workspace_push: true,
    sent: results.filter(r => r.status >= 200 && r.status < 300).length,
    // the device unsubscribed or the app was removed: the database forgets these
    gone: results.filter(r => r.status === 404 || r.status === 410).map(r => r.endpoint),
    failed: results
      .filter(r => r.status !== 404 && r.status !== 410 && (r.status < 200 || r.status >= 300))
      .map(r => ({ host: (() => { try { return new URL(r.endpoint).hostname; } catch { return '?'; } })(), status: r.status, detail: r.detail })),
  });
}

if ('Deno' in globalThis) Deno.serve(handle);
