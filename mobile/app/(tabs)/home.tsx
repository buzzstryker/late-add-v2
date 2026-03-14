import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView,
  Alert, InteractionManager,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useApp } from '@/src/context/AppContext';
import { usePlayers } from '@/src/context/PlayerContext';
import { useRound } from '@/src/context/RoundContext';
import { useGroups } from '@/src/context/GroupContext';
import { useSync } from '@/src/context/SyncContext';
import type { Group } from '@/src/models/League';

export default function HomeScreen() {
  const router = useRouter();
  const { state: appState } = useApp();
  const { ownerPlayerId } = usePlayers();
  const { state: roundState, loadRecentRounds, loadActiveRounds } = useRound();
  const {
    state: groupState,
    loadHomeGroupStandings,
    setHomeGroup,
    getPlayerGroups,
  } = useGroups();
  const { state: syncState } = useSync();

  const [playerGroups, setPlayerGroups] = useState<Group[]>([]);
  const [showGroupPicker, setShowGroupPicker] = useState(false);

  // Defer heavy DB work until after tab navigation animations finish,
  // so tab presses aren't blocked on initial load.
  useEffect(() => {
    if (appState.isDbReady) {
      const task = InteractionManager.runAfterInteractions(() => {
        loadActiveRounds();
        loadHomeGroupStandings();
      });
      return () => task.cancel();
    }
  }, [appState.isDbReady]);

  // Load the player's groups for the group picker
  useEffect(() => {
    if (appState.isDbReady && ownerPlayerId) {
      InteractionManager.runAfterInteractions(() => {
        getPlayerGroups(ownerPlayerId).then(setPlayerGroups);
      });
    }
  }, [appState.isDbReady, ownerPlayerId]);

  // Reload after sync pulls new data
  useEffect(() => {
    if (syncState.lastPullCompletedAt > 0 && appState.isDbReady) {
      loadActiveRounds();
      loadHomeGroupStandings();
      if (ownerPlayerId) {
        getPlayerGroups(ownerPlayerId).then(setPlayerGroups);
      }
    }
  }, [syncState.lastPullCompletedAt]);

  // Refresh on focus
  useFocusEffect(
    useCallback(() => {
      if (appState.isDbReady) {
        loadActiveRounds();
        loadHomeGroupStandings();
      }
    }, [appState.isDbReady]),
  );

  async function handleChangeGroup(groupId: string) {
    setShowGroupPicker(false);
    await setHomeGroup(groupId);
  }

  if (!appState.isDbReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2E7D32" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const standings = groupState.homeGroupStandings;

  // Build sorted standings entries
  const sortedStandings = standings
    ? [...standings.netPositions.entries()]
        .sort(([, a], [, b]) => b - a)
    : [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.title}>Scorecard</Text>
      <Text style={styles.subtitle}>Golf Score Tracker</Text>

      {/* Quick Actions */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.push('/round/setup')}
        >
          <FontAwesome name="plus" size={20} color="#FFF" />
          <Text style={styles.primaryButtonText}>New Round</Text>
        </TouchableOpacity>
      </View>

      {/* Active Rounds */}
      {roundState.activeRounds.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Active Rounds</Text>
          {roundState.activeRounds.map((round) => (
            <TouchableOpacity
              key={round.id}
              style={[styles.roundCard, styles.activeCard]}
              onPress={() => router.push(`/round/${round.id}`)}
            >
              <View style={styles.roundCardContent}>
                <Text style={styles.roundCourseName}>{round.courseName || 'Unknown Course'}</Text>
                <Text style={styles.roundInfo}>
                  Hole {round.currentHole} - {round.players.length} player{round.players.length !== 1 ? 's' : ''}
                </Text>
              </View>
              <FontAwesome name="chevron-right" size={16} color="#2E7D32" />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Season Standings */}
      <View style={styles.section}>
        {standings ? (
          <>
            <TouchableOpacity
              style={styles.standingsHeader}
              onPress={() =>
                router.push(`/group/${standings.group.id}/season/${standings.season.id}`)
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>{standings.group.name}</Text>
                <Text style={styles.seasonRange}>
                  {standings.season.startDate.split('T')[0]} — {standings.season.endDate.split('T')[0]}
                </Text>
              </View>
              {playerGroups.length > 1 && (
                <TouchableOpacity
                  style={styles.changeGroupButton}
                  onPress={() => setShowGroupPicker(!showGroupPicker)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <FontAwesome name="exchange" size={14} color="#666" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>

            {/* Group picker */}
            {showGroupPicker && (
              <View style={styles.groupPicker}>
                {playerGroups.map((g) => (
                  <TouchableOpacity
                    key={g.id}
                    style={[
                      styles.groupPickerItem,
                      g.id === groupState.homeGroupId && styles.groupPickerItemActive,
                    ]}
                    onPress={() => handleChangeGroup(g.id)}
                  >
                    <Text
                      style={[
                        styles.groupPickerText,
                        g.id === groupState.homeGroupId && styles.groupPickerTextActive,
                      ]}
                    >
                      {g.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {sortedStandings.length > 0 ? (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() =>
                  router.push(`/group/${standings.group.id}/season/${standings.season.id}`)
                }
              >
                {sortedStandings.map(([playerId, net], idx) => {
                  const rank = idx + 1;
                  const name = standings.playerNames.get(playerId) || 'Unknown';
                  const isOwner = playerId === ownerPlayerId;
                  const rounds = standings.roundCounts?.get(playerId) ?? 0;
                  return (
                    <View
                      key={playerId}
                      style={[styles.standingRow, isOwner && styles.standingRowHighlight]}
                    >
                      <View style={styles.rankContainer}>
                        {rank === 1 ? (
                          <FontAwesome name="trophy" size={16} color="#FFD700" />
                        ) : rank === 2 ? (
                          <FontAwesome name="trophy" size={16} color="#C0C0C0" />
                        ) : rank === 3 ? (
                          <FontAwesome name="trophy" size={16} color="#CD7F32" />
                        ) : (
                          <Text style={styles.rankText}>{rank}</Text>
                        )}
                      </View>
                      <Text
                        style={[styles.standingName, isOwner && styles.standingNameBold]}
                        numberOfLines={1}
                      >
                        {name}
                      </Text>
                      <Text style={styles.standingRounds}>{rounds}</Text>
                      <Text
                        style={[
                          styles.standingNet,
                          net > 0 && styles.netPositive,
                          net < 0 && styles.netNegative,
                        ]}
                      >
                        {net > 0 ? '+' : ''}{net.toFixed(2)}
                      </Text>
                    </View>
                  );
                })}
                {/* Checksum */}
                {(() => {
                  const total = sortedStandings.reduce((sum, [, n]) => sum + n, 0);
                  return (
                    <Text style={styles.checksumText}>
                      checksum: {total > 0 ? '+' : ''}{total.toFixed(2)}
                    </Text>
                  );
                })()}
              </TouchableOpacity>
            ) : (
              <View style={styles.emptyState}>
                <FontAwesome name="trophy" size={36} color="#CCC" />
                <Text style={styles.emptyText}>No standings yet</Text>
                <Text style={styles.emptySubtext}>
                  Complete rounds and submit to your group to see standings
                </Text>
              </View>
            )}
          </>
        ) : groupState.homeGroupId === null && playerGroups.length > 0 ? (
          // Has groups but no home group set
          <View style={styles.emptyState}>
            <FontAwesome name="trophy" size={36} color="#CCC" />
            <Text style={styles.emptyText}>Select your home group</Text>
            <View style={styles.groupPicker}>
              {playerGroups.map((g) => (
                <TouchableOpacity
                  key={g.id}
                  style={styles.groupPickerItem}
                  onPress={() => handleChangeGroup(g.id)}
                >
                  <Text style={styles.groupPickerText}>{g.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          // No groups at all
          <View style={styles.emptyState}>
            <FontAwesome name="trophy" size={36} color="#CCC" />
            <Text style={styles.emptyText}>Season Standings</Text>
            {syncState.isSyncing ? (
              <>
                <ActivityIndicator size="small" color="#2E7D32" style={{ marginTop: 8 }} />
                <Text style={styles.emptySubtext}>Syncing data...</Text>
              </>
            ) : (
              <Text style={styles.emptySubtext}>
                Go to the Groups tab to get started
              </Text>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  contentContainer: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16, color: '#666' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1A1A2E', marginTop: 8 },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 20 },
  actionRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  primaryButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#2E7D32', paddingVertical: 14, borderRadius: 12,
  },
  primaryButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1A1A2E', marginBottom: 2 },
  // Active round cards
  roundCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2,
    elevation: 1, marginBottom: 8,
  },
  activeCard: { borderLeftWidth: 4, borderLeftColor: '#2E7D32' },
  roundCardContent: { flex: 1 },
  roundCourseName: { fontSize: 16, fontWeight: '600', color: '#1A1A2E' },
  roundInfo: { fontSize: 13, color: '#666', marginTop: 2 },
  // Standings header
  standingsHeader: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 10,
  },
  seasonRange: { fontSize: 12, color: '#888', marginTop: 2 },
  changeGroupButton: {
    padding: 8, borderRadius: 8, backgroundColor: '#F0F0F0',
  },
  // Group picker
  groupPicker: { marginBottom: 12, gap: 6 },
  groupPickerItem: {
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8,
    backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E0E0E0',
  },
  groupPickerItemActive: {
    borderColor: '#2E7D32', backgroundColor: '#E8F5E9',
  },
  groupPickerText: { fontSize: 15, color: '#333' },
  groupPickerTextActive: { color: '#2E7D32', fontWeight: '600' },
  // Standings rows
  standingRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: '#FFF', borderRadius: 8, marginBottom: 4,
  },
  standingRowHighlight: {
    backgroundColor: '#E8F5E9', borderLeftWidth: 3, borderLeftColor: '#2E7D32',
  },
  rankContainer: { width: 28, alignItems: 'center' },
  rankText: { fontSize: 14, fontWeight: '600', color: '#888' },
  standingName: { flex: 1, fontSize: 15, color: '#1A1A2E', marginLeft: 8 },
  standingNameBold: { fontWeight: '700' },
  standingRounds: { fontSize: 13, color: '#999', width: 24, textAlign: 'center' },
  standingNet: { fontSize: 15, fontWeight: '600', color: '#1A1A2E', minWidth: 60, textAlign: 'right' },
  netPositive: { color: '#2E7D32' },
  netNegative: { color: '#D32F2F' },
  // Empty states
  emptyState: { alignItems: 'center', paddingVertical: 30 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#999', marginTop: 12 },
  emptySubtext: { fontSize: 14, color: '#BBB', marginTop: 4, textAlign: 'center' },
  checksumText: { fontSize: 11, color: '#BBB', textAlign: 'right', marginTop: 6, paddingRight: 4 },
});
