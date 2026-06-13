// pages/Admin.jsx — Admin tools: Collection Import/Export + Backup/Restore + Series Map editor
import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';

export default function Admin() {
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 'var(--space-6)' }}>Admin</h1>
      <CollectionImportExport />
      <div style={{ marginTop: 'var(--space-7)' }}>
        <SeriesMapEditor />
      </div>
      <div style={{ marginTop: 'var(--space-7)' }}>
        <BackupSection />
      </div>
    </div>
  );
}

// ── Collection Import/Export ──────────────────────────────────────────────────
function CollectionImportExport() {
  const [sets, setSets]               = useState([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [importing, setImporting]     = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  const importFileRef = useRef(null);

  useEffect(() => {
    api.sets.list().then(setSets).catch(() => {});
  }, []);

  // ── Import ──────────────────────────────────────────────────────────────────
  async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // reset so same file can be picked again

    if (!confirm(
      `This will update owned/reverse holo data for cards found in the CSV.\n\n` +
      `Cards with 0 or blank values will be skipped.\n` +
      `This cannot be undone. Continue?`
    )) return;

    try {
      setImporting(true);
      setImportResult(null);
      setImportError(null);
      const formData = new FormData();
      formData.append('file', file);
      const result = await api.import.collection(formData);
      setImportResult(result);
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImporting(false);
    }
  }

  // ── Download log file ───────────────────────────────────────────────────────
  function downloadLog(result) {
    const lines = [
      `Collection Import Log`,
      `=====================`,
      `Total rows: ${result.summary.total}`,
      `Updated:    ${result.summary.updated}`,
      `Skipped:    ${result.summary.skipped}`,
      `Errors:     ${result.summary.errors}`,
      ``,
      `── Updated ─────────────────────────────`,
      ...result.log.updated,
      ``,
      `── Skipped ─────────────────────────────`,
      ...result.log.skipped,
      ``,
      `── Errors ──────────────────────────────`,
      ...result.log.errors.map(e => `${e.row} — ${e.reason}`),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import-log-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', marginBottom: 'var(--space-2)', fontFamily: 'var(--font-display)' }}>
        Collection Import / Export
      </h2>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
        Export owned card data for specific sets as CSV, or import a CSV to update your collection.
      </p>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => setShowExportModal(true)}>
          ⬇ Export Sets CSV
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => importFileRef.current?.click()}
          disabled={importing}
        >
          {importing ? 'Importing…' : '⬆ Import CSV'}
        </button>
        <input
          ref={importFileRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      </div>

      {/* Import error */}
      {importError && (
        <div style={{
          padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)',
          background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', fontSize: '0.875rem',
        }}>
          Import failed: {importError}
        </div>
      )}

      {/* Import result summary */}
      {importResult && (
        <div style={{
          padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>
            Import Complete
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-5)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
            {[
              { label: 'Total Rows', value: importResult.summary.total },
              { label: 'Updated',    value: importResult.summary.updated,  color: 'var(--success)' },
              { label: 'Skipped',    value: importResult.summary.skipped,  color: 'var(--text-muted)' },
              { label: 'Errors',     value: importResult.summary.errors,   color: importResult.summary.errors > 0 ? 'var(--danger)' : 'var(--text-muted)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: color || 'var(--text-primary)' }}>
                  {value}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-display)' }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => downloadLog(importResult)}>
            ⬇ Download Log
          </button>
        </div>
      )}

      {/* Export modal */}
      {showExportModal && (
        <ExportModal
          sets={sets}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
}

// ── Export Modal ──────────────────────────────────────────────────────────────
function ExportModal({ sets, onClose }) {
  const [selected, setSelected] = useState(new Set());
  const [exporting, setExporting] = useState(false);

  function toggleSet(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === sets.length) setSelected(new Set());
    else setSelected(new Set(sets.map(s => s.id)));
  }

  async function handleExport() {
    if (selected.size === 0) return;
    try {
      setExporting(true);

      // Fetch cards for each selected set
      const rows = ['set_name,card_number,card_name,regular_owned,reverse_holo_owned'];

      for (const setId of selected) {
        const data = await api.sets.get(setId);
        const setName = data.set.name.replace(/,/g, ';'); // escape commas in set name
        for (const card of data.cards) {
          const cardName = card.name.replace(/,/g, ';');
          const cardNum  = card.card_number;
          const owned    = card.owned || 0;
          const reverse  = card.reverse_owned || 0;
          rows.push(`"${setName}","${cardNum}","${cardName}",${owned},${reverse}`);
        }
        // Also include child set cards if this is a parent
        if (data.childSets) {
          for (const { set: childSet, cards: childCards } of data.childSets) {
            const childName = childSet.name.replace(/,/g, ';');
            for (const card of childCards) {
              const cardName = card.name.replace(/,/g, ';');
              rows.push(`"${childName}","${card.card_number}","${cardName}",${card.owned || 0},${card.reverse_owned || 0}`);
            }
          }
        }
      }

      // Download CSV in browser
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `collection-export-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }

  const allSelected = selected.size === sets.length;

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
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '1.1rem' }}>Export Sets</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Select all */}
        <div style={{ padding: 'var(--space-3) var(--space-5)', borderBottom: '1px solid var(--border)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            {allSelected ? 'Deselect all' : 'Select all'} ({sets.length} sets)
          </label>
        </div>

        {/* Set list */}
        <div style={{ overflowY: 'auto', flex: 1, padding: 'var(--space-3) var(--space-5)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {sets.map(set => (
              <label
                key={set.id}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer', fontSize: '0.875rem' }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(set.id)}
                  onChange={() => toggleSet(set.id)}
                />
                <span style={{ flex: 1 }}>{set.name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{set.series}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: 'var(--space-4) var(--space-5)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {selected.size} set{selected.size !== 1 ? 's' : ''} selected
          </span>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={selected.size === 0 || exporting}
              onClick={handleExport}
            >
              {exporting ? 'Exporting…' : `Export (${selected.size})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Series Map Editor ─────────────────────────────────────────────────────────
function SeriesMapEditor() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [editingCode, setEditingCode] = useState(null);
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

  function startEdit(row) {
    setEditingCode(row.set_code);
    setEditValue(row.series);
    setTimeout(() => inputRef.current?.focus(), 30);
  }

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

      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div style={{ ...rowStyle, background: 'var(--bg-elevated)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <div style={{ width: 90 }}>Set Code</div>
          <div style={{ flex: 1 }}>Series</div>
          <div style={{ width: 70, textAlign: 'center' }}>Manual</div>
          <div style={{ width: 40 }} />
        </div>

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
              <div style={{ width: 90, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-secondary)' }}>
                {row.set_code}
              </div>
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
              <div style={{ width: 70, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={row.is_manual}
                  onChange={() => toggleManual(row)}
                  title={row.is_manual ? "Manual — won't be overwritten on reimport" : 'Auto-detected — may change on reimport'}
                />
              </div>
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
      setMessage({ type: 'success', text: `Backup created: ${result.sqlFile} + ${result.csvFile}` });
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