// pages/Backup.jsx — Database backup and restore
import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';

export default function Backup() {
  const [backups, setBackups]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [running, setRunning]       = useState(false);
  const [restoring, setRestoring]   = useState(false);
  const [message, setMessage]       = useState(null); // { text, type: 'success'|'error' }
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoreFile, setRestoreFile]       = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => { loadBackups(); }, []);

  async function loadBackups() {
    try {
      setLoading(true);
      const data = await api.backup.list();
      setBackups(data.backups || []);
    } catch (err) {
      setMessage({ text: `Failed to load backups: ${err.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function handleRunBackup() {
    try {
      setRunning(true);
      setMessage(null);
      await api.backup.run();
      setMessage({ text: 'Backup completed successfully!', type: 'success' });
      loadBackups();
    } catch (err) {
      setMessage({ text: `Backup failed: ${err.message}`, type: 'error' });
    } finally {
      setRunning(false);
    }
  }

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.endsWith('.sql')) {
      setMessage({ text: 'Only .sql files are supported for restore', type: 'error' });
      return;
    }
    setRestoreFile(file);
    setConfirmRestore(true);
  }

  async function handleRestore() {
    if (!restoreFile) return;
    try {
      setRestoring(true);
      setConfirmRestore(false);
      setMessage(null);
      const formData = new FormData();
      formData.append('file', restoreFile);
      const result = await api.backup.restore(formData);
      if (result.success) {
        setMessage({ text: 'Database restored successfully! Refresh the page to see your data.', type: 'success' });
      } else {
        setMessage({ text: result.error || 'Restore failed', type: 'error' });
      }
    } catch (err) {
      setMessage({ text: `Restore failed: ${err.message}`, type: 'error' });
    } finally {
      setRestoring(false);
      setRestoreFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // Group backups by date
  const grouped = backups.reduce((acc, b) => {
    const date = b.filename.match(/\d{4}-\d{2}-\d{2}/)?.[0] || 'Unknown';
    if (!acc[date]) acc[date] = [];
    acc[date].push(b);
    return acc;
  }, {});

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 4 }}>Backup & Restore</h1>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Backups run automatically at 2:00 AM daily and are kept for 30 days.
          </span>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleRunBackup}
          disabled={running}
        >
          {running ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Running...</> : '💾 Backup Now'}
        </button>
      </div>

      {/* ── Message ── */}
      {message && (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-4)',
          background: message.type === 'success' ? 'var(--success)22' : 'var(--danger)22',
          border: `1px solid ${message.type === 'success' ? 'var(--success)' : 'var(--danger)'}44`,
          color: message.type === 'success' ? 'var(--success)' : 'var(--danger)',
          fontSize: '0.875rem',
        }}>
          {message.text}
        </div>
      )}

      {/* ── Backup List ── */}
      <div className="panel" style={{ marginBottom: 'var(--space-5)' }}>
        <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Available Backups</h2>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-6)' }}>
            <span className="spinner" />
          </div>
        ) : Object.keys(grouped).length === 0 ? (
          <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)' }}>
            No backups yet — click "Backup Now" to create your first one.
          </div>
        ) : (
          Object.entries(grouped)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([date, files]) => (
              <div key={date} style={{ borderBottom: '1px solid var(--border)' }}>
                <div style={{
                  padding: 'var(--space-2) var(--space-4)',
                  background: 'var(--bg-elevated)',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-display)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}>
                  {new Date(date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
                {files.map(file => (
                  <div key={file.filename} style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: 'var(--space-3) var(--space-4)',
                    gap: 'var(--space-3)',
                  }}>
                    <span style={{ fontSize: '1.2rem' }}>
                      {file.type === 'sql' ? '🗄️' : '📄'}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>{file.filename}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {file.type === 'sql' ? 'SQL Dump' : 'Collection CSV'} · {file.size}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => api.backup.download(file.filename)}
                    >
                      ↓ Download
                    </button>
                  </div>
                ))}
              </div>
            ))
        )}
      </div>

      {/* ── Restore ── */}
      <div className="panel">
        <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Restore from Backup</h2>
        </div>
        <div style={{ padding: 'var(--space-4)' }}>
          <div style={{
            padding: 'var(--space-3) var(--space-4)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--danger)22',
            border: '1px solid var(--danger)44',
            color: 'var(--danger)',
            fontSize: '0.875rem',
            marginBottom: 'var(--space-4)',
          }}>
            ⚠️ Restoring will completely wipe the current database and replace it with the backup. This cannot be undone.
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".sql"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <button
            className="btn btn-ghost"
            style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
            onClick={() => fileInputRef.current?.click()}
            disabled={restoring}
          >
            {restoring ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Restoring...</> : '⚠️ Upload & Restore SQL Backup'}
          </button>
        </div>
      </div>

      {/* ── Confirm Restore Modal ── */}
      {confirmRestore && (
        <div
          onClick={() => setConfirmRestore(false)}
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
              borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 440,
              padding: 'var(--space-5)',
            }}
          >
            <h2 style={{ fontSize: '1.1rem', marginBottom: 'var(--space-3)' }}>⚠️ Confirm Restore</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 'var(--space-3)' }}>
              You are about to restore from:
            </p>
            <div style={{
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-display)',
              fontSize: '0.85rem',
              marginBottom: 'var(--space-4)',
            }}>
              {restoreFile?.name}
            </div>
            <p style={{ color: 'var(--danger)', fontSize: '0.875rem', marginBottom: 'var(--space-5)' }}>
              This will permanently wipe all current data and cannot be undone. Are you sure?
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => { setConfirmRestore(false); setRestoreFile(null); }}>
                Cancel
              </button>
              <button
                className="btn"
                style={{ background: 'var(--danger)', color: 'white', border: 'none' }}
                onClick={handleRestore}
              >
                Yes, Restore Database
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
