// pages/Exports.jsx — Temporary exported images
//
// Images sent here from an export are kept on the backend for 24 hours so you
// can open this page on your phone and save them to your photos (press and
// hold an image). Nothing here is permanent — it's only a hand-off spot.
// Bookmark /exports on your phone.

import { useState, useEffect } from 'react';
import { api } from '../api.js';

function timeLeft(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expiring';
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return hours > 0 ? `${hours}h ${mins}m left` : `${mins}m left`;
}

export default function Exports() {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setItems(await api.exports.list());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    try {
      await api.exports.remove(id);
      setItems(prev => prev.filter(i => i.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 2 }}>Exports</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 'var(--space-5)' }}>
        Temporary — images are deleted after 24 hours. On a phone, press and hold an image to save it.
      </p>

      {error && <div style={{ color: 'var(--danger)', marginBottom: 'var(--space-3)' }}>{error}</div>}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-7)' }}><span className="spinner" /></div>
      ) : items.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-muted)' }}>
          Nothing here. Create an export from a set's Set Tools and choose “Send to phone”.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {items.map(item => (
            <div key={item.id} className="panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{item.title}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {item.count} image{item.count !== 1 ? 's' : ''} · {new Date(item.created_at).toLocaleString()} · {timeLeft(item.expires_at)}
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(item.id)}>
                  Delete
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--space-3)' }}>
                {Array.from({ length: item.count }, (_, i) => (
                  <a key={i} href={api.exports.imageUrl(item.id, i + 1)} target="_blank" rel="noopener noreferrer">
                    <img
                      src={api.exports.imageUrl(item.id, i + 1)}
                      alt={`${item.title} ${i + 1}`}
                      loading="lazy"
                      style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}
                    />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
