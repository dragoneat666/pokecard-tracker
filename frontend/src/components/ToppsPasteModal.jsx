// components/ToppsPasteModal.jsx — Paste a sheet from Excel into a Topps table
//
// Copy cells in Excel and paste them here: one line per card — number, name,
// then optionally one cell per column. Rules (matching the old spreadsheets):
// 0 = that printing doesn't exist for the card, blank = need it, anything else
// = have it. If the top line is a heading row, columns are matched by name and
// any new ones are created. The server does the work (see utils/toppsPaste.js);
// this just collects the text and shows what happened.

import { useState } from 'react';
import { api } from '../api.js';

export default function ToppsPasteModal({ table, onClose }) {
  const [text, setText]     = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError]   = useState(null);
  const [result, setResult] = useState(null);

  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '').length;

  async function handleAdd() {
    try {
      setWorking(true);
      setError(null);
      setResult(await api.topps.pasteRows(table.id, text));
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  }

  const label = table.title || 'this table';
  // Closing after a paste tells the page to reload so the new rows show up.
  const close = () => onClose(result !== null && result.added + result.columns_created > 0);

  return (
    <div
      onClick={close}
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
          borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 680,
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '1.1rem' }}>Paste from Excel — {label}</h2>
          <button className="btn btn-ghost btn-sm" onClick={close}>✕</button>
        </div>

        <div style={{ padding: 'var(--space-5)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {result ? (
            <>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: result.added > 0 ? 'var(--success)' : 'var(--text-secondary)' }}>
                Added {result.added} card{result.added !== 1 ? 's' : ''}
                {result.columns_created > 0 && ` and ${result.columns_created} new column${result.columns_created !== 1 ? 's' : ''}`}.
              </div>
              {result.skipped.length > 0 && (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    {result.skipped.length} line{result.skipped.length !== 1 ? 's' : ''} skipped:
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                    {result.skipped.slice(0, 12).map((s, i) => (
                      <li key={i}>Line {s.line}{s.number ? ` (${s.number})` : ''}: {s.reason}</li>
                    ))}
                  </ul>
                  {result.skipped.length > 12 && <div style={{ marginTop: 4 }}>…and {result.skipped.length - 12} more.</div>}
                </div>
              )}
            </>
          ) : (
            <>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                Copy cells in Excel and paste them below. One line per card: <strong>number</strong>, <strong>name</strong>,
                then optionally a cell for each column — <strong>0</strong> means that printing doesn't exist,
                <strong> blank</strong> means you need it, and <strong>anything else</strong> (like 1) means you have it.
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                Include a heading row (<strong>#</strong>, <strong>Name</strong>, then your column names) and the columns are
                matched by name — any that don't exist yet are created. Cards whose number is already in the table are skipped.
              </p>
              {error && <div style={{ color: 'var(--danger)', fontSize: '0.875rem' }}>{error}</div>}
              <textarea
                className="input"
                autoFocus
                rows={12}
                placeholder={'#\tName\tBlue Logo\tSilver Foil\n1\tBulbasaur\t1\t\n2\tIvysaur\t\t0'}
                value={text}
                onChange={e => setText(e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical', whiteSpace: 'pre' }}
              />
            </>
          )}
        </div>

        <div style={{ padding: 'var(--space-4) var(--space-5)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {!result && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{lines} line{lines !== 1 ? 's' : ''} pasted</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-3)' }}>
            {result ? (
              <button className="btn btn-primary" onClick={close}>Done</button>
            ) : (
              <>
                <button className="btn btn-ghost" onClick={close}>Cancel</button>
                <button className="btn btn-primary" onClick={handleAdd} disabled={working || lines === 0}>
                  {working ? 'Adding…' : 'Add to table'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
