import React, { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { DataTable } from '../components/DataTable';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { ConfirmToast } from '../components/ConfirmToast';
import { listAttributionQueue, resolveAttribution } from '../api/attribution';
import type { AttributionItem } from '../types';

export function AttributionReview() {
  const [items, setItems] = useState<AttributionItem[]>([]);
  const [selected, setSelected] = useState<AttributionItem | null>(null);
  const [groupId, setGroupId] = useState('');
  const [seasonId, setSeasonId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listAttributionQueue();
      setItems(data);
      if (!data.find((i) => i.id === selected?.id)) setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleResolve = async () => {
    if (!selected || !groupId) return;
    setSaving(true);
    try {
      await resolveAttribution(selected.id, { group_id: groupId, season_id: seasonId || null });
      setToast('Attribution resolved.');
      setSelected(null);
      setGroupId('');
      setSeasonId('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resolve');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const columns = [
    { key: 'event_id', label: 'Event', render: (r: AttributionItem) => r.event_id?.slice(0, 8) ?? r.id.slice(0, 8) },
    { key: 'source_app', label: 'Source app', render: (r: AttributionItem) => r.source_app ?? '—' },
    { key: 'round_date', label: 'Played date' },
    { key: 'status', label: 'Status' },
  ];

  return (
    <>
      <PageHeader title="Attribution review" subtitle="Resolve events that need group/season assignment" />
      {toast && <ConfirmToast message={toast} onClose={() => setToast(null)} />}
      <div className="card">
        {items.length === 0 ? (
          <EmptyState message="No unresolved attribution items." />
        ) : (
          <>
            <DataTable
              columns={columns}
              data={items}
              getRowKey={(r) => r.id}
              onRowClick={(r) => { setSelected(r); setGroupId(r.candidate_groups?.[0]?.id ?? ''); setSeasonId(r.candidate_seasons?.[0]?.id ?? ''); }}
            />
            {selected && (
              <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid #eee' }}>
                <h3>Resolve: {selected.event_id?.slice(0, 8)}</h3>
                <p>Source app: {selected.source_app ?? '—'} · Date: {selected.round_date}</p>
                {selected.results?.length ? (
                  <p>Players: {selected.results.length} result(s)</p>
                ) : null}
                <div className="form-section">
                  <label>Group ID (required)</label>
                  <input value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="Group UUID" />
                </div>
                <div className="form-section">
                  <label>Season ID (optional)</label>
                  <input value={seasonId} onChange={(e) => setSeasonId(e.target.value)} placeholder="Season UUID" />
                </div>
                <div className="form-actions">
                  <button type="button" className="btn btn-primary" onClick={handleResolve} disabled={saving || !groupId}>
                    {saving ? 'Saving…' : 'Submit resolution'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => { setSelected(null); setGroupId(''); setSeasonId(''); }}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
