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