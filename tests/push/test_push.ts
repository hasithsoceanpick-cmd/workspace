// Tests the phone-alert sender (supabase/functions/workspace-push) in real Deno: encryption is checked with the
// reference decoder (http_ece), signatures with Web Crypto, and the handler with fake push services. Run ./run.sh
import { handle, encrypt, vapidAuth, b64u, unb64u, allowedEndpoint } from './push.ts';
// @ts-ignore npm package without types
import ece from 'http_ece';
import { Buffer } from 'node:buffer';
import { createECDH, randomBytes } from 'node:crypto';

let ok = 0, bad = 0;
const check = (name: string, cond: boolean, extra = '') => { if (cond) { ok++; console.log('  ok  ', name); } else { bad++; console.log('  FAIL', name, extra); } };

// a fake phone: its own key pair + auth secret (exactly what a browser makes)
const phone = createECDH('prime256v1'); phone.generateKeys();
const authSecret = randomBytes(16);
const p256dh = b64u(new Uint8Array(phone.getPublicKey()));
const auth = b64u(new Uint8Array(authSecret));

// VAPID keys made the same way the admin page makes them
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
const vapid = {
  public_key: b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
  private_key: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d!,
  subject: 'https://workspace.example.app',
};

// 1. encryption round-trip with the reference decoder
const msg = JSON.stringify({ title: 'New task', body: 'Hasith assigned you "VAT return" — due Fri 10 Oct ✓' });
const sealed = await encrypt(p256dh, auth, new TextEncoder().encode(msg));
const opened = ece.decrypt(Buffer.from(sealed), { version: 'aes128gcm', privateKey: phone, authSecret });
check('reference decoder reads the alert', opened.toString('utf8') === msg, opened.toString('utf8'));

// 2. VAPID signature verifies with the public key
const header = await vapidAuth('https://fcm.googleapis.com/fcm/send/abc', vapid);
const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)!;
const claims = JSON.parse(new TextDecoder().decode(unb64u(m[2])));
const verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, unb64u(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
check('VAPID signature is valid', verified);
check('VAPID audience is the push service', claims.aud === 'https://fcm.googleapis.com');
check('VAPID expiry within 24h', claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 86400);
check('k= is the public key', m[4] === vapid.public_key);

// 3. only official push services
check('google allowed', allowedEndpoint('https://fcm.googleapis.com/fcm/send/x'));
check('apple allowed', allowedEndpoint('https://web.push.apple.com/QAbc'));
check('mozilla allowed', allowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
check('windows allowed', allowedEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x'));
check('http refused', !allowedEndpoint('http://fcm.googleapis.com/x'));
check('other host refused', !allowedEndpoint('https://evil.example.com/fcm.googleapis.com'));
check('look-alike refused', !allowedEndpoint('https://fcm.googleapis.com.evil.com/x'));
check('localhost refused', !allowedEndpoint('https://localhost/x'));

// 4. the whole request handler, with the push services faked
const seen: { url: string; headers: Headers; body: Uint8Array }[] = [];
globalThis.fetch = (async (url: string, init: RequestInit) => {
  seen.push({ url, headers: new Headers(init.headers), body: init.body as Uint8Array });
  if (url.includes('gone')) return new Response('', { status: 410 });
  if (url.includes('broken')) return new Response('bad key', { status: 403 });
  return new Response('', { status: 201 });
}) as typeof fetch;

const sub = { p256dh, auth };
const res = await handle(new Request('http://x/', { method: 'POST', body: JSON.stringify({ vapid, messages: [
  { endpoint: 'https://fcm.googleapis.com/fcm/send/one', ...sub, title: 'Missed deadline', body: 'Bank rec was due', notice: 42, tag: 'tasks-7' },
  { endpoint: 'https://web.push.apple.com/gone', ...sub, title: 'x', body: 'y' },
  { endpoint: 'https://updates.push.services.mozilla.com/broken', ...sub, title: 'x', body: 'y' },
  { endpoint: 'https://169.254.169.254/latest/meta-data', ...sub, title: 'x', body: 'y' },
] }) }));
const out = await res.json();
check('handler answers 200', res.status === 200);
check('one sent', out.sent === 1, JSON.stringify(out));
check('gone endpoint reported', out.gone.length === 1 && out.gone[0].includes('/gone'));
check('failures reported with status', out.failed.length === 2 && out.failed.some((f: any) => f.status === 403) && out.failed.some((f: any) => f.status === 0));
check('never called a non-push address', !seen.some(s => s.url.includes('169.254')));
const first = seen.find(s => s.url.endsWith('/one'))!;
check('aes128gcm header', first.headers.get('content-encoding') === 'aes128gcm');
check('TTL header', first.headers.get('ttl') === '86400');
check('vapid auth header', /^vapid t=.+, k=/.test(first.headers.get('authorization') ?? ''));
const delivered = JSON.parse(ece.decrypt(Buffer.from(first.body), { version: 'aes128gcm', privateKey: phone, authSecret }).toString('utf8'));
check('phone reads title/body/notice/tag', delivered.title === 'Missed deadline' && delivered.body === 'Bank rec was due' && delivered.notice === 42 && delivered.tag === 'tasks-7', JSON.stringify(delivered));

const r2 = await handle(new Request('http://x/', { method: 'POST', body: 'not json' }));
check('bad body → 400', r2.status === 400);
const r3 = await handle(new Request('http://x/', { method: 'POST', body: JSON.stringify({ messages: [] }) }));
check('missing keys → 400', r3.status === 400);
const r4 = await handle(new Request('http://x/', { method: 'GET' }));
check('GET → 405', r4.status === 405);

console.log(`\n${ok} passed, ${bad} failed`);
if (bad) Deno.exit(1);
