// App.jsx — Top-level layout and routing
//
// react-router-dom gives us client-side routing — navigating between pages
// without a full browser reload. The URL changes, React swaps the component,
// but the page never refreshes.
//
// Routes:
//   /              → Dashboard (your Table of Contents)
//   /sets/:id      → SetView (the per-set card table)
//   /import        → Import (Excel upload)

import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import SetView   from './pages/SetView.jsx';
import Import    from './pages/Import.jsx';

function Layout() {
  const location = useLocation();

  // Extract set name from state if navigating from Dashboard
  // (so the breadcrumb can show the name without an extra API call)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <nav style={{
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        padding: '0 var(--space-5)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-5)',
        height: '52px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        {/* Logo / Home link */}
        <NavLink to="/" style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: '1.1rem',
          color: 'var(--text-primary)',
          textDecoration: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          marginRight: 'var(--space-3)',
        }}>
          ⚡ PokeCard Tracker
        </NavLink>

        <NavLink to="/"      style={navStyle} end>Collection</NavLink>
        <NavLink to="/import" style={navStyle}>Import</NavLink>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
          Denflix
        </span>
      </nav>

      <main style={{ flex: 1, padding: 'var(--space-5)' }}>
        <Routes>
          <Route path="/"         element={<Dashboard />} />
          <Route path="/sets/:id" element={<SetView />} />
          <Route path="/import"   element={<Import />} />
        </Routes>
      </main>
    </div>
  );
}

// Active nav link gets the accent color; inactive stays secondary
function navStyle({ isActive }) {
  return {
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '0.875rem',
    color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
    textDecoration: 'none',
    padding: '4px 0',
    borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
    transition: 'color var(--transition)',
  };
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}
