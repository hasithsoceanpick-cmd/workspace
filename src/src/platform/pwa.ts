import { useEffect, useState } from 'react';

/**
 * Installing Workspace as an app (phones and computers).
 *  - Android / Chrome / Edge: the browser offers an install prompt; we keep it for the "Install app" button.
 *  - iPhone / iPad: there is no prompt; people add it with Share → Add to Home Screen.
 * The service worker (public/sw.js) also delivers phone alerts and opens the right item when one is tapped.
 */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallPrompt | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(f => f());

export function startPwa() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();               // we show our own "Install app" button instead
    deferred = e as InstallPrompt;
    emit();
  });
  window.addEventListener('appinstalled', () => { deferred = null; installedNow = true; emit(); });

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    const register = () => navigator.serviceWorker.register('/sw.js').catch(() => { /* the app still works without it */ });
    if (document.readyState === 'complete') register(); else window.addEventListener('load', register);
    // a phone alert was tapped while the app was already open
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'open-notice' && e.data.notice) window.location.hash = `#/go?notice=${e.data.notice}`;
      if (e.data?.type === 'pushed') window.dispatchEvent(new Event('workspace:pushed'));
    });
  }
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function useInstall() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump(n => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return {
    /** already running as an installed app */
    installed: isStandalone() || installedNow,
    /** the browser can show its own install prompt */
    canPrompt: deferred !== null,
    ios: isIOS(),
    async install(): Promise<boolean> {
      if (!deferred) return false;
      const p = deferred;
      deferred = null;
      await p.prompt();
      const { outcome } = await p.userChoice;
      emit();
      return outcome === 'accepted';
    },
  };
}
