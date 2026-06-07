// pages/Admin.jsx — Admin tools: Backup/Restore + Series Map editor
import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';

export default function Admin() {
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 'var(--space-6)' }}>Admin</h1>
      <SeriesMapEditor />
      <div style={{ marginTop: 'var(--space-7)' }}>
        <BackupSection />
      </div>
    </div>
  );
}

// ── Series Map Editor ─────────────────────────────────────────────────────────
function SeriesMapEditor() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [editingCode, setEditingCode] = useState(null); // set_code being edited
  const [editValue, setEditValue]     = useState('');
  const [newCode, setNewCode]         = useState('');
  const [newSeries, setNewSeries]     = useState('');
  const [adding, setAdding]           = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { loadRows(); }, []);

  async function loadRows() {
    try {
      setLoading(true);
      const data = await api.admin.seriesMap.list();
      setRows(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Start editing a row — focus the input after render
  function startEdit(row) {
    setEditingCode(row.set_code);
    setEditValue(row.series);
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  // Save an inline edit — sets is_manual = true automatically
  async function saveEdit(set_code) {
    if (!editValue.trim()) return;
    try {
      await api.admin.seriesMap.update(set_code, { series: editValue.trim(), is_manual: true });
      setRows(prev => prev.map(r =>
        r.set_code === set_code ? { ...r, series: editValue.trim(), is_manual: true } : r
      ));
    } catch (err) {
      setError(err.message);
    } finally {
      setEditingCode(null);
    }
  }

  // Toggle is_manual without changing the series name
  async function toggleManual(row) {
    try {
      await api.admin.seriesMap.update(row.set_code, { is_manual: !row.is_manual });
      setRows(prev => prev.map(r =>
        r.set_code === row.set_code ? { ...r, is_manual: !r.is_manual } : r
      ));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(set_code) {
    if (!confirm(`Delete mapping for ${set_code}? It will be re-detected on next import.`)) return;
    try {
      await api.admin.seriesMap.delete(set_code);
      setRows(prev => prev.filter(r => r.set_code !== set_code));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!newCode.trim() || !newSeries.trim()) return;
    try {
      setAdding(true);
      const row = await api.admin.seriesMap.add(newCode.trim(), newSeries.trim());
      setRows(prev => [...prev, row].sort((a, b) =>
        a.series.localeCompare(b.series) || a.set_code.localeCompare(b.set_code)
      ));
      setNewCode('');
      setNewSeries('');
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Loading series map…</div>;

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', marginBottom: 'var(--space-2)', fontFamily: 'var(--font-display)' }}>
        Series Map
      </h2>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
        Maps set codes to series names. Click a series name to edit it inline.
        Manual entries are never overwritten on reimport.
      </p>

      {error && (
        <div style={{ color: 'var(--danger)', marginBottom: 'var(--space-3)', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ ...rowStyle, background: 'var(--bg-elevated)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <div style={{ width: 90 }}>Set Code</div>
          <div style={{ flex: 1 }}>Series</div>
          <div style={{ width: 70, textAlign: 'center' }}>Manual</div>
          <div style={{ width: 40 }} />
        </div>

        {/* Rows */}
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {rows.map((row, i) => (
            <div
              key={row.set_code}
              style={{
                ...rowStyle,
                background: i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-elevated)',
                borderTop: '1px solid var(--border)',
                fontSize: '0.85rem',
              }}
            >
              {/* Set code — read only */}
              <div style={{ width: 90, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-secondary)' }}>
                {row.set_code}
              </div>

              {/* Series — inline editable */}
              <div style={{ flex: 1 }}>
                {editingCode === row.set_code ? (
                  <input
                    ref={inputRef}
                    className="input"
                    style={{ padding: '2px 8px', fontSize: '0.85rem', height: 28 }}
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => saveEdit(row.set_code)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveEdit(row.set_code);
                      if (e.key === 'Escape') setEditingCode(null);
                    }}
                  />
                ) : (
                  <span
                    onClick={() => startEdit(row)}
                    style={{ cursor: 'pointer', padding: '2px 4px', borderRadius: 'var(--radius-sm)', display: 'inline-block' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {row.series}
                  </span>
                )}
              </div>

              {/* Manual toggle */}
              <div style={{ width: 70, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={row.is_manual}
                  onChange={() => toggleManual(row)}
                  title={row.is_manual ? 'Manual — won\'t be overwritten on reimport' : 'Auto-detected — may change on reimport'}
                />
              </div>

              {/* Delete */}
              <div style={{ width: 40, textAlign: 'center' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleDelete(row.set_code)}
                  style={{ fontSize: '0.75rem', padding: '2px 6px', color: 'var(--danger)' }}
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add row */}
        <div style={{ ...rowStyle, borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
          <div style={{ width: 90 }}>
            <input
              className="input"
              placeholder="Code"
              style={{ padding: '2px 8px', fontSize: '0.85rem', height: 28, width: '100%' }}
              value={newCode}
              onChange={e => setNewCode(e.target.value.toUpperCase())}
            />
          </div>
          <div style={{ flex: 1, paddingLeft: 'var(--space-2)' }}>
            <input
              className="input"
              placeholder="Series name"
              style={{ padding: '2px 8px', fontSize: '0.85rem', height: 28, width: '100%' }}
              value={newSeries}
              onChange={e => setNewSeries(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(e); }}
            />
          </div>
          <div style={{ width: 70 }} />
          <div style={{ width: 40, paddingLeft: 'var(--space-2)' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleAdd}
              disabled={adding || !newCode.trim() || !newSeries.trim()}
              style={{ fontSize: '0.75rem', padding: '2px 8px' }}
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  padding: '6px var(--space-4)',
  gap: 'var(--space-3)',
};

// ── Backup Section ────────────────────────────────────────────────────────────
// Lifted directly from Backup.jsx — no logic changes
function BackupSection() {
  const [backups, setBackups]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [running, setRunning]     = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage]     = useState(null);
  const [confirmRestore, setConfirmRestore] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => { loadBackups(); }, []);

  async function loadBackups() {
    try {
      const data = await api.backup.list();
      setBackups(data.backups || []);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function runBackup() {
    try {
      setRunning(true);
      setMessage(null);
      const result = await api.backup.run();
      setMessage({ type: 'success', text: `Backup created: ${result.filename}` });
      await loadBackups();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setRunning(false);
    }
  }

  async function handleRestore(file) {
    if (!file) return;
    setConfirmRestore(file);
  }

  async function confirmRestoreAction() {
    const file = confirmRestore;
    setConfirmRestore(null);
    try {
      setRestoring(true);
      setMessage(null);
      const formData = new FormData();
      if (file instanceof File) {
        formData.append('backup', file);
      } else {
        formData.append('filename', file);
      }
      const result = await api.backup.restore(formData);
      setMessage({ type: 'success', text: result.message || 'Restore complete' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', marginBottom: 'var(--space-2)', fontFamily: 'var(--font-display)' }}>
        Backup & Restore
      </h2>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
        Backups run automatically at 2AM daily. You can also trigger one manually.
      </p>

      {message && (
        <div style={{
          padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)',
          background: message.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          color: message.type === 'success' ? 'var(--success)' : 'var(--danger)',
          fontSize: '0.875rem',
        }}>
          {message.text}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={runBackup} disabled={running}>
          {running ? 'Creating backup…' : '💾 Backup Now'}
        </button>
        <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={restoring}>
          📂 Restore from File
        </button>
        <input
          ref={fileRef} type="file" accept=".sql" style={{ display: 'none' }}
          onChange={e => handleRestore(e.target.files[0])}
        />
      </div>

      {/* Backup list */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading backups…</div>
      ) : backups.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No backups yet.</div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <div style={{ ...rowStyle, background: 'var(--bg-elevated)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <div style={{ flex: 1 }}>Filename</div>
            <div style={{ width: 80, textAlign: 'right' }}>Size</div>
            <div style={{ width: 140 }} />
          </div>
          {backups.map((b, i) => (
            <div key={b.filename} style={{ ...rowStyle, borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-elevated)', fontSize: '0.85rem' }}>
              <div style={{ flex: 1, fontFamily: 'var(--font-display)', fontSize: '0.8rem' }}>{b.filename}</div>
              <div style={{ width: 80, textAlign: 'right', color: 'var(--text-muted)' }}>
                {b.size_kb ? `${b.size_kb} KB` : '—'}
              </div>
              <div style={{ width: 140, display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => api.backup.download(b.filename)} style={{ fontSize: '0.75rem' }}>
                  ⬇ Download
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => handleRestore(b.filename)} disabled={restoring} style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>
                  ↺ Restore
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirm restore modal */}
      {confirmRestore && (
        <div onClick={() => setConfirmRestore(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', maxWidth: 400, width: '100%' }}>
            <h3 style={{ marginBottom: 'var(--space-3)' }}>Confirm Restore</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-5)' }}>
              This will overwrite all current data. Are you sure?
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setConfirmRestore(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmRestoreAction} disabled={restoring}>
                {restoring ? 'Restoring…' : 'Yes, Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
