import { supabase } from '../supabase';
import { isIOS, isStandalone } from './pwa';

/**
 * Phone alerts (web push) for this device.
 * Whatever lands in someone's bell is also sent to every device where they switched alerts on.
 * The database sends them through the Supabase Edge Function "workspace-push" (supabase/functions).
 */
export type DevicePush =
  | 'unsupported'      // this browser can't receive alerts
  | 'needs-install'    // iPhone/iPad: only works once added to the Home Screen
  | 'blocked'          // the person said "Block" — change it in the browser / phone settings
  | 'on' | 'off';

const WANT_KEY = 'workspace.push';
const want = (v?: 'on' | 'off') => {
  try {
    if (v) localStorage.setItem(WANT_KEY, v);
    return localStorage.getItem(WANT_KEY);
  } catch { return null; }
};

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/android/i.test(ua)) return 'Android phone';
  if (/windows/i.test(ua)) return 'Windows computer';
  if (/macintosh|mac os/i.test(ua)) return 'Mac';
  return 'Computer';
}

async function registration() {
  return navigator.serviceWorker.getRegistration('/').then(r => r ?? navigator.serviceWorker.ready);
}

export async function devicePushState(): Promise<DevicePush> {
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub && want() !== 'off' ? 'on' : 'off';
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) =>
  !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

async function save(sub: PushSubscription) {
  const j = sub.toJSON();
  const { error } = await supabase.rpc('workspace_push_save', {
    p_endpoint: sub.endpoint, p_p256dh: j.keys?.p256dh ?? '', p_auth: j.keys?.auth ?? '', p_device: deviceLabel(),
  });
  if (error) throw error;
}

/** Switch alerts on for this device. Returns a message to show when it can't. */
export async function turnOnPush(): Promise<string | null> {
  const state = await devicePushState();
  if (state === 'needs-install') return 'On iPhone and iPad, add Workspace to your Home Screen first, then open it from there.';
  if (state === 'unsupported') return "This browser can't show alerts. Try Chrome, Edge or Safari.";
  if (state === 'blocked') return 'Alerts are blocked for Workspace. Allow notifications for this site in your browser or phone settings, then try again.';

  const { data: key, error } = await supabase.rpc('workspace_push_public_key');
  if (error) throw error;
  if (!key) return "Phone alerts haven't been set up yet. Ask your administrator.";

  if ((await Notification.requestPermission()) !== 'granted') return 'Alerts were not allowed on this device.';
  const reg = await registration();
  const server = keyBytes(key as string);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, server)) { await sub.unsubscribe(); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: server });
  await save(sub);
  want('on');
  return null;
}

export async function turnOffPush() {
  want('off');
  if (!supported()) return;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.rpc('workspace_push_forget', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}

/**
 * Each time the app opens: keep this device's alert subscription current
 * (new keys after the admin reset them, or a subscription the browser renewed).
 */
export async function refreshPush() {
  try {
    if (!supported() || Notification.permission !== 'granted' || want() !== 'on') return;
    const { data: key } = await supabase.rpc('workspace_push_public_key');
    if (!key) return;
    const reg = await registration();
    const server = keyBytes(key as string);
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub.options.applicationServerKey, server)) { await sub.unsubscribe(); sub = null; }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: server });
    await save(sub);
  } catch { /* alerts are a bonus; never block the app */ }
}

/** Signing out: this device stops receiving that person's alerts. */
export async function forgetDeviceOnSignOut() {
  try {
    if (!supported()) return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await supabase.rpc('workspace_push_forget', { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  } catch { /* ignore */ }
}

// ---------- admin: setting up the keys ----------
function b64url(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A new key pair for signing alerts (the private half is only ever stored in the database). */
export async function makePushKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('raw', pair.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: b64url(pub), privateKey: jwk.d as string };
}
