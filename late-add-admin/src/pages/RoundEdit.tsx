import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { FormSection } from '../components/FormSection';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorState } from '../components/ErrorState';
import { ConfirmToast } from '../components/ConfirmToast';
import { getEvent, updateEvent } from '../api/events';
import type { EventDetail as EventDetailType, EventResult } from '../types';

export function RoundEdit() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventDetailType | null>(null);
  const [roundDate, setRoundDate] = useState('');
  const [seasonId, setSeasonId] = useState('');
  const [results, setResults] = useState<EventResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    getEvent(eventId)
      .then((e) => {
        setEvent(e);
        setRoundDate(e.round_date ?? '');
        setSeasonId(e.season_id ?? '');
        setResults(e.results ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load event'))
      .finally(() => setLoading(false));
  }, [eventId]);

  const updateResult = (i: number, field: 'score_value' | 'score_override', value: number) => {
    setResults((r) => r.map((row, j) => (j === i ? { ...row, [field]: value } : row)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !event) return;
    setSaving(true);
    setError(null);
    try {
      await updateEvent(eventId, {
        round_date: roundDate,
        season_id: seasonId || null,
        results: results.map((r) => ({
          player_id: r.player_id,
          score_value: r.score_value,
          score_override: r.score_override ?? null,
        })),
      });
      setToast('Round updated.');
      navigate(`/events/${eventId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update round');
    } finally {
      setSaving(false);
    }
  };

  if (!eventId) return <ErrorState message="Missing event ID" />;
  if (loading) return <LoadingSpinner />;
  if (error && !event) return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  if (!event) return null;

  return (
    <>
      <PageHeader title="Edit / override round" subtitle={`Event ${eventId.slice(0, 8)}`} />
      {toast && <ConfirmToast message={toast} onClose={() => setToast(null)} />}
      <div className="card">
        <form onSubmit={handleSubmit}>
          <FormSection title="Event metadata">
            <label>Played date</label>
            <input type="date" value={roundDate} onChange={(e) => setRoundDate(e.target.value)} />
            <label style={{ marginTop: 12 }}>Season ID (optional)</label>
            <input value={seasonId} onChange={(e) => setSeasonId(e.target.value)} placeholder="UUID" />
          </FormSection>
          <FormSection title="Results (override only when needed)">
            <p style={{ fontSize: 12, color: '#666' }}>Backend will recalculate standings after save.</p>
            {results.map((row, i) => (
              <div key={row.player_id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <span style={{ minWidth: 120 }}>{row.player_name ?? row.player_id.slice(0, 8)}</span>
                <input
                  type="number"
                  value={row.score_value}
                  onChange={(e) => updateResult(i, 'score_value', Number(e.target.value))}
                  style={{ width: 80 }}
                />
                <input
                  type="number"
                  placeholder="Override"
                  value={row.score_override ?? ''}
                  onChange={(e) => updateResult(i, 'score_override', e.target.value === '' ? 0 : Number(e.target.value))}
                  style={{ width: 80 }}
                />
              </div>
            ))}
          </FormSection>
          {error && <p style={{ color: '#c62828', marginBottom: 12 }}>{error}</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <Link to={`/events/${eventId}`} className="btn btn-secondary">Cancel</Link>
          </div>
        </form>
      </div>
    </>
  );
}
