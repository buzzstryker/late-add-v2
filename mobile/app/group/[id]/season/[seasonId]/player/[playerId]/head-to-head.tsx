import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useGroups } from '@/src/context/GroupContext';
import { usePlayers } from '@/src/context/PlayerContext';
import { getPlayerDisplayName } from '@/src/models/Player';

export default function HeadToHeadScreen() {
  const { id, seasonId, playerId } = useLocalSearchParams<{ id: string; seasonId: string; playerId: string }>();
  const { state: groupState, getHeadToHead } = useGroups();
  const { state: playerState } = usePlayers();

  const player = playerState.players.find((p) => p.id === playerId);
  const entries = useMemo(() => getHeadToHead(playerId!), [playerId, getHeadToHead]);

  function getPlayerName(pid: string): string {
    const p = playerState.players.find((pl) => pl.id === pid);
    return p ? getPlayerDisplayName(p) : 'Unknown';
  }

  function getShortName(pid: string): string {
    const p = playerState.players.find((pl) => pl.id === pid);
    if (!p) return '?';
    if (p.nickname) return p.nickname;
    return p.firstName;
  }

  function getInitials(pid: string): string {
    const p = playerState.players.find((pl) => pl.id === pid);
    if (!p) return '??';
    const first = p.firstName?.[0] || '';
    const last = p.lastName?.[0] || '';
    return `${first}${last}`.toUpperCase();
  }

  function formatDollars(amount: number): string {
    if (amount >= 0) return `$${Math.round(amount)}`;
    return `-$${Math.abs(Math.round(amount))}`;
  }

  const playerName = player ? getPlayerDisplayName(player) : 'Unknown';

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.headerCard}>
        <FontAwesome name="exchange" size={20} color="#FFF" style={{ marginBottom: 6 }} />
        <Text style={styles.headerTitle}>Head-to-Head</Text>
        <Text style={styles.headerSubtitle}>
          {playerName}'s net outcomes vs opponents this season
        </Text>
      </View>

      {entries.length > 0 ? (
        <>
          {/* Table Header */}
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, styles.colPlayer]}>OPPONENT</Text>
            <Text style={[styles.tableHeaderText, styles.colRounds]}>ROUNDS</Text>
            <Text style={[styles.tableHeaderText, styles.colNet]}>NET</Text>
          </View>

          {/* Rows */}
          {entries.map((entry) => (
            <View key={entry.opponentId} style={styles.row}>
              <View style={[styles.colPlayer, styles.playerCell]}>
                <View style={[
                  styles.avatarCircle,
                  entry.totalNet > 0 && styles.avatarPositive,
                  entry.totalNet < 0 && styles.avatarNegative,
                  entry.totalNet === 0 && styles.avatarNeutral,
                ]}>
                  <Text style={styles.avatarText}>{getInitials(entry.opponentId)}</Text>
                </View>
                <View style={styles.nameColumn}>
                  <Text style={styles.opponentName} numberOfLines={1}>
                    {getShortName(entry.opponentId)}
                  </Text>
                </View>
              </View>
              <Text style={[styles.colRounds, styles.roundsText]}>
                {entry.roundsTogether}
              </Text>
              <Text style={[
                styles.colNet,
                styles.netText,
                entry.totalNet > 0 && styles.valuePositive,
                entry.totalNet < 0 && styles.valueNegative,
              ]}>
                {entry.totalNet > 0 ? '+' : ''}{formatDollars(entry.totalNet)}
              </Text>
            </View>
          ))}

          {/* Checksum */}
          {(() => {
            const total = entries.reduce((sum, e) => sum + e.totalNet, 0);
            return (
              <Text style={styles.checksumText}>
                checksum: {total > 0 ? '+' : ''}{formatDollars(Math.round(total * 100) / 100)}
              </Text>
            );
          })()}

          {/* Summary */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>
              {entries.length} opponent{entries.length !== 1 ? 's' : ''} this season
            </Text>
          </View>
        </>
      ) : (
        <View style={styles.emptyCard}>
          <FontAwesome name="users" size={36} color="#CCC" />
          <Text style={styles.emptyText}>No head-to-head data</Text>
          <Text style={styles.emptySubtext}>
            Play rounds with other members to see matchup results
          </Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5', padding: 16 },
  // Header
  headerCard: {
    backgroundColor: '#1565C0', borderRadius: 10, padding: 16, marginBottom: 16,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  headerSubtitle: { fontSize: 13, color: '#BBDEFB', marginTop: 4 },
  // Table header
  tableHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingBottom: 8,
  },
  tableHeaderText: { fontSize: 11, fontWeight: '700', color: '#999', letterSpacing: 0.5 },
  colPlayer: { flex: 1 },
  colRounds: { width: 60, textAlign: 'center' },
  colNet: { width: 80, textAlign: 'right' },
  // Row
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF',
    borderRadius: 10, paddingVertical: 12, paddingHorizontal: 10, marginBottom: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 1, elevation: 1,
  },
  playerCell: { flexDirection: 'row', alignItems: 'center' },
  avatarCircle: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  avatarPositive: { backgroundColor: '#E8F5E9' },
  avatarNegative: { backgroundColor: '#FFEBEE' },
  avatarNeutral: { backgroundColor: '#F5F5F5' },
  avatarText: { fontSize: 12, fontWeight: '700', color: '#1A1A2E' },
  nameColumn: { flex: 1 },
  opponentName: { fontSize: 15, fontWeight: '500', color: '#1A1A2E' },
  roundsText: { fontSize: 14, color: '#999', textAlign: 'center' },
  netText: { fontSize: 16, fontWeight: '700', textAlign: 'right' },
  valuePositive: { color: '#2E7D32' },
  valueNegative: { color: '#D32F2F' },
  // Summary
  summaryCard: {
    alignItems: 'center', paddingVertical: 12, marginTop: 8,
  },
  summaryLabel: { fontSize: 13, color: '#999' },
  // Empty
  emptyCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 32, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  emptyText: { fontSize: 16, color: '#999', marginTop: 12 },
  emptySubtext: { fontSize: 13, color: '#CCC', marginTop: 4, textAlign: 'center' },
  checksumText: { fontSize: 11, color: '#BBB', textAlign: 'right', marginTop: 6, paddingRight: 4 },
});
