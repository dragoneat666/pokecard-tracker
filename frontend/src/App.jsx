import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation, useNavigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import SetView   from './pages/SetView.jsx';
import Admin     from './pages/Admin.jsx';
import Reports   from './pages/Reports.jsx';
import Bulk      from './pages/Bulk.jsx';
import Exports   from './pages/Exports.jsx';
import Topps     from './pages/Topps.jsx';
import ToppsSet  from './pages/ToppsSet.jsx';
import Coins     from './pages/Coins.jsx';
import CoinGeneration from './pages/CoinGeneration.jsx';
import CardBrowser from './pages/CardBrowser.jsx';
import GradingLab from './pages/GradingLab.jsx';
import Grading   from './pages/Grading.jsx';
import { ServerSetup, UpdateBanner, needsServer } from './components/AppShell.jsx';
import { isNative } from './api.js';

// The Android app opens on the Grading tab (once per launch; after that the
// Collection link works as usual).
function StartOnGrading() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!isNative || sessionStorage.getItem('pokecard.started')) return;
    sessionStorage.setItem('pokecard.started', '1');
    if (location.pathname === '/') navigate('/grading', { replace: true });
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Layout() {
  const location = useLocation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <StartOnGrading />
      <UpdateBanner />
      <nav className="app-nav" style={{
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        padding: 'var(--safe-top) var(--space-5) 0',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-5)',
        height: 'calc(52px + var(--safe-top))',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
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
          ⚡ <span className="app-brand-name">PokeCard Tracker</span>
        </NavLink>
        <NavLink to="/"       style={navStyle} end>Collection</NavLink>
        <NavLink to="/topps" style={navStyle}>Topps</NavLink>
        <NavLink to="/burger-king" style={navStyle}>Burger King Cards</NavLink>
        <NavLink to="/mini-tins" style={navStyle}>Mini Tin Art</NavLink>
        <NavLink to="/coins" style={navStyle}>Coins</NavLink>
        <NavLink to="/card-browser" style={navStyle}>Card Browser</NavLink>
        <NavLink to="/grading" style={navStyle}>Grading</NavLink>
        <NavLink to="/reports" style={navStyle}>Reports</NavLink>
        <NavLink to="/bulk" style={navStyle}>Bulk</NavLink>
        <NavLink to="/admin" style={navStyle}>Admin</NavLink>
        <div style={{ flex: 1 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
          Denflix
        </span>
      </nav>
      <main className="app-main" style={{ flex: 1, minWidth: 0 }}>
        <Routes>
          <Route path="/"         element={<Dashboard />} />
          <Route path="/sets/:id" element={<SetView />} />
          <Route path="/topps"    element={<Topps key="topps" kind="topps" />} />
          <Route path="/topps/:id" element={<ToppsSet />} />
          <Route path="/burger-king"     element={<Topps key="burger_king" kind="burger_king" />} />
          <Route path="/burger-king/:id" element={<ToppsSet />} />
          <Route path="/mini-tins"       element={<Topps key="mini_tin" kind="mini_tin" />} />
          <Route path="/mini-tins/:id"   element={<ToppsSet />} />
          <Route path="/coins"    element={<Coins />} />
          <Route path="/coins/:id" element={<CoinGeneration />} />
          <Route path="/card-browser" element={<CardBrowser />} />
          <Route path="/grading" element={<Grading />} />
          <Route path="/grading/lab" element={<GradingLab />} />
          <Route path="/reports"  element={<Reports />} />
          <Route path="/bulk"     element={<Bulk />} />
          <Route path="/exports"  element={<Exports />} />
          <Route path="/admin"    element={<Admin />} />
        </Routes>
      </main>
    </div>
  );
}

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
  // The Android app first asks which server to use.
  const [setup, setSetup] = useState(needsServer);
  if (setup) return <ServerSetup onDone={() => setSetup(false)} />;
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}
