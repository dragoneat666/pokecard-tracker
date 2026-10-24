// components/ToppsEditModal.jsx — Edit a Topps checklist's name, logo and release date
// Same look as the Edit Set modal, trimmed to the fields that apply here.

import { useState } from 'react';
import { api } from '../api.js';

export default function ToppsEditModal({ set, onClose, onSaved }) {
  const [form, setForm] = useState({
    name:         set.name         || '',
    logo_url:     set.logo_url     || '',
    release_date: set.release_date || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  function handleChange(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      await api.topps.updateSet(set.id, {
        name:         form.name,
        logo_url:     form.logo_url     || null,
        release_date: form.release_date || null,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200, padding: 'var(--space-5)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 520,
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '1.1rem' }}>Edit Checklist</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {error && <div style={{ color: 'var(--danger)', fontSize: '0.875rem' }}>{error}</div>}

          <label>
            <div style={labelStyle}>Name</div>
            <input className="input" value={form.name} onChange={e => handleChange('name', e.target.value)} />
          </label>

          <label>
            <div style={labelStyle}>Logo URL</div>
            <input className="input" placeholder="https://..." value={form.logo_url} onChange={e => handleChange('logo_url', e.target.value)} />
            {form.logo_url && (
              <img src={form.logo_url} alt="Logo preview" style={{ marginTop: 8, maxHeight: 48, objectFit: 'contain' }} />
            )}
          </label>

          <label>
            <div style={labelStyle}>Release Date</div>
            <input className="input" type="date" value={form.release_date} onChange={e => handleChange('release_date', e.target.value)} />
          </label>
        </div>

        <div style={{ padding: 'var(--space-4) var(--space-5)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.name.trim()}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle = {
  fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)',
  marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
  fontFamily: 'var(--font-display)',
};
