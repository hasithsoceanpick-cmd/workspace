import { useState, type FormEvent } from 'react';
import { niceError, supabase } from '../supabase';
import { PLATFORM_NAME } from './config';

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'error' | 'ok' } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        if (!name.trim()) throw new Error('Please enter your name.');
        if (password.length < 6) throw new Error('Password must be at least 6 characters.');
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } },
        });
        if (error) throw error;
        if (!data.session) {
          setMsg({ kind: 'ok', text: 'Account created. Check your email to confirm, then sign in.' });
          setMode('in');
        }
      }
    } catch (err) {
      setMsg({ kind: 'error', text: niceError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand-mark big">✓</div>
        <h1>{mode === 'in' ? 'Sign in' : 'Create your account'}</h1>
        <p className="muted">{PLATFORM_NAME}</p>

        {mode === 'up' && (
          <label className="field">
            <span>Full name</span>
            <input value={name} onChange={e => setName(e.target.value)} autoComplete="name" required />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required />
        </label>

        {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

        <button className="btn primary block" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
        <p className="muted small center">
          {mode === 'in' ? <>New here? <a href="#" onClick={e => { e.preventDefault(); setMode('up'); setMsg(null); }}>Create an account</a></>
            : <>Already have an account? <a href="#" onClick={e => { e.preventDefault(); setMode('in'); setMsg(null); }}>Sign in</a></>}
        </p>
      </form>
    </div>
  );
}
