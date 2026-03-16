import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';

export function Layout() {
  const location = useLocation();
  const nav = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/events', label: 'Events' },
    { path: '/events/new', label: 'Round entry' },
    { path: '/standings', label: 'Standings' },
    { path: '/review/attribution', label: 'Attribution review' },
    { path: '/review/player-mapping', label: 'Player mapping' },
  ];
  return (
    <div className="app">
      <nav className="nav">
        {nav.map(({ path, label }) => (
          <Link key={path} to={path} style={{ fontWeight: location.pathname === path ? 600 : 400 }}>
            {label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
