import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SectionList } from 'react-native';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useApp } from '@/src/context/AppContext';
import { useGroups } from '@/src/context/GroupContext';
import { usePlayers } from '@/src/context/PlayerContext';
import { Group, Section } from '@/src/models/League';

interface GroupSection {
  title: string;
  data: Group[];
}

export default function GroupsScreen() {
  const router = useRouter();
  const { state: appState } = useApp();
  const { state: groupState, loadGroups, loadSections, getPlayerGroups } = useGroups();
  const { ownerPlayerId } = usePlayers();
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [myGroupIds, setMyGroupIds] = useState<Set<string>>(new Set());
  const [showMyGroupsOnly, setShowMyGroupsOnly] = useState(false);

  useEffect(() => {
    if (appState.isDbReady) {
      loadGroups();
      loadSections();
    }
  }, [appState.isDbReady]);

  // Load member counts for each group + owner's group memberships
  useEffect(() => {
    async function loadCounts() {
      const counts: Record<string, number> = {};
      for (const group of groupState.groups) {
        try {
          const { getActiveGroupMembers } = await import('@/src/db/leagueRepository');
          const members = await getActiveGroupMembers(group.id);
          counts[group.id] = members.length;
        } catch {
          counts[group.id] = 0;
        }
      }
      setMemberCounts(counts);
    }

    async function loadMyGroups() {
      if (!ownerPlayerId) return;
      try {
        const groups = await getPlayerGroups(ownerPlayerId);
        setMyGroupIds(new Set(groups.map((g) => g.id)));
      } catch {
        setMyGroupIds(new Set());
      }
    }

    if (groupState.groups.length > 0) {
      loadCounts();
      loadMyGroups();
    }
  }, [groupState.groups, ownerPlayerId]);

  // Filter groups based on toggle
  const displayGroups = showMyGroupsOnly
    ? groupState.groups.filter((g) => myGroupIds.has(g.id))
    : groupState.groups;

  // Build sections: group the groups by sectionId
  const sections: GroupSection[] = React.useMemo(() => {
    const sectionMap = new Map<string, Section>();
    for (const s of groupState.sections) {
      sectionMap.set(s.id, s);
    }

    // Groups with a section
    const bySectionId = new Map<string, Group[]>();
    const unsectioned: Group[] = [];

    for (const group of displayGroups) {
      if (group.sectionId && sectionMap.has(group.sectionId)) {
        const existing = bySectionId.get(group.sectionId) ?? [];
        existing.push(group);
        bySectionId.set(group.sectionId, existing);
      } else {
        unsectioned.push(group);
      }
    }

    const result: GroupSection[] = [];

    // Add sectioned groups
    for (const [sectionId, groups] of bySectionId) {
      const section = sectionMap.get(sectionId)!;
      result.push({ title: section.name, data: groups });
    }

    // Sort sections alphabetically
    result.sort((a, b) => a.title.localeCompare(b.title));

    // Add unsectioned at end
    if (unsectioned.length > 0) {
      if (result.length > 0) {
        result.push({ title: 'Other', data: unsectioned });
      } else {
        // No sections at all — don't show header
        result.push({ title: '', data: unsectioned });
      }
    }

    return result;
  }, [displayGroups, groupState.sections]);

  const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <View style={styles.container}>
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => router.push('/group/create')}
        >
          <FontAwesome name="plus" size={18} color="#FFF" />
          <Text style={styles.addButtonText}>New Group</Text>
        </TouchableOpacity>

      </View>

      {/* My Groups / All Groups toggle */}
      {groupState.groups.length > 0 && (
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, !showMyGroupsOnly && styles.filterChipActive]}
            onPress={() => setShowMyGroupsOnly(false)}
          >
            <Text style={[styles.filterChipText, !showMyGroupsOnly && styles.filterChipTextActive]}>
              All Groups
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, showMyGroupsOnly && styles.filterChipActive]}
            onPress={() => setShowMyGroupsOnly(true)}
          >
            <Text style={[styles.filterChipText, showMyGroupsOnly && styles.filterChipTextActive]}>
              My Groups
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {displayGroups.length === 0 && groupState.groups.length > 0 ? (
        <View style={styles.emptyState}>
          <FontAwesome name="users" size={48} color="#CCC" />
          <Text style={styles.emptyText}>No groups to show</Text>
          <Text style={styles.emptySubtext}>
            {showMyGroupsOnly ? 'You are not a member of any groups' : 'No groups have been created'}
          </Text>
        </View>
      ) : groupState.groups.length === 0 ? (
        <View style={styles.emptyState}>
          <FontAwesome name="trophy" size={48} color="#CCC" />
          <Text style={styles.emptyText}>No groups yet</Text>
          <Text style={styles.emptySubtext}>Create a group to track league standings</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) =>
            section.title ? (
              <Text style={styles.sectionHeader}>{section.title}</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.groupCard}
              onPress={() => router.push(`/group/${item.id}`)}
            >
              <View style={styles.logoCircle}>
                <Text style={styles.logoText}>
                  {item.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.groupInfo}>
                <Text style={styles.groupName}>{item.name}</Text>
                <Text style={styles.groupMeta}>
                  {memberCounts[item.id] ?? '—'} members · Season starts {MONTH_NAMES[item.seasonStartMonth]}
                </Text>
              </View>
              {myGroupIds.has(item.id) && (
                <View style={styles.memberBadge}>
                  <FontAwesome name="check-circle" size={14} color="#2E7D32" />
                </View>
              )}
              <FontAwesome name="chevron-right" size={14} color="#CCC" />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5', padding: 16 },
  buttonRow: { gap: 8, marginBottom: 8 },
  addButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#2E7D32', paddingVertical: 12, borderRadius: 10,
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
  // Sections
  sectionHeader: {
    fontSize: 16, fontWeight: '700', color: '#1A1A2E', marginTop: 12, marginBottom: 6,
    paddingLeft: 2,
  },
  groupCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 14, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  logoCircle: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#2E7D32',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  logoText: { color: '#FFF', fontSize: 20, fontWeight: 'bold' },
  groupInfo: { flex: 1 },
  groupName: { fontSize: 16, fontWeight: '600', color: '#1A1A2E' },
  groupMeta: { fontSize: 13, color: '#666', marginTop: 2 },
  memberBadge: { marginRight: 8 },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#999', marginTop: 12 },
  emptySubtext: { fontSize: 14, color: '#BBB', marginTop: 4, textAlign: 'center' },
});
