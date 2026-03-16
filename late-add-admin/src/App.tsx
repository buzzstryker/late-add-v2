import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Events } from './pages/Events';
import { EventDetail } from './pages/EventDetail';
import { RoundEntry } from './pages/RoundEntry';
import { RoundEdit } from './pages/RoundEdit';
import { AttributionReview } from './pages/AttributionReview';
import { PlayerMapping } from './pages/PlayerMapping';
import { Standings } from './pages/Standings';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="events" element={<Events />} />
        <Route path="events/new" element={<RoundEntry />} />
        <Route path="events/:eventId" element={<EventDetail />} />
        <Route path="events/:eventId/edit" element={<RoundEdit />} />
        <Route path="review/attribution" element={<AttributionReview />} />
        <Route path="review/player-mapping" element={<PlayerMapping />} />
        <Route path="standings" element={<Standings />} />
      </Route>
    </Routes>
  );
}
