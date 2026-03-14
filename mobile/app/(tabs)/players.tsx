import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useApp } from '@/src/context/AppContext';
import { usePlayers } from '@/src/context/PlayerContext';
import { getPlayerDisplayName, Player } from '@/src/models/Player';

export default function PlayersScreen() {
  const router = useRouter();
  const { state: appState } = useApp();
  const { state: playerState, loadPlayers, removePlayer, ghinConnected, fetchGhinHandicap, isAppOwner, ownerPlayerId } = usePlayers();
  const [groupMateIds, setGroupMateIds] = useState<Set<string>>(new Set());
  const [showAllPlayers, setShowAllPlayers] = useState(false);

  useEffect(() => {
    if (appState.isDbReady) {
      loadPlayers();
    }
  }, [appState.isDbReady]);

  // Load group-mate player IDs for the owner
  useEffect(() => {
    async function loadGroupMates() {
      if (!ownerPlayerId) return;
      try {
        const { getGroupMatePlayerIds } = await import('@/src/db/leagueRepository');
        const ids = await getGroupMatePlayerIds(ownerPlayerId);
        setGroupMateIds(new Set(ids));
      } catch {
        setGroupMateIds(new Set());
      }
    }
    loadGroupMates();
  }, [ownerPlayerId, playerState.players]);

  const hasGroupMates = groupMateIds.size > 0;

  // Filter players based on toggle
  const displayPlayers = (!showAllPlayers && hasGroupMates)
    ? playerState.players.filter((p) => groupMateIds.has(p.id))
    : playerState.players;

  function handleDelete(id: string, name: string) {
    if (isAppOwner(id)) {
      Alert.alert(
        'Cannot Delete',
        'This is your profile. To change it, go to Settings.',
      );
      return;
    }
    Alert.alert('Delete Player', `Remove ${name} from your players?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => removePlayer(id),
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => router.push('/player/add')}
      >
        <FontAwesome name="plus" size={18} color="#FFF" />
        <Text style={styles.addButtonText}>Add Player</Text>
      </TouchableOpacity>

      {/* Filter toggle — only show if the owner is in at least one group */}
      {hasGroupMates && (
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, !showAllPlayers && styles.filterChipActive]}
            onPress={() => setShowAllPlayers(false)}
          >
            <Text style={[styles.filterChipText, !showAllPlayers && styles.filterChipTextActive]}>
              Group Members
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, showAllPlayers && styles.filterChipActive]}
            onPress={() => setShowAllPlayers(true)}
          >
            <Text style={[styles.filterChipText, showAllPlayers && styles.filterChipTextActive]}>
              All Players
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {displayPlayers.length === 0 ? (
        <View style={styles.emptyState}>
          <FontAwesome name="users" size={48} color="#CCC" />
          <Text style={styles.emptyText}>No players yet</Text>
          <Text style={styles.emptySubtext}>Add players to start tracking scores</Text>
        </View>
      ) : (
        <FlatList
          data={displayPlayers}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PlayerCard
              player={item}
              isOwner={isAppOwner(item.id)}
              ghinConnected={ghinConnected}
              fetchGhinHandicap={fetchGhinHandicap}
              onPress={() => router.push(`/player/${item.id}`)}
              onDelete={() => handleDelete(item.id, getPlayerDisplayName(item))}
            />
          )}
        />
      )}
    </View>
  );
}

function PlayerCard({
  player,
  isOwner,
  ghinConnected,
  fetchGhinHandicap,
  onPress,
  onDelete,
}: {
  player: Player;
  isOwner: boolean;
  ghinConnected: boolean;
  fetchGhinHandicap: (id: string) => Promise<number | null>;
  onPress: () => void;
  onDelete: () => void;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const showRefresh = ghinConnected && !!player.ghinNumber;

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      const newIndex = await fetchGhinHandicap(player.id);
      if (newIndex === null) {
        Alert.alert('Not Found', 'Could not retrieve handicap from GHIN.');
      }
    } catch (err: any) {
      Alert.alert('GHIN Error', err?.message || 'Failed to fetch from GHIN.');
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <TouchableOpacity style={styles.playerCard} onPress={onPress}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {player.firstName[0]}{player.lastName[0]}
        </Text>
      </View>
      <View style={styles.playerInfo}>
        <View style={styles.nameRow}>
          <Text style={styles.playerName}>{getPlayerDisplayName(player)}</Text>
          {isOwner && (
            <View style={styles.ownerBadge}>
              <Text style={styles.ownerBadgeText}>You</Text>
            </View>
          )}
        </View>
        <Text style={styles.playerHandicap}>
          Handicap Index: {player.handicapIndex.toFixed(1)}
        </Text>
        {player.ghinNumber ? (
          <Text style={styles.playerGhin}>GHIN: {player.ghinNumber}</Text>
        ) : null}
        {player.email ? (
          <Text style={styles.playerGhin}>{player.email}</Text>
        ) : null}
        {player.venmoHandle ? (
          <Text style={styles.playerGhin}>@{player.venmoHandle}</Text>
        ) : null}
      </View>
      {showRefresh && (
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={handleRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? (
            <ActivityIndicator size="small" color="#2E7D32" />
          ) : (
            <FontAwesome name="refresh" size={14} color="#2E7D32" />
          )}
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={onDelete}
      >
        <FontAwesome name="trash-o" size={18} color="#D32F2F" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5', padding: 16 },
  addButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#2E7D32', paddingVertical: 12, borderRadius: 10, marginBottom: 12,
  },
  addButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  // Filter toggle
  filterRow: {
    flexDirection: 'row', gap: 8, marginBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E0E0E0',
  },
  filterChipActive: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  filterChipText: { fontSize: 13, fontWeight: '600', color: '#666' },
  filterChipTextActive: { color: '#FFF' },
  // Player cards
  playerCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 14, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#2E7D32',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  avatarText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  playerInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerName: { fontSize: 16, fontWeight: '600', color: '#1A1A2E' },
  ownerBadge: {
    backgroundColor: '#E8F5E9', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4,
    borderWidth: 1, borderColor: '#A5D6A7',
  },
  ownerBadgeText: { fontSize: 10, fontWeight: '700', color: '#2E7D32' },
  playerHandicap: { fontSize: 13, color: '#666', marginTop: 2 },
  playerGhin: { fontSize: 12, color: '#999', marginTop: 1 },
  refreshButton: { padding: 8, marginRight: 4 },
  deleteButton: { padding: 8 },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#999', marginTop: 12 },
  emptySubtext: { fontSize: 14, color: '#BBB', marginTop: 4 },
});
