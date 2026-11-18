// components/AppShell.jsx — Pieces only the Android app needs
//
//   ServerSetup   first launch: which server to talk to (the NetBird address).
//                 Typed in on the phone and kept there, never in the code.
//   UpdateBanner  "a new version is ready" when the server has a newer build
//                 than the installed app; tapping it opens the download in
//                 the phone's browser.
//
// In a browser neither shows: the pages come from the server itself.

import { useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { api, isNative, serverUrl, setServerUrl, serverLink } from '../api.js';

export function needsServer() {
  return isNative && !serverUrl();
}

export function ServerSetup({ onDone }) {
  const [address, setAddress] = useState(serverUrl() || 'http://');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function connect(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const before = serverUrl();
    let url = address.trim();
    if (!/^https?:\/\//.test(url)) url = `http://${url}`;
    try {
      setServerUrl(url);
      // Gives up after 10 seconds: with NetBird off the phone can otherwise
      // wait minutes before admitting the server isn't there.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(serverLink('/health'), { signal: ctrl.signal }).finally(() => clearTimeout(timer));
      const data = await res.json().catch(() => ({}));
      if (data.status !== 'ok') throw new Error('That address answered, but not like PokeCard Tracker');
      onDone();
    } catch (err) {
      setServerUrl(before);
      setError(err.name === 'AbortError' || err instanceof TypeError
        ? "Can't reach that address. Is NetBird connected, and is it the backend's port (14001)?"
        : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--space-5)' }}>
      <form className="panel" onSubmit={connect} style={{ width: '100%', maxWidth: 420, display: 'grid', gap: 'var(--space-3)' }}>
        <h1 style={{ margin: 0, fontSize: '1.3rem' }}>⚡ PokeCard Tracker</h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Which server should this phone use?</p>
        <label style={{ display: 'grid', gap: 4 }}>
          Server address
          <input className="input" value={address} onChange={e => setAddress(e.target.value)}
            inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            placeholder="http://<server address>:14001" />
        </label>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          The NetBird address of the server, with the backend's port, 14001.
        </span>
        <button className="btn btn-primary" disabled={busy || address.trim().length < 10}>{busy ? 'Checking…' : 'Connect'}</button>
        {error && <p style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>}
      </form>
    </div>
  );
}

export function UpdateBanner() {
  const [latest, setLatest] = useState(null);

  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    (async () => {
      try {
        const [info, server] = await Promise.all([CapApp.getInfo(), api.app.latest()]);
        if (!cancelled && server.versionCode && server.versionCode > Number(info.build)) setLatest(server);
      } catch { /* offline or no app on the server: no banner */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!latest) return null;
  return (
    // A plain link to another address: the app hands it to the phone's browser.
    <a href={serverLink('/download/pokecard-tracker.apk')} style={{
      display: 'block', background: 'var(--accent)', color: '#fff', textAlign: 'center',
      padding: 'var(--space-2) var(--space-4)', fontWeight: 700, textDecoration: 'none',
    }}>
      📲 A new version ({latest.versionName}) is ready. Tap to update.
    </a>
  );
}
