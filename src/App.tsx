import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isConfigured, supabase } from './supabase';
import type { Profile } from './platform/types';
import { PlatformProvider } from './platform/store';
import Login from './platform/Login';
import Shell from './platform/Shell';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (!isConfigured) return <NotConfigured />;
  if (session === undefined) return <div className="splash">Loading…</div>;
  if (!session) return <Login />;
  return <Gate key={session.user.id} userId={session.user.id} />;
}

function Gate({ userId }: { userId: string }) {
  const [state, setState] = useState<{ me: Profile | null; isAdmin: boolean } | undefined>(undefined);

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    ]);
    setState({ me: (p.data as Profile) ?? null, isAdmin: !!a.data });
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  if (state === undefined) return <div className="splash">Loading…</div>;
  const { me, isAdmin } = state;
  const ready = me && me.active && (isAdmin || me.department_id);
  if (!ready) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="brand-mark big">✓</div>
          <h1>Waiting for approval</h1>
          <p className="muted">
            {me ? <>Hi {me.full_name}. </> : null}
            Your account is set up. The administrator needs to approve it and add you to your department.
          </p>
          <div className="row gap">
            <button className="btn primary" onClick={load}>Check again</button>
            <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <PlatformProvider me={me} isAdmin={isAdmin}>
      <Shell />
    </PlatformProvider>
  );
}

function NotConfigured() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Almost there</h1>
        <p className="muted">
          The app isn't connected to Supabase yet. In Vercel, add two Environment Variables —
          <code> VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> — then redeploy.
          The setup guide (README) walks through it.
        </p>
      </div>
    </div>
  );
}
