// components/SetToolsModal.jsx — Set-level tools: reimport, alternates, move cards, manual add
import { useState } from 'react';
import { api } from '../api.js';

const TABS = ['Reimport', 'Search MCAP', 'Move Card', 'Manual Add'];

export default function SetToolsModal({ set, onClose, onChanged }) {
  const [activeTab, setActiveTab] = useState('Reimport');
  const [reimporting, setReimporting] = useState(false);
  const [reimportResult, setReimportResult] = useState(null);
  const [reimportError, setReimportError] = useState(null);

  async function handleReimport() {
    try {
      setReimporting(true);
      setReimportError(null);
      setReimportResult(null);
      await api.sets.create({ tcg_id: set.tcg_id });
      setReimportResult('Reimport complete!');
      onChanged();
    } catch (err) {
      setReimportError(err.message);
    } finally {
      setReimporting(false);
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
          borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 640,
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '1.1rem' }}>Set Tools — {set.name}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 var(--space-5)' }}>
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '10px 16px',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                color: activeTab === tab ? 'var(--accent)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ padding: 'var(--space-5)', overflowY: 'auto', flex: 1 }}>
          {activeTab === 'Reimport' && (
            <div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
                Re-fetches this set's card list and prices from TCGTracking and PokéWallet.
                Existing manually-set values (logo, symbol, release date, series) are protected and won't be overwritten.
              </p>
              {reimportError && (
                <div style={{ color: 'var(--danger)', fontSize: '0.875rem', marginBottom: 'var(--space-3)' }}>
                  {reimportError}
                </div>
              )}
              {reimportResult && (
                <div style={{ color: 'var(--success)', fontSize: '0.875rem', marginBottom: 'var(--space-3)' }}>
                  {reimportResult}
                </div>
              )}
              <button className="btn btn-primary" onClick={handleReimport} disabled={reimporting}>
                {reimporting ? 'Reimporting…' : '↻ Reimport Set'}
              </button>
            </div>
          )}

          {activeTab === 'Search MCAP' && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Coming soon.
            </div>
          )}

          {activeTab === 'Move Card' && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Coming soon.
            </div>
          )}

          {activeTab === 'Manual Add' && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Coming soon.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}