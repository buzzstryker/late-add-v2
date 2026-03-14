import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useGroups } from '@/src/context/GroupContext';
import { usePlayers } from '@/src/context/PlayerContext';
import { getPlayerDisplayName } from '@/src/models/Player';
import { PlayerStats } from '@/src/services/leagueService';

export default function PlayerStatsScreen() {
  const { id, seasonId, playerId } = useLocalSearchParams<{ id: string; seasonId: string; playerId: string }>();
  const router = useRouter();
  const { state: groupState, getPlayerStats } = useGroups();
  const { state: playerState } = usePlayers();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const player = playerState.players.find((p) => p.id === playerId);
  const season = groupState.activeSeason;

  useEffect(() => {
    async function load() {
      if (!playerId) return;
      try {
        const result = await getPlayerStats(playerId);
        setStats(result);
      } catch (err: any) {
        console.warn('Failed to load player stats:', err?.message);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [playerId]);

  function getInitials(): string {
    if (!player) return '??';
    const first = player.firstName?.[0] || '';
    const last = player.lastName?.[0] || '';
    return `${first}${last}`.toUpperCase();
  }

  function formatDollars(amount: number): string {
    if (amount >= 0) return `$${Math.round(amount)}`;
    return `-$${Math.abs(Math.round(amount))}`;
  }

  function formatRoundDate(dateStr: string): string {
    const d = dateStr.split('T')[0];
    const [y, m, day] = d.split('-');
    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    return `${monthNames[parseInt(m)]} ${parseInt(day)}, ${y}`;
  }

  function getSeasonLabel(dateStr: string): string {
    // Extract the year from the round date for the badge
    const d = dateStr.split('T')[0];
    const [y] = d.split('-');
    return y;
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2E7D32" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.headerCard}>
        <View style={styles.headerRow}>
          <View style={styles.initialsCircle}>
            <Text style={styles.initialsText}>{getInitials()}</Text>
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.playerName}>
              {player ? getPlayerDisplayName(player) : 'Unknown'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => router.push(`/player/${playerId}`)}
          >
            <FontAwesome name="pencil" size={14} color="#2E7D32" />
            <Text style={styles.editButtonText}>Edit</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Head-to-Head Button */}
      <TouchableOpacity
        style={styles.h2hButton}
        onPress={() => router.push(`/group/${id}/season/${seasonId}/player/${playerId}/head-to-head`)}
      >
        <FontAwesome name="exchange" size={14} color="#1565C0" />
        <Text style={styles.h2hButtonText}>Head-to-Head</Text>
        <FontAwesome name="chevron-right" size={12} color="#999" />
      </TouchableOpacity>

      {/* Stats Label */}
      <Text style={styles.sectionTitle}>Stats</Text>

      {stats ? (
        <>
          {/* Stats Grid — 2 columns */}
          <View style={styles.statsGrid}>
            {/* Total Rounds Played */}
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Total Rounds Played</Text>
              <Text style={styles.statValueBig}>{stats.seasonRoundsPlayed}</Text>
              <Text style={styles.statValueSmall}>{stats.lifetimeRoundsPlayed} lifetime</Text>
            </View>

            {/* Best Payout */}
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Best Payout</Text>
              <Text style={styles.statValueBig}>{formatDollars(stats.seasonBestPayout)}</Text>
              <Text style={styles.statValueSmall}>{formatDollars(stats.lifetimeBestPayout)} lifetime</Text>
            </View>

            {/* Net Winnings */}
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Net Winnings</Text>
              <Text style={[
                styles.statValueBig,
                stats.seasonNetWinnings > 0 && styles.valuePositive,
                stats.seasonNetWinnings < 0 && styles.valueNegative,
              ]}>
                {formatDollars(stats.seasonNetWinnings)}
              </Text>
              <Text style={styles.statValueSmall}>{formatDollars(stats.lifetimeNetWinnings)} lifetime</Text>
            </View>

            {/* Average Winnings */}
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Average Winnings</Text>
              <Text style={[
                styles.statValueBig,
                stats.seasonAverageWinnings > 0 && styles.valuePositive,
                stats.seasonAverageWinnings < 0 && styles.valueNegative,
              ]}>
                {formatDollars(stats.seasonAverageWinnings)}
              </Text>
              <Text style={styles.statValueSmall}>{formatDollars(stats.lifetimeAverageWinnings)} lifetime</Text>
            </View>
          </View>

          {/* Recent Rounds */}
          {stats.recentRounds.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Recent Rounds</Text>

              {/* Table Header */}
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderText, styles.colSeason]}>SEASON</Text>
                <Text style={[styles.tableHeaderText, styles.colDate]}>DATE</Text>
                <Text style={[styles.tableHeaderText, styles.colNet]}>+ / -</Text>
              </View>

              {/* Rows */}
              {stats.recentRounds.map((round, index) => (
                <View key={index} style={styles.roundRow}>
                  <View style={styles.colSeason}>
                    <View style={styles.seasonBadge}>
                      <Text style={styles.seasonBadgeText}>{getSeasonLabel(round.roundDate)}</Text>
                    </View>
                  </View>
                  <View style={[styles.colDate, styles.dateCell]}>
                    <FontAwesome
                      name={round.net < 0 ? 'chevron-down' : 'chevron-up'}
                      size={10}
                      color={round.net >= 0 ? '#2E7D32' : '#D32F2F'}
                      style={{ marginRight: 6 }}
                    />
                    <Text style={styles.dateText}>{formatRoundDate(round.roundDate)}</Text>
                  </View>
                  <Text style={[
                    styles.colNet,
                    styles.roundNet,
                    round.net > 0 && styles.valuePositive,
                    round.net < 0 && styles.valueNegative,
                  ]}>
                    {formatDollars(round.net)}
                  </Text>
                </View>
              ))}

              {/* Checksum */}
              {(() => {
                const total = stats.recentRounds.reduce((sum, r) => sum + r.net, 0);
                return (
                  <Text style={styles.checksumText}>
                    checksum: {formatDollars(Math.round(total * 100) / 100)}
                  </Text>
                );
              })()}
            </>
          )}
        </>
      ) : (
        <View style={styles.emptyCard}>
          <FontAwesome name="bar-chart" size={36} color="#CCC" />
          <Text style={styles.emptyText}>No stats available</Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  // Header
  headerCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  initialsCircle: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#2E7D32',
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  initialsText: { color: '#FFF', fontSize: 22, fontWeight: '700' },
  headerInfo: { flex: 1 },
  playerName: { fontSize: 20, fontWeight: '700', color: '#1A1A2E' },
  editButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#E8F5E9', borderRadius: 8,
  },
  editButtonText: { fontSize: 14, fontWeight: '600', color: '#2E7D32' },
  // Head-to-Head
  h2hButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#E3F2FD', borderRadius: 10, padding: 14, marginBottom: 16,
  },
  h2hButtonText: { flex: 1, fontSize: 15, fontWeight: '600', color: '#1565C0' },
  // Section
  sectionTitle: { fontSize: 20, fontWeight: '700', color: '#1A1A2E', marginBottom: 12 },
  // Stats Grid
  statsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20,
  },
  statCard: {
    flex: 1, minWidth: '45%', backgroundColor: '#FFF', borderRadius: 10, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  statLabel: { fontSize: 12, fontWeight: '600', color: '#999', marginBottom: 6 },
  statValueBig: { fontSize: 28, fontWeight: '700', color: '#1A1A2E' },
  statValueSmall: { fontSize: 13, color: '#999', marginTop: 2 },
  valuePositive: { color: '#2E7D32' },
  valueNegative: { color: '#D32F2F' },
  // Table
  tableHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingBottom: 8,
  },
  tableHeaderText: { fontSize: 11, fontWeight: '700', color: '#999', letterSpacing: 0.5 },
  colSeason: { width: 60 },
  colDate: { flex: 1 },
  colNet: { width: 60, textAlign: 'right' },
  roundRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF',
    borderRadius: 10, paddingVertical: 12, paddingHorizontal: 10, marginBottom: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 1, elevation: 1,
  },
  seasonBadge: {
    backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
    borderWidth: 1, borderColor: '#A5D6A7',
  },
  seasonBadgeText: { fontSize: 11, fontWeight: '700', color: '#2E7D32' },
  dateCell: { flexDirection: 'row', alignItems: 'center' },
  dateText: { fontSize: 14, color: '#1A1A2E' },
  roundNet: { fontSize: 14, fontWeight: '700', textAlign: 'right' },
  // Empty
  emptyCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 32, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  emptyText: { fontSize: 16, color: '#999', marginTop: 12 },
  checksumText: { fontSize: 11, color: '#BBB', textAlign: 'right', marginTop: 6, paddingRight: 4 },
});
