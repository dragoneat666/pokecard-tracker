// components/SetNavigator.jsx
// Slide-out sidebar showing series/set tree for quick navigation.
// Opens when showNavigator is true, closes on overlay click or X button.
// Clicking a series scrolls to and expands it.
// Clicking a set scrolls directly to its row.

import { useEffect, useRef } from 'react';

export default function SetNavigator({ groupedSeries, collapsed, onToggleSeries, onClose }) {
  const sidebarRef = useRef(null);

  // Close when clicking outside the sidebar
  // useEffect with an event listener on the document — when a click happens
  // anywhere, we check if it was inside the sidebar ref or not.
  useEffect(() => {
    function handleClickOutside(e) {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Scroll to a series section and expand it if collapsed
  function jumpToSeries(seriesName) {
    if (collapsed.has(seriesName)) {
      onToggleSeries(seriesName);
    }
    // Small delay so the section expands before we scroll to it
    setTimeout(() => {
      const id = `series-${seriesName.replace(/\s+/g, '-')}`;
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    onClose();
  }

  // Scroll to a specific set row
  function jumpToSet(setId) {
    document.getElementById(`set-${setId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    onClose();
  }

  return (
    <>
      {/* ── Overlay — darkens the background behind the sidebar ── */}
      <div style={{
        position: 'fixed',
        inset: 0,                              // shorthand for top/right/bottom/left: 0
        background: 'rgba(0, 0, 0, 0.4)',
        zIndex: 100,
      }} />

      {/* ── Sidebar panel ── */}
      <div
        ref={sidebarRef}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100vh',
          width: 280,
          background: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border)',
          zIndex: 101,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
        }}
      >

        {/* ── Sidebar header ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-4)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '0.9rem',
            color: 'var(--text-primary)',
            letterSpacing: '0.05em',
          }}>
            SET NAVIGATOR
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            style={{ fontSize: '1rem', padding: '2px 8px' }}
          >
            ✕
          </button>
        </div>

        {/* ── Series/set tree ── */}
        {/* overflow-y: auto means it scrolls if there are many sets */}
        <div style={{ overflowY: 'auto', flex: 1, padding: 'var(--space-3) 0' }}>
          {groupedSeries.map(group => (
            <div key={group.series}>

              {/* Series row */}
              <div
                onClick={() => jumpToSeries(group.series)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 'var(--space-2) var(--space-4)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  color: 'var(--text-primary)',
                  letterSpacing: '0.03em',
                  borderRadius: 'var(--radius-sm)',
                  margin: '0 var(--space-2)',
                  transition: 'background var(--transition)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span>{group.series}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                  {group.sets.length}
                </span>
              </div>

              {/* Set rows — indented under their series */}
              {group.sets.map(set => (
                <div
                  key={set.id}
                  onClick={() => jumpToSet(set.id)}
                  style={{
                    padding: 'var(--space-1) var(--space-4) var(--space-1) calc(var(--space-4) + 16px)',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    color: 'var(--text-secondary)',
                    borderRadius: 'var(--radius-sm)',
                    margin: '0 var(--space-2)',
                    transition: 'background var(--transition)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {set.name}
                </div>
              ))}

            </div>
          ))}
        </div>

      </div>
    </>
  );
}
