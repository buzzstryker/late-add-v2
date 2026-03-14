import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  ScrollView, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { usePlayers } from '@/src/context/PlayerContext';

export default function AddPlayerScreen() {
  const router = useRouter();
  const { addPlayer } = usePlayers();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nickname, setNickname] = useState('');
  const [gender, setGender] = useState<'M' | 'F'>('M');
  const [handicapIndex, setHandicapIndex] = useState('');
  const [ghinNumber, setGhinNumber] = useState('');
  const [email, setEmail] = useState('');
  const [venmoHandle, setVenmoHandle] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    if (!firstName.trim() || !lastName.trim()) {
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
      await addPlayer({
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
      Alert.alert('Error', 'Failed to save player.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.label}>First Name *</Text>
        <TextInput
          style={styles.input}
          value={firstName}
          onChangeText={setFirstName}
          placeholder="John"
          autoFocus
        />

        <Text style={styles.label}>Last Name *</Text>
        <TextInput
          style={styles.input}
          value={lastName}
          onChangeText={setLastName}
          placeholder="Smith"
        />

        <Text style={styles.label}>Nickname</Text>
        <TextInput
          style={styles.input}
          value={nickname}
          onChangeText={setNickname}
          placeholder="Optional"
        />

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

        <Text style={styles.label}>Handicap Index</Text>
        <TextInput
          style={styles.input}
          value={handicapIndex}
          onChangeText={setHandicapIndex}
          placeholder="16.9"
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

        <TouchableOpacity
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
        >
          <Text style={styles.saveButtonText}>
            {isSaving ? 'Saving...' : 'Save Player'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  content: { padding: 16 },
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
  saveButton: {
    backgroundColor: '#2E7D32', paddingVertical: 14, borderRadius: 10,
    alignItems: 'center', marginTop: 24,
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
