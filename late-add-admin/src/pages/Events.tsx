import React, { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { DataTable } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { listEvents } from '../api/events';
import type { EventSummary } from '../types';

export function Events() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const source = searchParams.get('source_app') ?? '';
  const status = searchParams.get('status') ?? '';
  const groupId = searchParams.get('group_id') ?? '';
  const fromDate = searchParams.get('from_date') ?? '';
  const toDate = searchParams.get('to_date') ?? '';

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listEvents({
        source_app: source || undefined,
        status: status || undefined,
        group_id: groupId || undefined,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
      });
      setEvents(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [source, status, groupId, fromDate, toDate]);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const columns = [
    { key: 'id', label: 'Event ID', render: (r: EventSummary) => r.id.slice(0, 8) },
    { key: 'external_event_id', label: 'External ID', render: (r: EventSummary) => r.external_event_id ?? '—' },
    { key: 'source_app', label: 'Source app', render: (r: EventSummary) => r.source_app ?? '—' },
    { key: 'round_date', label: 'Played date' },
    { key: 'group_name', label: 'Group', render: (r: EventSummary) => r.group_name ?? r.group_id?.slice(0, 8) ?? '—' },
    { key: 'season_name', label: 'Season', render: (r: EventSummary) => r.season_name ?? r.season_id?.slice(0, 8) ?? '—' },
    { key: 'status', label: 'Status', render: (r: EventSummary) => <StatusBadge status={r.status} /> },
    { key: 'created_at', label: 'Received / created', render: (r: EventSummary) => r.created_at ? new Date(r.created_at).toLocaleString() : '—' },
  ];

  return (
    <>
      <PageHeader
        title="Events"
        subtitle="Audit trail for all rounds (API-ingested and manual)"
        action={<Link to="/events/new" className="btn btn-primary">New round</Link>}
      />
      <FilterBar>
        <label>
          Source app
          <select value={source} onChange={(e) => updateParam('source_app', e.target.value)}>
            <option value="">All</option>
            <option value="manual">manual</option>
            <option value="scorekeeper">scorekeeper</option>
            <option value="18birdies">18birdies</option>
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => updateParam('status', e.target.value)}>
            <option value="">All</option>
            <option value="processed">Processed</option>
            <option value="pending_attribution">Pending attribution</option>
            <option value="pending_player_mapping">Pending player mapping</option>
            <option value="validation_error">Validation error</option>
            <option value="duplicate_ignored">Duplicate / ignored</option>
          </select>
        </label>
        <label>
          From date
          <input type="date" value={fromDate} onChange={(e) => updateParam('from_date', e.target.value)} />
        </label>
        <label>
          To date
          <input type="date" value={toDate} onChange={(e) => updateParam('to_date', e.target.value)} />
        </label>
      </FilterBar>
      <div className="card">
        {events.length === 0 ? (
          <EmptyState message="No events match the filters." action={<Link to="/events/new" className="btn btn-primary">Enter a round</Link>} />
        ) : (
          <DataTable
            columns={columns}
            data={events}
            getRowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/events/${r.id}`)}
          />
        )}
      </div>
    </>
  );
}
