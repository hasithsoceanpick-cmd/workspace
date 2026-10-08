/* Workspace service worker
 *  - lets the app be installed on phones and open quickly (keeps a copy of the app's own files)
 *  - never stores anything from Supabase: tasks, notes and people always come live from the database
 *  - shows phone alerts (web push) and opens the right task when one is tapped
 */
const VERSION = 'workspace-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/badge-96.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // Supabase and anything else: straight to the network

  // the page itself: always try for the newest version, fall back to the saved copy when offline
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put('/', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  // built files have a unique name per version, so a saved copy never goes stale
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const fresh = await fetch(req);
      if (fresh.ok) {
        const cache = await caches.open(VERSION);
        await cache.put(req, fresh.clone());
        trim(cache);
      }
      return fresh;
    })());
  }
});

// keep the saved copy small: files from old versions are dropped, oldest first
async function trim(cache) {
  const keys = await cache.keys();
  const files = keys.filter(k => new URL(k.url).pathname.startsWith('/assets/'));
  for (const k of files.slice(0, Math.max(0, files.length - 40))) await cache.delete(k);
}

// ---------- phone alerts ----------
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Workspace';
  event.waitUntil(Promise.all([
    // an open copy of the app refreshes its bell straight away
    self.clients.matchAll({ type: 'window' }).then(ws => ws.forEach(w => w.postMessage({ type: 'pushed' }))),
    self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { notice: data.notice || null },
    }),
  ]));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const notice = event.notification.data && event.notification.data.notice;
  const target = notice ? `/#/go?notice=${notice}` : '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(w => new URL(w.url).origin === self.location.origin);
    if (win) {
      await win.focus();
      win.postMessage({ type: 'open-notice', notice });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
