import React, { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { DataTable } from '../components/DataTable';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { getStandings } from '../api/standings';
import { listGroups, listSeasons } from '../api/groups';
import type { StandingRow, Group, Season } from '../types';

export function Standings() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [groupId, setGroupId] = useState('');
  const [seasonId, setSeasonId] = useState('');
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [standingsLoading, setStandingsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listGroups()
      .then(setGroups)
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!groupId) {
      setSeasons([]);
      setSeasonId('');
      return;
    }
    listSeasons(groupId)
      .then(setSeasons)
      .catch(() => setSeasons([]));
  }, [groupId]);

  useEffect(() => {
    if (!seasonId) {
      setStandings([]);
      return;
    }
    setStandingsLoading(true);
    getStandings(seasonId, groupId || undefined)
      .then(setStandings)
      .catch(() => setStandings([]))
      .finally(() => setStandingsLoading(false));
  }, [seasonId, groupId]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  const columns = [
    { key: 'rank', label: 'Rank', render: (r: StandingRow) => r.rank ?? '—' },
    { key: 'player_name', label: 'Player', render: (r: StandingRow) => r.player_name ?? r.player_id?.slice(0, 8) ?? '—' },
    { key: 'rounds_played', label: 'Rounds played' },
    { key: 'total_points', label: 'Total points' },
  ];

  return (
    <>
      <PageHeader title="Standings" subtitle="Points-only; derived from backend" />
      <div className="card">
        <h2>Select group and season</h2>
        <div className="filter-bar">
          <label>
            Group
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">—</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>
          <label>
            Season
            <select value={seasonId} onChange={(e) => setSeasonId(e.target.value)} disabled={!groupId}>
              <option value="">—</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>{s.name || `${s.start_date} – ${s.end_date}`}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="card">
        <h2>Standings</h2>
        {!seasonId ? (
          <EmptyState message="Select a group and season to view standings." />
        ) : standingsLoading ? (
          <LoadingSpinner />
        ) : standings.length === 0 ? (
          <EmptyState message="No standings for this season yet." />
        ) : (
          <DataTable columns={columns} data={standings} getRowKey={(r) => r.player_id} />
        )}
      </div>
    </>
  );
}
