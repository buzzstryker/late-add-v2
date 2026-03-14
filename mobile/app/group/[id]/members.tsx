import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Modal, FlatList } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useGroups } from '@/src/context/GroupContext';
import { usePlayers } from '@/src/context/PlayerContext';
import { getPlayerDisplayName, Player } from '@/src/models/Player';
import { GroupMember, GroupMemberRole } from '@/src/models/League';

export default function MembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state: groupState, permissions, loadGroupDetail, addMember, removeMember, updateMemberRole } = useGroups();
  const { state: playerState } = usePlayers();
  const [showAddPicker, setShowAddPicker] = useState(false);

  useEffect(() => {
    if (id) loadGroupDetail(id);
  }, [id]);

  const members = groupState.activeGroupMembers;

  // Players not already in this group
  const memberPlayerIds = new Set(members.map((m) => m.playerId));
  const availablePlayers = playerState.players.filter((p) => !memberPlayerIds.has(p.id));

  function getPlayer(playerId: string): Player | undefined {
    return playerState.players.find((p) => p.id === playerId);
  }

  async function handleAdd(playerId: string) {
    try {
      await addMember(id!, playerId, 'member');
      setShowAddPicker(false);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to add member');
    }
  }

  function handleRemove(member: GroupMember) {
    const player = getPlayer(member.playerId);
    const name = player ? getPlayerDisplayName(player) : 'this member';
    Alert.alert('Remove Member', `Remove ${name} from the group?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeMember(id!, member.playerId);
          } catch (err: any) {
            Alert.alert('Error', err?.message || 'Failed to remove member');
          }
        },
      },
    ]);
  }

  async function handleToggleRole(member: GroupMember) {
    const newRole: GroupMemberRole = member.role === 'admin' ? 'member' : 'admin';
    try {
      await updateMemberRole(member.id, newRole);
      // Refresh to see updated role
      if (id) loadGroupDetail(id);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to update role');
    }
  }

  return (
    <View style={styles.container}>
      {permissions.canManageMembers && (
        <TouchableOpacity style={styles.addButton} onPress={() => setShowAddPicker(true)}>
          <FontAwesome name="plus" size={18} color="#FFF" />
          <Text style={styles.addButtonText}>Add Member</Text>
        </TouchableOpacity>
      )}

      {members.length === 0 ? (
        <View style={styles.emptyState}>
          <FontAwesome name="users" size={48} color="#CCC" />
          <Text style={styles.emptyText}>No members yet</Text>
          <Text style={styles.emptySubtext}>Add players to this group</Text>
        </View>
      ) : (
        <ScrollView style={styles.memberList}>
          {members.map((member) => {
            const player = getPlayer(member.playerId);
            if (!player) return null;

            return (
              <View key={member.id} style={styles.memberCard}>
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
                {permissions.canToggleRoles ? (
                  <TouchableOpacity
                    style={[styles.roleBadge, member.role === 'admin' && styles.roleBadgeAdmin]}
                    onPress={() => handleToggleRole(member)}
                  >
                    <Text style={[styles.roleBadgeText, member.role === 'admin' && styles.roleBadgeTextAdmin]}>
                      {member.role === 'admin' ? 'Admin' : 'Member'}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.roleBadge, member.role === 'admin' && styles.roleBadgeAdmin]}>
                    <Text style={[styles.roleBadgeText, member.role === 'admin' && styles.roleBadgeTextAdmin]}>
                      {member.role === 'admin' ? 'Admin' : 'Member'}
                    </Text>
                  </View>
                )}
                {permissions.canManageMembers && (
                  <TouchableOpacity style={styles.removeButton} onPress={() => handleRemove(member)}>
                    <FontAwesome name="times" size={16} color="#D32F2F" />
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Add Member Picker Modal */}
      <Modal visible={showAddPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Member</Text>
              <TouchableOpacity onPress={() => setShowAddPicker(false)}>
                <FontAwesome name="times" size={20} color="#666" />
              </TouchableOpacity>
            </View>

            {availablePlayers.length === 0 ? (
              <Text style={styles.noPlayersText}>All players are already members</Text>
            ) : (
              <FlatList
                data={availablePlayers}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.playerPickerRow} onPress={() => handleAdd(item.id)}>
                    <View style={styles.pickerAvatar}>
                      <Text style={styles.pickerAvatarText}>
                        {item.firstName?.[0]}{item.lastName?.[0]}
                      </Text>
                    </View>
                    <View style={styles.pickerInfo}>
                      <Text style={styles.pickerName}>{getPlayerDisplayName(item)}</Text>
                      {item.venmoHandle ? (
                        <Text style={styles.pickerVenmo}>@{item.venmoHandle}</Text>
                      ) : null}
                    </View>
                    <FontAwesome name="plus-circle" size={22} color="#2E7D32" />
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5', padding: 16 },
  addButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#2E7D32', paddingVertical: 12, borderRadius: 10, marginBottom: 16,
  },
  addButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#999', marginTop: 12 },
  emptySubtext: { fontSize: 14, color: '#BBB', marginTop: 4 },
  memberList: { flex: 1 },
  memberCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 12, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  memberAvatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#E8F5E9',
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  memberAvatarText: { color: '#2E7D32', fontSize: 14, fontWeight: '600' },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '500', color: '#1A1A2E' },
  memberVenmo: { fontSize: 12, color: '#999', marginTop: 1 },
  roleBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginRight: 8,
    backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: '#E0E0E0',
  },
  roleBadgeAdmin: {
    backgroundColor: '#E8F5E9', borderColor: '#A5D6A7',
  },
  roleBadgeText: { fontSize: 11, fontWeight: '700', color: '#999' },
  roleBadgeTextAdmin: { color: '#2E7D32' },
  removeButton: { padding: 8 },
  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFF', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 16, maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A2E' },
  noPlayersText: { fontSize: 14, color: '#999', textAlign: 'center', paddingVertical: 24 },
  playerPickerRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: '#F0F0F0',
  },
  pickerAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#E8F5E9',
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  pickerAvatarText: { color: '#2E7D32', fontSize: 13, fontWeight: '600' },
  pickerInfo: { flex: 1 },
  pickerName: { fontSize: 15, fontWeight: '500', color: '#1A1A2E' },
  pickerVenmo: { fontSize: 12, color: '#999' },
});
