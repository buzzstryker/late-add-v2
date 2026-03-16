import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorState } from '../components/ErrorState';
import { getEvent } from '../api/events';
import type { EventDetail as EventDetailType } from '../types';

export function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    getEvent(eventId)
      .then(setEvent)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load event'))
      .finally(() => setLoading(false));
  }, [eventId]);

  if (!eventId) return <ErrorState message="Missing event ID" />;
  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  if (!event) return <EmptyState message="Event not found." />;

  return (
    <>
      <PageHeader
        title={`Event ${event.id.slice(0, 8)}`}
        subtitle={`${event.round_date} · ${event.source_app ?? '—'}`}
        action={
          <>
            <Link to={`/events/${eventId}/edit`} className="btn btn-primary" style={{ marginRight: 8 }}>Edit / override</Link>
            <Link to="/events" className="btn btn-secondary">Back to list</Link>
          </>
        }
      />
      <div className="card">
        <h2>Source &amp; status</h2>
        <p><strong>External event ID</strong>: {event.external_event_id ?? '—'}</p>
        <p><strong>Source app</strong>: {event.source_app ?? '—'}</p>
        <p><strong>Status</strong>: <StatusBadge status={event.status} /></p>
        <p><strong>Attribution</strong>: {event.attribution_status ?? '—'}</p>
        {event.validation_errors?.length ? (
          <p><strong>Validation errors</strong>: {event.validation_errors.join('; ')}</p>
        ) : null}
        {event.mapping_issues?.length ? (
          <p><strong>Mapping issues</strong>: {event.mapping_issues.join('; ')}</p>
        ) : null}
      </div>
      {event.results && event.results.length > 0 && (
        <div className="card">
          <h2>Results</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Player</th><th>Score / points</th><th>Override</th><th>Result type</th></tr>
              </thead>
              <tbody>
                {event.results.map((r) => (
                  <tr key={r.player_id}>
                    <td>{r.player_name ?? r.player_id.slice(0, 8)}</td>
                    <td>{r.score_value}</td>
                    <td>{r.score_override ?? '—'}</td>
                    <td>{r.result_type ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="card">
        <h2>Actions</h2>
        <p>
          <Link to="/review/attribution">Attribution review</Link>
          {' · '}
          <Link to="/review/player-mapping">Player mapping</Link>
          {' · '}
          <Link to={`/events/${eventId}/edit`}>Edit / override</Link>
        </p>
      </div>
    </>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="empty-state"><p>{message}</p></div>;
}
