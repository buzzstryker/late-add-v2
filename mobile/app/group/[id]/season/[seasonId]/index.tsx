import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useGroups } from '@/src/context/GroupContext';
import { usePlayers } from '@/src/context/PlayerContext';
import { getPlayerDisplayName } from '@/src/models/Player';
import { LeagueScore, getEffectiveLeagueScore } from '@/src/models/League';

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

type TabName = 'standings' | 'rounds';

export default function SeasonStandingsScreen() {
  const { id, seasonId } = useLocalSearchParams<{ id: string; seasonId: string }>();
  const router = useRouter();
  const { state: groupState, loadSeasonData, getQuickPayoutForRound } = useGroups();
  const { state: playerState } = usePlayers();
  const [activeTab, setActiveTab] = useState<TabName>('standings');
  const [expandedRoundId, setExpandedRoundId] = useState<string | null>(null);

  useEffect(() => {
    if (seasonId) loadSeasonData(seasonId);
  }, [seasonId]);

  const season = groupState.activeSeason;
  const standings = groupState.seasonStandings;
  const rounds = groupState.seasonLeagueRounds;
  const scores = groupState.seasonScores;
  const netPositions = groupState.seasonNetPositions;

  // Group scores by round for the Rounds tab
  const scoresByRound = useMemo(() => {
    const map = new Map<string, LeagueScore[]>();
    for (const score of scores) {
      const existing = map.get(score.leagueRoundId) ?? [];
      existing.push(score);
      map.set(score.leagueRoundId, existing);
    }
    return map;
  }, [scores]);

  // Sorted standings by net position (descending)
  // NOTE: All hooks must be above the early return to avoid "rendered more hooks" error
  const standingsByNet = useMemo(() => {
    return [...standings].sort((a, b) => {
      const aNet = netPositions.get(a.playerId) ?? 0;
      const bNet = netPositions.get(b.playerId) ?? 0;
      return bNet - aNet;
    });
  }, [standings, netPositions]);

  if (!season) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  function formatDate(dateStr: string): string {
    const d = dateStr.split('T')[0];
    const [y, m] = d.split('-');
    return `${MONTH_NAMES[parseInt(m)]} ${y}`;
  }

  function formatRoundDate(dateStr: string): string {
    const d = dateStr.split('T')[0];
    const [y, m, day] = d.split('-');
    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    return `${monthNames[parseInt(m)]} ${parseInt(day)}, ${y}`;
  }

  function getShortName(playerId: string): string {
    const player = playerState.players.find((p) => p.id === playerId);
    if (!player) return '?';
    if (player.nickname) return player.nickname;
    return player.firstName;
  }

  function formatDollars(amount: number): string {
    if (amount >= 0) return `$${amount}`;
    return `-$${Math.abs(amount)}`;
  }

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.headerCard}>
        <Text style={styles.seasonRange}>
          {formatDate(season.startDate)} — {formatDate(season.endDate)}
        </Text>
        <Text style={styles.roundCount}>
          {rounds.length} round{rounds.length !== 1 ? 's' : ''} played
        </Text>
      </View>

      {/* Tab Switcher */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'standings' && styles.tabActive]}
          onPress={() => setActiveTab('standings')}
        >
          <FontAwesome name="trophy" size={14} color={activeTab === 'standings' ? '#2E7D32' : '#999'} />
          <Text style={[styles.tabText, activeTab === 'standings' && styles.tabTextActive]}>
            Standings
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'rounds' && styles.tabActive]}
          onPress={() => setActiveTab('rounds')}
        >
          <FontAwesome name="flag" size={14} color={activeTab === 'rounds' ? '#2E7D32' : '#999'} />
          <Text style={[styles.tabText, activeTab === 'rounds' && styles.tabTextActive]}>
            Rounds
          </Text>
        </TouchableOpacity>
      </View>

      {/* ═══ Standings Tab ═══ */}
      {activeTab === 'standings' && (
        <>
          {standings.length === 0 ? (
            <View style={styles.emptyCard}>
              <FontAwesome name="bar-chart" size={36} color="#CCC" />
              <Text style={styles.emptyText}>No scores recorded yet</Text>
            </View>
          ) : (
            <>
              {/* Table Header */}
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderText, styles.colPlayer]}>PLAYER</Text>
                <Text style={[styles.tableHeaderText, styles.colRounds]}>ROUNDS</Text>
                <Text style={[styles.tableHeaderText, styles.colNet]}>+ / -</Text>
              </View>

              {/* Standings Rows */}
              {standingsByNet.map((standing, index) => {
                const net = netPositions.get(standing.playerId) ?? 0;
                const rank = index + 1;

                return (
                  <TouchableOpacity
                    key={standing.playerId}
                    style={styles.standingRow}
                    activeOpacity={0.7}
                    onPress={() => router.push(`/group/${id}/season/${seasonId}/player/${standing.playerId}`)}
                  >
                    {/* Trophy / Rank */}
                    {rank <= 3 ? (
                      <FontAwesome
                        name="trophy"
                        size={16}
                        color={rank === 1 ? '#DAA520' : rank === 2 ? '#A0A0A0' : '#CD7F32'}
                        style={styles.trophyIcon}
                      />
                    ) : (
                      <Text style={styles.rankNumber}>{rank}</Text>
                    )}

                    {/* Player Name */}
                    <Text style={[styles.colPlayer, styles.playerName]} numberOfLines={1}>
                      {getShortName(standing.playerId)}
                    </Text>

                    {/* Rounds */}
                    <Text style={[styles.colRounds, styles.roundsText]}>
                      {standing.roundsPlayed}
                    </Text>

                    {/* Net $ */}
                    <Text style={[
                      styles.colNet,
                      styles.netText,
                      net > 0 && styles.netPositive,
                      net < 0 && styles.netNegative,
                    ]}>
                      {formatDollars(net)}
                    </Text>

                    <FontAwesome name="chevron-right" size={12} color="#CCC" style={{ marginLeft: 8 }} />
                  </TouchableOpacity>
                );
              })}

              {/* Checksum */}
              {(() => {
                const total = standingsByNet.reduce((sum, s) => sum + (netPositions.get(s.playerId) ?? 0), 0);
                return (
                  <Text style={styles.checksumText}>
                    checksum: {formatDollars(Math.round(total * 100) / 100)}
                  </Text>
                );
              })()}
            </>
          )}
        </>
      )}

      {/* ═══ Rounds Tab ═══ */}
      {activeTab === 'rounds' && (
        <>
          {rounds.length === 0 ? (
            <View style={styles.emptyCard}>
              <FontAwesome name="flag" size={36} color="#CCC" />
              <Text style={styles.emptyText}>No rounds recorded yet</Text>
            </View>
          ) : (
            rounds
              .sort((a, b) => b.roundDate.localeCompare(a.roundDate))
              .map((round) => {
                const roundScores = scoresByRound.get(round.id) ?? [];
                const isExpanded = expandedRoundId === round.id;

                // Sort scores by effective score descending
                const sortedScores = [...roundScores].sort((a, b) => {
                  const aVal = getEffectiveLeagueScore(a) ?? 0;
                  const bVal = getEffectiveLeagueScore(b) ?? 0;
                  return bVal - aVal;
                });

                // Get quick payout entries and round nets via context
                const payoutEntries = getQuickPayoutForRound(roundScores, round.scoresOverride);

                // Compute net for chip display (reuse quick payout data)
                // We need per-player nets for the chips — compute from scores
                const chipNets = new Map<string, number>();
                for (const score of roundScores) {
                  const effective = getEffectiveLeagueScore(score);
                  if (effective !== null) {
                    chipNets.set(score.playerId, effective);
                  }
                }
                // For override rounds, effective score IS the net
                // For non-override rounds, need round-robin — but we can derive from payout entries
                // Simpler: just use effective scores for chip coloring (positive = green, negative = red)

                return (
                  <TouchableOpacity
                    key={round.id}
                    style={styles.roundCard}
                    onPress={() => setExpandedRoundId(isExpanded ? null : round.id)}
                    activeOpacity={0.7}
                  >
                    {/* Round Date */}
                    <View style={styles.roundHeader}>
                      <FontAwesome
                        name={round.scoresOverride ? 'pencil' : 'flag'}
                        size={12}
                        color={round.scoresOverride ? '#F57C00' : '#2E7D32'}
                        style={{ marginRight: 6 }}
                      />
                      <Text style={styles.roundDateText}>{formatRoundDate(round.roundDate)}</Text>
                      <FontAwesome
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={12}
                        color="#999"
                        style={{ marginLeft: 'auto' }}
                      />
                    </View>

                    {/* Score Chips */}
                    <View style={styles.chipRow}>
                      {sortedScores.map((score) => {
                        const net = chipNets.get(score.playerId) ?? 0;
                        return (
                          <View
                            key={score.id}
                            style={[
                              styles.scoreChip,
                              net > 0 && styles.scoreChipPositive,
                              net < 0 && styles.scoreChipNegative,
                              net === 0 && styles.scoreChipNeutral,
                            ]}
                          >
                            <Text style={[
                              styles.scoreChipText,
                              net > 0 && styles.scoreChipTextPositive,
                              net < 0 && styles.scoreChipTextNegative,
                            ]}>
                              {getShortName(score.playerId)} {net >= 0 ? '+' : ''}{net}
                            </Text>
                          </View>
                        );
                      })}
                    </View>

                    {/* Expanded: Quick Payout + Settle Up */}
                    {isExpanded && roundScores.length >= 2 && (
                      <View style={styles.quickPayout}>
                        <Text style={styles.quickPayoutTitle}>Quick Payout</Text>
                        {payoutEntries.length === 0 ? (
                          <Text style={styles.evenText}>Everyone is even</Text>
                        ) : (
                          <>
                            {payoutEntries.map((entry, i) => (
                              <View key={i} style={styles.payoutRow}>
                                <Text style={styles.payoutText}>
                                  {getShortName(entry.fromPlayerId)} pays {getShortName(entry.toPlayerId)}
                                </Text>
                                <Text style={styles.payoutAmount}>${entry.amount}</Text>
                              </View>
                            ))}
                            <TouchableOpacity
                              style={styles.settleUpButton}
                              onPress={() => router.push(`/group/${id}/season/${seasonId}/round/${round.id}/settlement`)}
                            >
                              <FontAwesome name="money" size={14} color="#FFF" />
                              <Text style={styles.settleUpButtonText}>Settle Up</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })
          )}
        </>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5', padding: 16 },
  loadingText: { fontSize: 16, color: '#999', textAlign: 'center', marginTop: 40 },
  headerCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  seasonRange: { fontSize: 18, fontWeight: '700', color: '#1A1A2E' },
  roundCount: { fontSize: 13, color: '#666', marginTop: 4 },
  // Tabs
  tabBar: {
    flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 10, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, gap: 6, borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: '#2E7D32' },
  tabText: { fontSize: 15, fontWeight: '500', color: '#999' },
  tabTextActive: { color: '#2E7D32', fontWeight: '600' },
  // Empty
  emptyCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 32, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  emptyText: { fontSize: 16, color: '#999', marginTop: 12 },
  // Standings Table
  tableHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8,
    marginBottom: 4,
  },
  tableHeaderText: { fontSize: 11, fontWeight: '700', color: '#999', letterSpacing: 0.5 },
  colPlayer: { flex: 1 },
  colRounds: { width: 56, textAlign: 'center' },
  colNet: { width: 64, textAlign: 'right' },
  standingRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF',
    borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, marginBottom: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 1, elevation: 1,
  },
  trophyIcon: { width: 28, textAlign: 'center' },
  rankNumber: { width: 28, textAlign: 'center', fontSize: 14, fontWeight: '600', color: '#999' },
  playerName: { fontSize: 15, fontWeight: '500', color: '#1A1A2E', marginLeft: 4 },
  roundsText: { fontSize: 14, color: '#666', textAlign: 'center' },
  netText: { fontSize: 16, fontWeight: '700', textAlign: 'right' },
  netPositive: { color: '#2E7D32' },
  netNegative: { color: '#D32F2F' },
  // Rounds Tab
  roundCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  roundHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  roundDateText: { fontSize: 14, fontWeight: '600', color: '#1A1A2E' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  scoreChip: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
    borderWidth: 1,
  },
  scoreChipPositive: { backgroundColor: '#F1F8E9', borderColor: '#C5E1A5' },
  scoreChipNegative: { backgroundColor: '#FFEBEE', borderColor: '#EF9A9A' },
  scoreChipNeutral: { backgroundColor: '#F5F5F5', borderColor: '#E0E0E0' },
  scoreChipText: { fontSize: 12, fontWeight: '600', color: '#666' },
  scoreChipTextPositive: { color: '#33691E' },
  scoreChipTextNegative: { color: '#C62828' },
  // Quick Payout
  quickPayout: {
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F0F0F0',
  },
  quickPayoutTitle: {
    fontSize: 12, fontWeight: '700', color: '#2E7D32', marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  evenText: { fontSize: 13, color: '#999', fontStyle: 'italic' },
  payoutRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 3,
  },
  payoutText: { fontSize: 13, color: '#1A1A2E' },
  payoutAmount: { fontSize: 13, fontWeight: '700', color: '#1A1A2E' },
  // Settle Up Button
  settleUpButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#1565C0', paddingVertical: 10, borderRadius: 8, marginTop: 10,
  },
  settleUpButtonText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  checksumText: { fontSize: 11, color: '#BBB', textAlign: 'right', marginTop: 6, paddingRight: 4 },
});
