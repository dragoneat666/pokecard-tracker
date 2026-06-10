// components/EditSetModal.jsx — Edit set metadata
import { useState, useEffect } from 'react';
import { api } from '../api.js';

const SET_TYPES    = ['Main', 'Special', "McDonald's", 'Promo', 'POP', 'Play! Prize Pack', 'Miscellaneous'];
const VARIANT_TYPES = [
  { value: 'reverse_holo',  label: 'Reverse Holo' },
  { value: 'first_edition', label: 'First Edition' },
  { value: 'both',          label: 'Both' },
  { value: 'none',          label: 'Neither' },
];

export default function EditSetModal({ set, onClose, onSaved }) {
  const [form, setForm] = useState({
    name:         set.name         || '',
    series:       set.series       || '',
    set_type:     set.set_type     || 'Main',
    variant_type: set.variant_type || 'reverse_holo',
    logo_url:     set.logo_url     || '',
    symbol_url:   set.symbol_url   || '',
    release_date: set.release_date ? set.release_date.split('T')[0] : '',
    is_parent:     set.is_parent     || false,
    parent_set_id: set.parent_set_id || '',
  });
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState(null);
  const [parentSets, setParentSets] = useState([]);
  
  useEffect(() => {
    api.sets.parentSets().then(setParentSets).catch(() => {});
  }, []);

  function handleChange(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      await api.sets.update(set.id, {
        name:         form.name         || null,
        series:       form.series       || null,
        set_type:     form.set_type,
        variant_type: form.variant_type,
        logo_url:     form.logo_url     || null,
        symbol_url:   form.symbol_url   || null,
        release_date: form.release_date || null,
        is_parent:     form.is_parent,
        parent_set_id: form.parent_set_id || null,
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
        {/* Header */}
        <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '1.1rem' }}>Edit Set</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {error && <div style={{ color: 'var(--danger)', fontSize: '0.875rem' }}>{error}</div>}

          <label>
            <div style={labelStyle}>Set Name</div>
            <input className="input" value={form.name} onChange={e => handleChange('name', e.target.value)} />
          </label>

          <label>
            <div style={labelStyle}>Series</div>
            <input className="input" placeholder="e.g. Scarlet & Violet" value={form.series} onChange={e => handleChange('series', e.target.value)} />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <label>
              <div style={labelStyle}>Set Type</div>
              <select className="input" value={form.set_type} onChange={e => handleChange('set_type', e.target.value)}>
                {SET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>

            <label>
              <div style={labelStyle}>Variant Type</div>
              <select className="input" value={form.variant_type} onChange={e => handleChange('variant_type', e.target.value)}>
                {VARIANT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
          </div>

          <label>
            <div style={labelStyle}>Release Date</div>
            <input className="input" type="date" value={form.release_date} onChange={e => handleChange('release_date', e.target.value)} />
          </label>

          {/* Is Parent checkbox */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.is_parent}
              onChange={e => handleChange('is_parent', e.target.checked)}
            />
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              This set has subsets (e.g. Generations + Radiant Collection)
            </span>
          </label>
          
          {/* Parent set dropdown — only show if this set is not itself a parent */}
          {!form.is_parent && (
            <label>
              <div style={labelStyle}>Child of (subset)</div>
              <select
                className="input"
                value={form.parent_set_id}
                onChange={e => handleChange('parent_set_id', e.target.value)}
              >
                <option value="">— None —</option>
                {parentSets
                  .filter(p => p.id !== set.id)
                  .map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))
                }
              </select>
            </label>
          )}

          <label>
            <div style={labelStyle}>Logo URL</div>
            <input className="input" placeholder="https://..." value={form.logo_url} onChange={e => handleChange('logo_url', e.target.value)} />
            {form.logo_url && (
              <img src={form.logo_url} alt="Logo preview" style={{ marginTop: 8, maxHeight: 48, objectFit: 'contain' }} />
            )}
          </label>

          <label>
            <div style={labelStyle}>Symbol URL</div>
            <input className="input" placeholder="https://..." value={form.symbol_url} onChange={e => handleChange('symbol_url', e.target.value)} />
            {form.symbol_url && (
              <img src={form.symbol_url} alt="Symbol preview" style={{ marginTop: 8, maxHeight: 32, objectFit: 'contain' }} />
            )}
          </label>
        </div>

        {/* Footer */}
        <div style={{ padding: 'var(--space-4) var(--space-5)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
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
