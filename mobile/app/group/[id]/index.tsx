import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useGroups } from '@/src/context/GroupContext';
import { usePlayers } from '@/src/context/PlayerContext';
import { getPlayerDisplayName } from '@/src/models/Player';
import { GroupMember, Season } from '@/src/models/League';

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { state: groupState, permissions, loadGroupDetail, deleteGroup } = useGroups();
  const { state: playerState } = usePlayers();

  useEffect(() => {
    if (id) loadGroupDetail(id);
  }, [id]);

  const seasonWinners = groupState.seasonWinners;

  const group = groupState.activeGroup;
  if (!group) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const admin = playerState.players.find((p) => p.id === group.adminPlayerId);
  const today = new Date().toISOString().split('T')[0];

  function isCurrentSeason(season: Season): boolean {
    const start = season.startDate.split('T')[0];
    const end = season.endDate.split('T')[0];
    return today >= start && today <= end;
  }

  function formatDate(dateStr: string): string {
    const d = dateStr.split('T')[0];
    const [y, m] = d.split('-');
    return `${MONTH_NAMES[parseInt(m)]} ${y}`;
  }

  function getPlayerShortName(playerId: string): string {
    const player = playerState.players.find((p) => p.id === playerId);
    if (!player) return 'Unknown';
    if (player.nickname) return player.nickname;
    return player.firstName;
  }

  function formatDollars(amount: number): string {
    if (amount >= 0) return `$${amount}`;
    return `-$${Math.abs(amount)}`;
  }

  // Separate current season from past seasons
  const currentSeason = groupState.activeGroupSeasons.find(isCurrentSeason);
  const pastSeasons = groupState.activeGroupSeasons.filter(
    (s) => !isCurrentSeason(s),
  );

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.headerCard}>
        <View style={styles.headerTop}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>{group.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.groupName}>{group.name}</Text>
            {admin && <Text style={styles.adminText}>Admin: {getPlayerDisplayName(admin)}</Text>}
            <Text style={styles.metaText}>Season starts {MONTH_NAMES[group.seasonStartMonth]}</Text>
          </View>
          {permissions.canEditGroup && (
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => router.push(`/group/${id}/edit`)}
            >
              <FontAwesome name="pencil" size={16} color="#2E7D32" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Members */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          Members ({groupState.activeGroupMembers.length})
        </Text>
        {permissions.canManageMembers && (
          <TouchableOpacity onPress={() => router.push(`/group/${id}/members`)}>
            <Text style={styles.manageLink}>Manage</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.card}>
        {groupState.activeGroupMembers.length === 0 ? (
          <Text style={styles.emptyText}>No members yet</Text>
        ) : (
          groupState.activeGroupMembers.map((member) => (
            <MemberRow key={member.id} member={member} players={playerState.players} />
          ))
        )}
      </View>

      {/* Current Season */}
      {currentSeason && (
        <>
          <Text style={styles.sectionTitle}>Current Season</Text>
          <TouchableOpacity
            style={[styles.seasonCard, styles.currentSeasonCard]}
            onPress={() => router.push(`/group/${id}/season/${currentSeason.id}`)}
          >
            <View style={styles.seasonInfo}>
              <Text style={styles.seasonDates}>
                {formatDate(currentSeason.startDate)} — {formatDate(currentSeason.endDate)}
              </Text>
              <View style={styles.currentBadge}>
                <Text style={styles.currentBadgeText}>Current</Text>
              </View>
            </View>
            <FontAwesome name="chevron-right" size={14} color="#999" />
          </TouchableOpacity>
        </>
      )}

      {/* Previous Seasons */}
      {pastSeasons.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Previous Seasons</Text>
          {pastSeasons.map((season) => {
            const winner = seasonWinners[season.id];
            return (
              <TouchableOpacity
                key={season.id}
                style={styles.seasonCard}
                onPress={() => router.push(`/group/${id}/season/${season.id}`)}
              >
                <View style={styles.seasonContent}>
                  {winner && (
                    <View style={styles.winnerRow}>
                      <FontAwesome name="trophy" size={12} color="#DAA520" />
                      <Text style={styles.winnerName}>
                        {getPlayerShortName(winner.playerId)}
                      </Text>
                      <Text style={styles.winnerAmount}>· {formatDollars(winner.netAmount)}</Text>
                    </View>
                  )}
                  <Text style={styles.seasonDates}>
                    {formatDate(season.startDate)} — {formatDate(season.endDate)}
                  </Text>
                </View>
                <FontAwesome name="chevron-right" size={14} color="#999" />
              </TouchableOpacity>
            );
          })}
        </>
      )}

      {groupState.activeGroupSeasons.length === 0 && (
        <>
          <Text style={styles.sectionTitle}>Seasons</Text>
          <View style={styles.card}>
            <Text style={styles.emptyText}>No seasons yet</Text>
          </View>
        </>
      )}

      {/* Role Badge */}
      {groupState.currentPlayerRole && (
        <View style={styles.roleBanner}>
          {groupState.currentPlayerRole === 'super_admin' && (
            <>
              <FontAwesome name="star" size={12} color="#DAA520" />
              <Text style={styles.roleBannerText}>Super Admin</Text>
            </>
          )}
          {groupState.currentPlayerRole === 'admin' && (
            <>
              <FontAwesome name="shield" size={12} color="#2E7D32" />
              <Text style={styles.roleBannerText}>Group Admin</Text>
            </>
          )}
          {groupState.currentPlayerRole === 'member' && (
            <>
              <FontAwesome name="user" size={12} color="#999" />
              <Text style={[styles.roleBannerText, { color: '#999' }]}>Member</Text>
            </>
          )}
        </View>
      )}

      {/* Delete Group */}
      {permissions.canDeleteGroup && (
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => {
            Alert.alert(
              'Delete Group',
              `Delete "${group.name}"? This will remove all league data.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    await deleteGroup(group.id);
                    router.back();
                  },
                },
              ],
            );
          }}
        >
          <FontAwesome name="trash-o" size={14} color="#D32F2F" />
          <Text style={styles.deleteButtonText}>Delete Group</Text>
        </TouchableOpacity>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function MemberRow({ member, players }: { member: GroupMember; players: any[] }) {
  const player = players.find((p: any) => p.id === member.playerId);
  if (!player) return null;

  return (
    <View style={styles.memberRow}>
      <View style={styles.memberAvatar}>
        <Text style={styles.memberAvatarText}>
          {player.firstName?.[0]}{player.lastName?.[0]}
        </Text>
      </View>
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>{getPlayerDisplayName(player)}</Text>
        {player.venmoHandle ? (
          <Text style={styles.memberVenmo}>@{player.venmoHandle}</Text>
        ) : null}
      </View>
      {member.role === 'admin' && (
        <View style={styles.roleBadge}>
          <Text style={styles.roleBadgeText}>Admin</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5', padding: 16 },
  loadingText: { fontSize: 16, color: '#999', textAlign: 'center', marginTop: 40 },
  headerCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center' },
  logoCircle: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#2E7D32',
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  logoText: { color: '#FFF', fontSize: 24, fontWeight: 'bold' },
  headerInfo: { flex: 1 },
  groupName: { fontSize: 20, fontWeight: '700', color: '#1A1A2E' },
  adminText: { fontSize: 13, color: '#666', marginTop: 2 },
  metaText: { fontSize: 13, color: '#999', marginTop: 1 },
  editButton: {
    padding: 10, backgroundColor: '#E8F5E9', borderRadius: 8,
  },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1A1A2E', marginBottom: 8 },
  manageLink: { fontSize: 14, color: '#2E7D32', fontWeight: '600' },
  card: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 12, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  emptyText: { fontSize: 14, color: '#999', textAlign: 'center', paddingVertical: 8 },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 0.5, borderBottomColor: '#F0F0F0',
  },
  memberAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#E8F5E9',
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  memberAvatarText: { color: '#2E7D32', fontSize: 13, fontWeight: '600' },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '500', color: '#1A1A2E' },
  memberVenmo: { fontSize: 12, color: '#999' },
  roleBadge: {
    backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4,
    borderWidth: 1, borderColor: '#A5D6A7',
  },
  roleBadgeText: { fontSize: 11, fontWeight: '700', color: '#2E7D32' },
  // Seasons
  seasonCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 14, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  currentSeasonCard: { borderWidth: 1.5, borderColor: '#2E7D32' },
  seasonContent: { flex: 1 },
  seasonInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  seasonDates: { fontSize: 14, fontWeight: '500', color: '#1A1A2E' },
  currentBadge: {
    backgroundColor: '#E8F5E9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  currentBadgeText: { fontSize: 11, fontWeight: '700', color: '#2E7D32' },
  winnerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3,
  },
  winnerName: { fontSize: 13, fontWeight: '700', color: '#1A1A2E' },
  winnerAmount: { fontSize: 13, fontWeight: '600', color: '#666' },
  // Role Banner
  roleBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, marginTop: 16,
  },
  roleBannerText: { fontSize: 13, fontWeight: '600', color: '#1A1A2E' },
  // Delete
  deleteButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, marginTop: 8,
  },
  deleteButtonText: { fontSize: 14, fontWeight: '500', color: '#D32F2F' },
});
