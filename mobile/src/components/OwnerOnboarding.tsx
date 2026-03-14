import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { usePlayers } from '@/src/context/PlayerContext';
import { useApp } from '@/src/context/AppContext';
import { useAuth } from '@/src/context/AuthContext';
import { useSync } from '@/src/context/SyncContext';
import { getPlayerDisplayName } from '@/src/models/Player';

/**
 * Full-screen onboarding shown when no app owner is set.
 * User either selects themselves from the existing roster or creates a new player.
 */
export function OwnerOnboarding() {
  const { state: appState } = useApp();
  const { state: playerState, loadPlayers, addPlayer, setAppOwner } = usePlayers();
  const { state: authState, sendMagicLink, signOut } = useAuth();
  const { state: syncState, triggerSync, performInitialSync } = useSync();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showSyncSignIn, setShowSyncSignIn] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Sync sign-in state
  const [email, setEmail] = useState('');
  const [isSendingLink, setIsSendingLink] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  // Create-form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState<'M' | 'F'>('M');
  const [handicapIndex, setHandicapIndex] = useState('');
  const [ghinNumber, setGhinNumber] = useState('');

  useEffect(() => {
    if (appState.isDbReady) {
      loadPlayers();
    }
  }, [appState.isDbReady]);

  // Reload players after sync pulls new data
  useEffect(() => {
    if (syncState.lastPullCompletedAt > 0) {
      loadPlayers();
    }
  }, [syncState.lastPullCompletedAt]);

  // Once authenticated and initial sync is done, reload players
  useEffect(() => {
    if (authState.isAuthenticated && syncState.isInitialSyncDone) {
      loadPlayers();
      // Switch back to player selection view
      setShowSyncSignIn(false);
    }
  }, [authState.isAuthenticated, syncState.isInitialSyncDone]);

  async function handleSendLink() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    setIsSendingLink(true);
    try {
      await sendMagicLink(trimmed);
      setLinkSent(true);
    } catch {
      Alert.alert('Error', 'Could not send magic link. Please check your connection and try again.');
    } finally {
      setIsSendingLink(false);
    }
  }

  async function handleSelectPlayer(playerId: string) {
    setIsSaving(true);
    try {
      await setAppOwner(playerId);
    } catch {
      Alert.alert('Error', 'Failed to set profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateAndSelect() {
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
      const player = await addPlayer({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        gender,
        handicapIndex: isNaN(parsed) ? 0 : parsed,
        ghinNumber: ghinNumber.trim() || undefined,
      });
      await setAppOwner(player.id);
    } catch {
      Alert.alert('Error', 'Failed to create player. Please try again.');
      setIsSaving(false);
    }
  }

  const hasPlayers = playerState.players.length > 0;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <FontAwesome name="flag" size={40} color="#2E7D32" />
            <Text style={styles.title}>Welcome to Scorekeeper</Text>
            <Text style={styles.subtitle}>
              {showSyncSignIn
                ? 'Sign in to sync data from another device'
                : hasPlayers && !showCreateForm
                  ? 'Which player are you?'
                  : "Let's set up your profile"}
            </Text>
          </View>

          {/* ── Sync Sign-In Flow ── */}
          {showSyncSignIn ? (
            <View style={styles.formSection}>
              {authState.isAuthenticated ? (
                // Authenticated — show sync status
                <View style={styles.syncStatusCard}>
                  <FontAwesome name="check-circle" size={24} color="#2E7D32" style={{ alignSelf: 'center', marginBottom: 8 }} />
                  <Text style={[styles.label, { textAlign: 'center', marginTop: 0 }]}>
                    Signed in as {authState.user?.email}
                  </Text>
                  {syncState.isSyncing ? (
                    <View style={{ alignItems: 'center', marginTop: 16 }}>
                      <ActivityIndicator size="large" color="#2E7D32" />
                      <Text style={[styles.subtitle, { marginTop: 8 }]}>Syncing your data...</Text>
                    </View>
                  ) : syncState.syncError ? (
                    <View style={{ alignItems: 'center', marginTop: 12 }}>
                      <Text style={{ color: '#D32F2F', textAlign: 'center', marginBottom: 12 }}>{syncState.syncError}</Text>
                      <TouchableOpacity style={styles.primaryButton} onPress={triggerSync}>
                        <Text style={styles.primaryButtonText}>Retry Sync</Text>
                      </TouchableOpacity>
                    </View>
                  ) : playerState.players.length > 0 ? (
                    <View style={{ marginTop: 12 }}>
                      <Text style={[styles.subtitle, { textAlign: 'center', marginBottom: 16 }]}>
                        Synced! Select yourself below.
                      </Text>
                      <TouchableOpacity
                        style={styles.primaryButton}
                        onPress={() => setShowSyncSignIn(false)}
                      >
                        <Text style={styles.primaryButtonText}>Choose My Profile</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={{ alignItems: 'center', marginTop: 12 }}>
                      <Text style={[styles.subtitle, { textAlign: 'center' }]}>
                        No data found. Make sure you've synced from your other device first.
                      </Text>
                      <TouchableOpacity style={[styles.primaryButton, { marginTop: 16 }]} onPress={triggerSync}>
                        <Text style={styles.primaryButtonText}>Try Again</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ) : linkSent ? (
                // Link sent — waiting for user to click it
                <View style={styles.syncStatusCard}>
                  <FontAwesome name="envelope-o" size={24} color="#2E7D32" style={{ alignSelf: 'center', marginBottom: 8 }} />
                  <Text style={[styles.label, { textAlign: 'center', marginTop: 0 }]}>Check your email</Text>
                  <Text style={[styles.subtitle, { textAlign: 'center', marginBottom: 16 }]}>
                    We sent a sign-in link to {email.trim().toLowerCase()}
                  </Text>
                  <TouchableOpacity onPress={() => { setLinkSent(false); setEmail(''); }}>
                    <Text style={styles.secondaryButtonText}>Use a different email</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                // Email input form
                <>
                  <Text style={styles.label}>Email Address</Text>
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="Enter the email used on your other device"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    editable={!isSendingLink}
                  />
                  <TouchableOpacity
                    style={[styles.primaryButton, isSendingLink && styles.buttonDisabled]}
                    onPress={handleSendLink}
                    disabled={isSendingLink}
                  >
                    {isSendingLink ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text style={styles.primaryButtonText}>Send Magic Link</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => { setShowSyncSignIn(false); setLinkSent(false); setEmail(''); }}
              >
                <Text style={styles.secondaryButtonText}>Set Up as New Device</Text>
              </TouchableOpacity>
            </View>
          ) : showCreateForm ? (
            /* ── Create New Player Form ── */
            <View style={styles.formSection}>
              <Text style={styles.label}>First Name *</Text>
              <TextInput
                style={styles.input}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="John"
                autoFocus
                editable={!isSaving}
              />

              <Text style={styles.label}>Last Name *</Text>
              <TextInput
                style={styles.input}
                value={lastName}
                onChangeText={setLastName}
                placeholder="Smith"
                editable={!isSaving}
              />

              <Text style={styles.label}>Gender</Text>
              <View style={styles.genderRow}>
                {(['M', 'F'] as const).map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={[styles.genderButton, gender === g && styles.genderButtonSelected]}
                    onPress={() => setGender(g)}
                    disabled={isSaving}
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
                editable={!isSaving}
              />

              <Text style={styles.label}>GHIN Number</Text>
              <TextInput
                style={styles.input}
                value={ghinNumber}
                onChangeText={setGhinNumber}
                placeholder="Optional"
                keyboardType="number-pad"
                editable={!isSaving}
              />

              <TouchableOpacity
                style={[styles.primaryButton, isSaving && styles.buttonDisabled]}
                onPress={handleCreateAndSelect}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>Continue</Text>
                )}
              </TouchableOpacity>

              {hasPlayers && (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => setShowCreateForm(false)}
                  disabled={isSaving}
                >
                  <Text style={styles.secondaryButtonText}>Choose Existing Player</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : hasPlayers ? (
            /* ── Select from Existing Players ── */
            <View style={styles.listSection}>
              {playerState.players.map((player) => (
                <TouchableOpacity
                  key={player.id}
                  style={styles.playerCard}
                  onPress={() => handleSelectPlayer(player.id)}
                  disabled={isSaving}
                >
                  <View style={styles.playerCardContent}>
                    <Text style={styles.playerName}>{getPlayerDisplayName(player)}</Text>
                    <Text style={styles.playerDetails}>
                      {player.handicapIndex > 0 ? `HI: ${player.handicapIndex}` : ''}
                      {player.ghinNumber ? `  GHIN: ${player.ghinNumber}` : ''}
                    </Text>
                  </View>
                  <FontAwesome name="chevron-right" size={14} color="#999" />
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                style={styles.createNewButton}
                onPress={() => setShowCreateForm(true)}
                disabled={isSaving}
              >
                <FontAwesome name="plus" size={14} color="#2E7D32" />
                <Text style={styles.createNewButtonText}>Create New Player</Text>
              </TouchableOpacity>

              {!authState.isAuthenticated && (
                <TouchableOpacity
                  style={[styles.syncDeviceButton, { marginTop: 16 }]}
                  onPress={() => setShowSyncSignIn(true)}
                >
                  <FontAwesome name="cloud-download" size={14} color="#1976D2" />
                  <Text style={styles.syncDeviceButtonText}>Sync from Another Device</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            /* ── No Players — Go Straight to Form ── */
            <View style={styles.formSection}>
              <Text style={styles.label}>First Name *</Text>
              <TextInput
                style={styles.input}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="John"
                autoFocus
                editable={!isSaving}
              />

              <Text style={styles.label}>Last Name *</Text>
              <TextInput
                style={styles.input}
                value={lastName}
                onChangeText={setLastName}
                placeholder="Smith"
                editable={!isSaving}
              />

              <Text style={styles.label}>Gender</Text>
              <View style={styles.genderRow}>
                {(['M', 'F'] as const).map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={[styles.genderButton, gender === g && styles.genderButtonSelected]}
                    onPress={() => setGender(g)}
                    disabled={isSaving}
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
                editable={!isSaving}
              />

              <Text style={styles.label}>GHIN Number</Text>
              <TextInput
                style={styles.input}
                value={ghinNumber}
                onChangeText={setGhinNumber}
                placeholder="Optional"
                keyboardType="number-pad"
                editable={!isSaving}
              />

              <TouchableOpacity
                style={[styles.primaryButton, isSaving && styles.buttonDisabled]}
                onPress={handleCreateAndSelect}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>Continue</Text>
                )}
              </TouchableOpacity>

              {!authState.isAuthenticated && (
                <TouchableOpacity
                  style={[styles.syncDeviceButton, { marginTop: 24 }]}
                  onPress={() => setShowSyncSignIn(true)}
                >
                  <FontAwesome name="cloud-download" size={14} color="#1976D2" />
                  <Text style={styles.syncDeviceButtonText}>Sync from Another Device</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F5F5' },
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  header: { alignItems: 'center', marginTop: 40, marginBottom: 32 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1A1A2E', marginTop: 16 },
  subtitle: { fontSize: 16, color: '#666', marginTop: 6, textAlign: 'center' },
  listSection: { marginTop: 8 },
  formSection: { marginTop: 8 },
  playerCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 16, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  playerCardContent: { flex: 1 },
  playerName: { fontSize: 16, fontWeight: '600', color: '#1A1A2E' },
  playerDetails: { fontSize: 13, color: '#666', marginTop: 2 },
  createNewButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 10, borderWidth: 1.5,
    borderColor: '#2E7D32', borderStyle: 'dashed', marginTop: 8,
  },
  createNewButtonText: { fontSize: 15, fontWeight: '600', color: '#2E7D32' },
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
  primaryButton: {
    backgroundColor: '#2E7D32', paddingVertical: 14, borderRadius: 10,
    alignItems: 'center', marginTop: 24,
  },
  primaryButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 12,
  },
  secondaryButtonText: { fontSize: 15, fontWeight: '600', color: '#2E7D32' },
  buttonDisabled: { opacity: 0.6 },
  syncDeviceButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 10, borderWidth: 1.5,
    borderColor: '#1976D2', borderStyle: 'dashed',
  },
  syncDeviceButtonText: { fontSize: 15, fontWeight: '600', color: '#1976D2' },
  syncStatusCard: {
    backgroundColor: '#FFF', borderRadius: 12, padding: 20, marginTop: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
});
