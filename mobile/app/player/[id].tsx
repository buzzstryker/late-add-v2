import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { usePlayers } from '@/src/context/PlayerContext';
import { useGroups } from '@/src/context/GroupContext';
import { Player } from '@/src/models/Player';
import type { Group } from '@/src/models/League';

export default function EditPlayerScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    state: playerState, updatePlayer, loadPlayers,
    ghinConnected, fetchGhinHandicap,
  } = usePlayers();
  const { getPlayerGroups } = useGroups();

  const [player, setPlayer] = useState<Player | null>(null);
  const [playerGroups, setPlayerGroups] = useState<Group[]>([]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nickname, setNickname] = useState('');
  const [gender, setGender] = useState<'M' | 'F'>('M');
  const [handicapIndex, setHandicapIndex] = useState('');
  const [ghinNumber, setGhinNumber] = useState('');
  const [email, setEmail] = useState('');
  const [venmoHandle, setVenmoHandle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingGhin, setIsFetchingGhin] = useState(false);

  useEffect(() => {
    if (playerState.players.length === 0) {
      loadPlayers();
    }
  }, []);

  useEffect(() => {
    if (id) {
      getPlayerGroups(id).then(setPlayerGroups).catch(() => {});
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const p = playerState.players.find((pl) => pl.id === id);
    if (p) {
      setPlayer(p);
      setFirstName(p.firstName);
      setLastName(p.lastName);
      setNickname(p.nickname || '');
      setGender(p.gender);
      setHandicapIndex(p.handicapIndex.toString());
      setGhinNumber(p.ghinNumber || '');
      setEmail(p.email || '');
      setVenmoHandle(p.venmoHandle || '');
    }
  }, [id, playerState.players]);

  async function handleSave() {
    if (!id || !firstName.trim() || !lastName.trim()) {
      Alert.alert('Required', 'First name and last name are required.');
      return;
    }

    const parsed = parseFloat(handicapIndex);
    if (handicapIndex.trim() && isNaN(parsed)) {
      Alert.alert('Invalid', 'Handicap index must be a number.');
      return;
    }

    setIsSaving(true);
    try {
      await updatePlayer(id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        nickname: nickname.trim() || undefined,
        gender,
        handicapIndex: isNaN(parsed) ? 0 : parsed,
        ghinNumber: ghinNumber.trim() || undefined,
        email: email.trim() || undefined,
        venmoHandle: venmoHandle.trim() || undefined,
      });
      router.back();
    } catch (err) {
      Alert.alert('Error', 'Failed to update player.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleGhinRefresh() {
    if (!id) return;
    setIsFetchingGhin(true);
    try {
      const newIndex = await fetchGhinHandicap(id);
      if (newIndex !== null) {
        setHandicapIndex(newIndex.toString());
        Alert.alert('Updated', `Handicap index updated to ${newIndex.toFixed(1)}`);
      } else {
        Alert.alert('Not Found', 'Could not retrieve handicap from GHIN. Check the GHIN number.');
      }
    } catch (err: any) {
      const message = err?.message || 'Failed to fetch from GHIN.';
      Alert.alert('GHIN Error', message);
    } finally {
      setIsFetchingGhin(false);
    }
  }

  const showGhinRefresh = ghinConnected && !!ghinNumber.trim();

  if (!player) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2E7D32" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.label}>First Name *</Text>
        <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} />

        <Text style={styles.label}>Last Name *</Text>
        <TextInput style={styles.input} value={lastName} onChangeText={setLastName} />

        <Text style={styles.label}>Nickname</Text>
        <TextInput style={styles.input} value={nickname} onChangeText={setNickname} placeholder="Optional" />

        <Text style={styles.label}>Gender</Text>
        <View style={styles.genderRow}>
          {(['M', 'F'] as const).map((g) => (
            <TouchableOpacity
              key={g}
              style={[styles.genderButton, gender === g && styles.genderButtonSelected]}
              onPress={() => setGender(g)}
            >
              <Text style={[styles.genderButtonText, gender === g && styles.genderButtonTextSelected]}>
                {g === 'M' ? 'Male' : 'Female'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.handicapLabelRow}>
          <Text style={styles.label}>Handicap Index</Text>
          {showGhinRefresh && (
            <TouchableOpacity
              onPress={handleGhinRefresh}
              disabled={isFetchingGhin}
              style={styles.refreshButton}
            >
              {isFetchingGhin ? (
                <ActivityIndicator size="small" color="#2E7D32" />
              ) : (
                <FontAwesome name="refresh" size={16} color="#2E7D32" />
              )}
            </TouchableOpacity>
          )}
        </View>
        <TextInput
          style={styles.input}
          value={handicapIndex}
          onChangeText={setHandicapIndex}
          keyboardType="decimal-pad"
        />

        <Text style={styles.label}>GHIN Number</Text>
        <TextInput
          style={styles.input}
          value={ghinNumber}
          onChangeText={setGhinNumber}
          placeholder="Optional"
          keyboardType="number-pad"
        />

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Optional"
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={styles.label}>Venmo Handle</Text>
        <TextInput
          style={styles.input}
          value={venmoHandle}
          onChangeText={setVenmoHandle}
          placeholder="@username"
          autoCapitalize="none"
        />

        {/* Groups */}
        <Text style={styles.label}>Groups</Text>
        {playerGroups.length > 0 ? (
          <View style={styles.groupList}>
            {playerGroups.map((g) => (
              <View key={g.id} style={styles.groupChip}>
                <FontAwesome name="trophy" size={12} color="#2E7D32" />
                <Text style={styles.groupChipText}>{g.name}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.groupEmpty}>Not in any groups</Text>
        )}

        <TouchableOpacity
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
        >
          <Text style={styles.saveButtonText}>{isSaving ? 'Saving...' : 'Save Changes'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  content: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  label: { fontSize: 14, fontWeight: '600', color: '#1A1A2E', marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: '#FFF', borderRadius: 8, padding: 12, fontSize: 16,
    borderWidth: 1, borderColor: '#E0E0E0',
  },
  genderRow: { flexDirection: 'row', gap: 8 },
  genderButton: {
    flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#E0E0E0',
    backgroundColor: '#FFF', alignItems: 'center',
  },
  genderButtonSelected: { borderColor: '#2E7D32', backgroundColor: '#E8F5E9' },
  genderButtonText: { fontSize: 14, color: '#666' },
  genderButtonTextSelected: { color: '#2E7D32', fontWeight: '600' },
  handicapLabelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12,
  },
  refreshButton: {
    padding: 6, marginBottom: 6,
  },
  groupList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  groupChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#E8F5E9', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: '#C8E6C9',
  },
  groupChipText: { fontSize: 13, fontWeight: '600', color: '#2E7D32' },
  groupEmpty: { fontSize: 14, color: '#999', fontStyle: 'italic' },
  saveButton: {
    backgroundColor: '#2E7D32', paddingVertical: 14, borderRadius: 10,
    alignItems: 'center', marginTop: 24,
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
