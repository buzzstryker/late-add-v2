import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useGroups } from '@/src/context/GroupContext';
import { usePlayers } from '@/src/context/PlayerContext';
import { getPlayerDisplayName } from '@/src/models/Player';

const MONTHS = [
  { value: 1, label: 'January' }, { value: 2, label: 'February' }, { value: 3, label: 'March' },
  { value: 4, label: 'April' }, { value: 5, label: 'May' }, { value: 6, label: 'June' },
  { value: 7, label: 'July' }, { value: 8, label: 'August' }, { value: 9, label: 'September' },
  { value: 10, label: 'October' }, { value: 11, label: 'November' }, { value: 12, label: 'December' },
];

export default function EditGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { state: groupState, permissions, updateGroup, loadSections, loadGroupDetail } = useGroups();
  const { state: playerState } = usePlayers();

  const [name, setName] = useState('');
  const [seasonStartMonth, setSeasonStartMonth] = useState(1);
  const [adminPlayerId, setAdminPlayerId] = useState<string | undefined>();
  const [sectionId, setSectionId] = useState<string | undefined>();
  const [logoUrl, setLogoUrl] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadSections();
    if (id) loadGroupDetail(id);
  }, [id]);

  // Pre-fill form when group data loads
  useEffect(() => {
    if (groupState.activeGroup && groupState.activeGroup.id === id && !loaded) {
      const g = groupState.activeGroup;
      setName(g.name);
      setSeasonStartMonth(g.seasonStartMonth);
      setAdminPlayerId(g.adminPlayerId);
      setSectionId(g.sectionId);
      setLogoUrl(g.logoUrl || '');
      setLoaded(true);
    }
  }, [groupState.activeGroup, id, loaded]);

  // Permission guard — redirect if not authorized
  useEffect(() => {
    if (loaded && !permissions.canEditGroup) {
      Alert.alert('Not Authorized', 'You do not have permission to edit this group.');
      router.back();
    }
  }, [loaded, permissions.canEditGroup]);

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Missing Name', 'Please enter a group name.');
      return;
    }

    try {
      await updateGroup(id!, {
        name: name.trim(),
        seasonStartMonth,
        adminPlayerId,
        sectionId,
        logoUrl: logoUrl.trim() || undefined,
      });
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to update group');
    }
  }

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Group Name *</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Windex Cup"
      />

      <Text style={styles.label}>Season Start Month</Text>
      <View style={styles.monthGrid}>
        {MONTHS.map((m) => (
          <TouchableOpacity
            key={m.value}
            style={[styles.monthChip, seasonStartMonth === m.value && styles.monthChipActive]}
            onPress={() => setSeasonStartMonth(m.value)}
          >
            <Text style={[styles.monthChipText, seasonStartMonth === m.value && styles.monthChipTextActive]}>
              {m.label.slice(0, 3)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Admin</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerScroll}>
        <TouchableOpacity
          style={[styles.optionChip, !adminPlayerId && styles.optionChipActive]}
          onPress={() => setAdminPlayerId(undefined)}
        >
          <Text style={[styles.optionChipText, !adminPlayerId && styles.optionChipTextActive]}>None</Text>
        </TouchableOpacity>
        {playerState.players.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={[styles.optionChip, adminPlayerId === p.id && styles.optionChipActive]}
            onPress={() => setAdminPlayerId(p.id)}
          >
            <Text style={[styles.optionChipText, adminPlayerId === p.id && styles.optionChipTextActive]}>
              {getPlayerDisplayName(p)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {groupState.sections.length > 0 && (
        <>
          <Text style={styles.label}>Section</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerScroll}>
            <TouchableOpacity
              style={[styles.optionChip, !sectionId && styles.optionChipActive]}
              onPress={() => setSectionId(undefined)}
            >
              <Text style={[styles.optionChipText, !sectionId && styles.optionChipTextActive]}>None</Text>
            </TouchableOpacity>
            {groupState.sections.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={[styles.optionChip, sectionId === s.id && styles.optionChipActive]}
                onPress={() => setSectionId(s.id)}
              >
                <Text style={[styles.optionChipText, sectionId === s.id && styles.optionChipTextActive]}>
                  {s.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}

      <Text style={styles.label}>Logo URL (optional)</Text>
      <TextInput
        style={styles.input}
        value={logoUrl}
        onChangeText={setLogoUrl}
        placeholder="https://..."
        autoCapitalize="none"
        keyboardType="url"
      />

      <TouchableOpacity
        style={[styles.saveButton, !permissions.canEditGroup && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={!permissions.canEditGroup}
      >
        <FontAwesome name="check" size={18} color="#FFF" />
        <Text style={styles.saveButtonText}>Save Changes</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5', padding: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#1A1A2E', marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: '#FFF', borderRadius: 8, padding: 12, fontSize: 16,
    borderWidth: 1, borderColor: '#E0E0E0',
  },
  monthGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
  },
  monthChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E0E0E0',
  },
  monthChipActive: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  monthChipText: { fontSize: 13, color: '#666' },
  monthChipTextActive: { color: '#FFF', fontWeight: '600' },
  pickerScroll: { marginBottom: 4 },
  optionChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, marginRight: 6,
    backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E0E0E0',
  },
  optionChipActive: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  optionChipText: { fontSize: 14, color: '#666' },
  optionChipTextActive: { color: '#FFF', fontWeight: '600' },
  saveButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#2E7D32', paddingVertical: 14, borderRadius: 10, marginTop: 24,
  },
  saveButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  saveButtonDisabled: { backgroundColor: '#CCC' },
});
