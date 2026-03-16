import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { DataTable } from '../components/DataTable';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorState } from '../components/ErrorState';
import { listEvents } from '../api/events';
import { listAttributionQueue } from '../api/attribution';
import { listPlayerMappingQueue } from '../api/playerMapping';
import type { EventSummary } from '../types';

export function Dashboard() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [attributionCount, setAttributionCount] = useState<number>(0);
  const [mappingCount, setMappingCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [evts, attr, map] = await Promise.allSettled([
        listEvents({}),
        listAttributionQueue(),
        listPlayerMappingQueue(),
      ]);
      if (evts.status === 'fulfilled') setEvents(evts.value.slice(0, 15));
      else setEvents([]);
      if (attr.status === 'fulfilled') setAttributionCount(attr.value.length);
      else setAttributionCount(0);
      if (map.status === 'fulfilled') setMappingCount(map.value.length);
      else setMappingCount(0);
      if (evts.status === 'rejected' && attr.status === 'rejected' && map.status === 'rejected')
        setError([evts.reason?.message, attr.reason?.message, map.reason?.message].filter(Boolean)[0] ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const columns = [
    { key: 'id', label: 'Event', render: (r: EventSummary) => r.external_event_id || r.id.slice(0, 8) },
    { key: 'source_app', label: 'Source app', render: (r: EventSummary) => r.source_app ?? '—' },
    { key: 'round_date', label: 'Date' },
    { key: 'group_name', label: 'Group', render: (r: EventSummary) => r.group_name ?? r.group_id?.slice(0, 8) ?? '—' },
    { key: 'status', label: 'Status', render: (r: EventSummary) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Operational snapshot" />
      <div className="card">
        <h2>Summary</h2>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div><strong>Recent events</strong>: {events.length}</div>
          <div><strong>Pending attribution</strong>: {attributionCount} <Link to="/review/attribution">Review</Link></div>
          <div><strong>Pending player mapping</strong>: {mappingCount} <Link to="/review/player-mapping">Review</Link></div>
        </div>
      </div>
      <div className="card">
        <h2>Attention required</h2>
        <ul className="attention-list">
          <li>
            <span>Attribution review queue</span>
            <Link to="/review/attribution">{attributionCount} item(s)</Link>
          </li>
          <li>
            <span>Player mapping queue</span>
            <Link to="/review/player-mapping">{mappingCount} item(s)</Link>
          </li>
        </ul>
      </div>
      <div className="card">
        <h2>Recent events</h2>
        {events.length === 0 ? (
          <p className="empty-state">No events yet. <Link to="/events/new">Enter a round</Link> or wait for API ingestion.</p>
        ) : (
          <DataTable
            columns={columns}
            data={events}
            getRowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/events/${r.id}`)}
          />
        )}
        <p style={{ marginTop: 12 }}>
          <Link to="/events">View all events</Link>
        </p>
      </div>
    </>
  );
}
