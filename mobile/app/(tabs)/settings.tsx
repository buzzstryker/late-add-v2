import React, { useEffect, useRef, useState, Component, ErrorInfo, ReactNode } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView,
  Animated, PanResponder, Switch, TextInput, ActivityIndicator, Modal, FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useApp } from '@/src/context/AppContext';
import { useCourses } from '@/src/context/CourseContext';
import { useVoice } from '@/src/context/VoiceContext';
import { usePlayers } from '@/src/context/PlayerContext';
import { useAuth } from '@/src/context/AuthContext';
import { useSync } from '@/src/context/SyncContext';
import { useGroups } from '@/src/context/GroupContext';
import { Course } from '@/src/models/Course';
import { getPlayerDisplayName } from '@/src/models/Player';

// Error boundary to catch silent crashes on iPad
class SettingsErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Settings] Crash:', error.message, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#D32F2F', marginBottom: 8 }}>Settings Error</Text>
          <Text style={{ fontSize: 14, color: '#666', textAlign: 'center' }}>{this.state.error}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function SettingsScreen() {
  return (
    <SettingsErrorBoundary>
      <SettingsContent />
    </SettingsErrorBoundary>
  );
}

function SettingsContent() {
  const { state: appState } = useApp();
  const { state: courseState, loadCourses, deleteCourse } = useCourses();
  const { state: playerState, loadPlayers } = usePlayers();

  useEffect(() => {
    if (appState.isDbReady) {
      loadCourses();
      loadPlayers();
    }
  }, [appState.isDbReady]);

  function confirmDeleteCourse(course: Course) {
    Alert.alert('Delete Course', `Delete "${course.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteCourse(course.id);
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionTitle}>Your Profile</Text>
      <View style={styles.card}>
        <OwnerProfileSection />
      </View>

      <Text style={styles.sectionTitle}>GHIN Account</Text>
      <View style={styles.card}>
        <GhinAccountSection />
      </View>

      <Text style={styles.sectionTitle}>Saved Courses</Text>
      {courseState.courses.length === 0 ? (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.emptyText}>No saved courses</Text>
          </View>
        </View>
      ) : (
        courseState.courses.map((course) => (
          <SwipeableCourseCard
            key={course.id}
            course={course}
            onDelete={() => confirmDeleteCourse(course)}
          />
        ))
      )}

      <Text style={styles.sectionTitle}>App Settings</Text>
      <View style={styles.card}>
        <VoiceSettingsSection />
        <CloudSyncSection />
        <DataCleanupSection />
        <GlideReimportRow />
        <SettingsRow icon="download" label="Export Scores" value="Coming Soon" />
      </View>

      <Text style={styles.sectionTitle}>About</Text>
      <View style={styles.card}>
        <SettingsRow icon="info-circle" label="Version" value="1.0.0" />
        <SettingsRow icon="code" label="Built with" value="Expo + React Native" />
      </View>
    </ScrollView>
  );
}

// ─── Owner Profile Section ───────────────────────────────────────────

function OwnerProfileSection() {
  const { state: playerState, ownerPlayerId, setAppOwner, loadPlayers } = usePlayers();
  const [showPicker, setShowPicker] = useState(false);

  const ownerPlayer = playerState.players.find((p) => p.id === ownerPlayerId);

  async function handleChangeOwner(playerId: string) {
    await setAppOwner(playerId);
    setShowPicker(false);
  }

  if (!ownerPlayer) {
    return (
      <View style={styles.row}>
        <FontAwesome name="user" size={18} color="#999" style={styles.rowIcon} />
        <Text style={styles.rowLabel}>No profile set</Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.row}>
        <FontAwesome name="user" size={18} color="#2E7D32" style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>{getPlayerDisplayName(ownerPlayer)}</Text>
          <Text style={styles.profileSubtext}>
            {ownerPlayer.handicapIndex > 0 ? `HI: ${ownerPlayer.handicapIndex}` : ''}
            {ownerPlayer.ghinNumber ? `  GHIN: ${ownerPlayer.ghinNumber}` : ''}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.changeButton}>
          <Text style={styles.changeButtonText}>Change</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showPicker} animationType="slide" transparent onRequestClose={() => setShowPicker(false)}>
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>Switch Profile</Text>
            <Text style={styles.pickerSubtitle}>Select which player is you</Text>
            <FlatList
              data={playerState.players}
              keyExtractor={(item) => item.id}
              style={styles.pickerList}
              renderItem={({ item }) => {
                const isCurrent = item.id === ownerPlayerId;
                return (
                  <TouchableOpacity
                    style={[styles.pickerItem, isCurrent && styles.pickerItemCurrent]}
                    onPress={() => handleChangeOwner(item.id)}
                  >
                    <Text style={[styles.pickerItemName, isCurrent && styles.pickerItemNameCurrent]}>
                      {getPlayerDisplayName(item)}
                    </Text>
                    {isCurrent && (
                      <FontAwesome name="check" size={14} color="#2E7D32" />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
            <TouchableOpacity style={styles.pickerCloseButton} onPress={() => setShowPicker(false)}>
              <Text style={styles.pickerCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── GHIN Account Section ─────────────────────────────────────────────

function GhinAccountSection() {
  const { ghinConnected, ghinUsername, saveGhinCredentials, clearGhinCredentials } = usePlayers();
  const [showForm, setShowForm] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  async function handleConnect() {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Required', 'Please enter your GHIN number and password.');
      return;
    }

    setIsConnecting(true);
    try {
      const success = await saveGhinCredentials(username.trim(), password.trim());
      if (success) {
        setShowForm(false);
        setUsername('');
        setPassword('');
      } else {
        Alert.alert('Login Failed', 'Invalid GHIN number or password. Please check your credentials and try again.');
      }
    } catch {
      Alert.alert('Error', 'Could not connect to GHIN. Please check your network connection and try again.');
    } finally {
      setIsConnecting(false);
    }
  }

  function handleDisconnect() {
    Alert.alert('Disconnect GHIN', 'Remove stored GHIN credentials? You can reconnect any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => clearGhinCredentials(),
      },
    ]);
  }

  if (ghinConnected) {
    return (
      <View style={styles.row}>
        <FontAwesome name="check-circle" size={18} color="#2E7D32" style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Connected</Text>
          <Text style={styles.ghinSubtext}>{ghinUsername}</Text>
        </View>
        <TouchableOpacity onPress={handleDisconnect} style={styles.disconnectButton}>
          <Text style={styles.disconnectText}>Disconnect</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (showForm) {
    return (
      <View style={styles.ghinForm}>
        <Text style={styles.ghinFormLabel}>GHIN Number</Text>
        <TextInput
          style={styles.ghinFormInput}
          value={username}
          onChangeText={setUsername}
          placeholder="Enter GHIN number"
          keyboardType="number-pad"
          autoCapitalize="none"
          editable={!isConnecting}
        />
        <Text style={styles.ghinFormLabel}>Password</Text>
        <TextInput
          style={styles.ghinFormInput}
          value={password}
          onChangeText={setPassword}
          placeholder="Enter GHIN password"
          secureTextEntry
          autoCapitalize="none"
          editable={!isConnecting}
        />
        <View style={styles.ghinFormButtons}>
          <TouchableOpacity
            style={styles.ghinCancelButton}
            onPress={() => { setShowForm(false); setUsername(''); setPassword(''); }}
            disabled={isConnecting}
          >
            <Text style={styles.ghinCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ghinConnectButton, isConnecting && styles.ghinConnectButtonDisabled]}
            onPress={handleConnect}
            disabled={isConnecting}
          >
            {isConnecting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.ghinConnectText}>Connect</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <FontAwesome name="id-card" size={18} color="#2E7D32" style={styles.rowIcon} />
      <Text style={[styles.rowLabel, { flex: 1 }]}>GHIN Account</Text>
      <TouchableOpacity onPress={() => setShowForm(true)} style={styles.connectButton}>
        <Text style={styles.connectButtonText}>Connect</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Swipeable Course Card ────────────────────────────────────────────

function SwipeableCourseCard({
  course,
  onDelete,
}: {
  course: Course;
  onDelete: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_, gesture) => {
        if (gesture.dx < 0) {
          translateX.setValue(gesture.dx);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx < -80) {
          Animated.spring(translateX, { toValue: -80, useNativeDriver: true }).start();
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  return (
    <View style={styles.swipeContainer}>
      <TouchableOpacity style={styles.deleteAction} onPress={onDelete}>
        <FontAwesome name="trash" size={20} color="#FFF" />
      </TouchableOpacity>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <View style={styles.courseCard}>
          <View style={styles.courseInfo}>
            <Text style={styles.courseName}>{course.name}</Text>
            <Text style={styles.courseDetail}>
              {[course.city, course.state].filter(Boolean).join(', ')}
              {course.numberOfHoles ? ` - ${course.numberOfHoles} holes` : ''}
            </Text>
          </View>
          <Text style={styles.teeCount}>{course.teeBoxes.length} tees</Text>
        </View>
      </Animated.View>
    </View>
  );
}

// ─── Cloud Sync Section ──────────────────────────────────────────────

function CloudSyncSection() {
  const { state: authState, sendMagicLink, signOut } = useAuth();
  const { state: syncState, triggerSync, forceResync } = useSync();
  const [email, setEmail] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);

  async function handleSendLink() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    setIsSending(true);
    try {
      await sendMagicLink(trimmed);
      setLinkSent(true);
    } catch {
      Alert.alert('Error', 'Could not send magic link. Please check your connection and try again.');
    } finally {
      setIsSending(false);
    }
  }

  function handleSignOut() {
    Alert.alert('Sign Out', 'Disconnect cloud sync from this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);
  }

  if (authState.isAuthenticated) {
    const syncStatusText = syncState.isSyncing
      ? 'Syncing...'
      : syncState.syncError
        ? 'Sync failed'
        : syncState.lastSyncAt
          ? `Last synced ${formatTimeAgo(syncState.lastSyncAt)}`
          : 'Not synced yet';

    return (
      <>
        <View style={styles.row}>
          <FontAwesome name="cloud" size={18} color="#2E7D32" style={styles.rowIcon} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Cloud Sync</Text>
            <Text style={styles.ghinSubtext}>{authState.user?.email}</Text>
          </View>
          <TouchableOpacity onPress={handleSignOut} style={styles.disconnectButton}>
            <Text style={styles.disconnectText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.row}>
          {syncState.isSyncing ? (
            <ActivityIndicator size="small" color="#2E7D32" style={styles.rowIcon} />
          ) : (
            <FontAwesome
              name={syncState.syncError ? 'exclamation-circle' : 'check-circle'}
              size={18}
              color={syncState.syncError ? '#D32F2F' : '#999'}
              style={styles.rowIcon}
            />
          )}
          <Text style={[styles.rowLabel, { color: '#666' }]}>{syncStatusText}</Text>
          {!syncState.isSyncing && (
            <TouchableOpacity onPress={triggerSync} style={styles.changeButton}>
              <Text style={styles.changeButtonText}>Sync Now</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.row}>
          <FontAwesome name="refresh" size={18} color="#FF9800" style={styles.rowIcon} />
          <Text style={[styles.rowLabel, { color: '#666' }]}>Push all local data to cloud</Text>
          {!syncState.isSyncing && (
            <TouchableOpacity onPress={forceResync} style={[styles.changeButton, { borderColor: '#FF9800' }]}>
              <Text style={[styles.changeButtonText, { color: '#FF9800' }]}>Force Resync</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.row}>
          <FontAwesome name="trash-o" size={18} color="#D32F2F" style={styles.rowIcon} />
          <Text style={[styles.rowLabel, { color: '#666' }]}>Remove duplicate groups</Text>
          {!isCleaning ? (
            <TouchableOpacity
              onPress={async () => {
                setIsCleaning(true);
                try {
                  const { cleanupDuplicates } = await import('@/src/services/syncService');
                  const result = await cleanupDuplicates(authState.user!.id);
                  Alert.alert(
                    'Cleanup Complete',
                    `Removed ${result.groupsRemoved} duplicate groups and ${result.sectionsRemoved} duplicate sections.`,
                  );
                } catch (err: any) {
                  Alert.alert('Cleanup Error', err?.message ?? 'Failed to clean up duplicates');
                } finally {
                  setIsCleaning(false);
                }
              }}
              style={[styles.changeButton, { borderColor: '#D32F2F' }]}
            >
              <Text style={[styles.changeButtonText, { color: '#D32F2F' }]}>Clean Up</Text>
            </TouchableOpacity>
          ) : (
            <ActivityIndicator size="small" color="#D32F2F" />
          )}
        </View>
      </>
    );
  }

  if (linkSent) {
    return (
      <View style={styles.cloudSyncForm}>
        <FontAwesome name="envelope-o" size={24} color="#2E7D32" style={{ alignSelf: 'center', marginBottom: 8 }} />
        <Text style={[styles.rowLabel, { textAlign: 'center', marginBottom: 4 }]}>Check your email</Text>
        <Text style={[styles.ghinSubtext, { textAlign: 'center', marginBottom: 12 }]}>
          We sent a sign-in link to {email.trim().toLowerCase()}
        </Text>
        <TouchableOpacity onPress={() => { setLinkSent(false); setEmail(''); }}>
          <Text style={[styles.changeButtonText, { textAlign: 'center' }]}>Use a different email</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.cloudSyncForm}>
      <Text style={styles.ghinFormLabel}>Email Address</Text>
      <TextInput
        style={styles.ghinFormInput}
        value={email}
        onChangeText={setEmail}
        placeholder="Enter your email"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!isSending}
      />
      <Text style={[styles.ghinSubtext, { marginTop: 4 }]}>
        Sign in to sync data across your devices
      </Text>
      <View style={styles.ghinFormButtons}>
        <TouchableOpacity
          style={[styles.ghinConnectButton, isSending && styles.ghinConnectButtonDisabled]}
          onPress={handleSendLink}
          disabled={isSending}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text style={styles.ghinConnectText}>Send Magic Link</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Score Reassignment Section ───────────────────────────────────────

function DataCleanupSection() {
  const { getOrphanedScores, reassignScores } = useGroups();
  const { state: playerState, ownerPlayerId } = usePlayers();
  const [isScanning, setIsScanning] = useState(false);
  const [orphans, setOrphans] = useState<{ playerId: string; scoreCount: number }[] | null>(null);
  const [showPicker, setShowPicker] = useState<string | null>(null); // orphaned playerId being assigned
  const [isReassigning, setIsReassigning] = useState(false);

  async function handleScan() {
    setIsScanning(true);
    try {
      const results = await getOrphanedScores();
      setOrphans(results);
      if (results.length === 0) {
        Alert.alert('All Clear', 'All league scores are properly assigned to known players.');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to scan for orphaned scores');
    } finally {
      setIsScanning(false);
    }
  }

  async function handleReassign(fromPlayerId: string, toPlayerId: string) {
    setShowPicker(null);
    setIsReassigning(true);
    try {
      const result = await reassignScores(fromPlayerId, toPlayerId);
      const targetPlayer = playerState.players.find((p) => p.id === toPlayerId);
      const targetName = targetPlayer ? getPlayerDisplayName(targetPlayer) : toPlayerId;
      let message = `Reassigned ${result.reassigned} score${result.reassigned !== 1 ? 's' : ''} to ${targetName}.`;
      if (result.conflicts > 0) {
        message += `\n\n${result.conflicts} score${result.conflicts !== 1 ? 's' : ''} skipped (player already had a score in those rounds).`;
      }
      Alert.alert('Reassignment Complete', message);
      // Re-scan to refresh the list
      const updated = await getOrphanedScores();
      setOrphans(updated);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Reassignment failed');
    } finally {
      setIsReassigning(false);
    }
  }

  // No orphans scanned yet — show scan button
  if (orphans === null) {
    return (
      <View style={styles.row}>
        <FontAwesome name="exchange" size={18} color="#1565C0" style={styles.rowIcon} />
        <Text style={[styles.rowLabel, { color: '#666' }]}>Reassign orphaned scores</Text>
        {!isScanning ? (
          <TouchableOpacity
            onPress={handleScan}
            style={[styles.changeButton, { borderColor: '#1565C0' }]}
          >
            <Text style={[styles.changeButtonText, { color: '#1565C0' }]}>Scan</Text>
          </TouchableOpacity>
        ) : (
          <ActivityIndicator size="small" color="#1565C0" />
        )}
      </View>
    );
  }

  // No orphans found
  if (orphans.length === 0) {
    return (
      <View style={styles.row}>
        <FontAwesome name="check-circle" size={18} color="#2E7D32" style={styles.rowIcon} />
        <Text style={[styles.rowLabel, { color: '#666' }]}>All scores properly assigned</Text>
        <TouchableOpacity
          onPress={handleScan}
          style={[styles.changeButton, { borderColor: '#999' }]}
        >
          <Text style={[styles.changeButtonText, { color: '#999' }]}>Re-scan</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Orphans found — show each with assign option
  return (
    <>
      <View style={[styles.row, { flexDirection: 'column', alignItems: 'flex-start' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <FontAwesome name="exclamation-triangle" size={18} color="#FF9800" style={styles.rowIcon} />
          <Text style={[styles.rowLabel, { color: '#1A1A2E', fontWeight: '600' }]}>
            {orphans.length} orphaned player{orphans.length !== 1 ? 's' : ''} found
          </Text>
        </View>
        {orphans.map((orphan) => (
          <View key={orphan.playerId} style={reassignStyles.orphanRow}>
            <View style={{ flex: 1 }}>
              <Text style={reassignStyles.orphanId} numberOfLines={1}>
                ID: {orphan.playerId.slice(0, 12)}…
              </Text>
              <Text style={reassignStyles.orphanDetail}>
                {orphan.scoreCount} score{orphan.scoreCount !== 1 ? 's' : ''}
              </Text>
            </View>
            {!isReassigning ? (
              <TouchableOpacity
                onPress={() => setShowPicker(orphan.playerId)}
                style={[styles.changeButton, { borderColor: '#1565C0' }]}
              >
                <Text style={[styles.changeButtonText, { color: '#1565C0' }]}>Assign To…</Text>
              </TouchableOpacity>
            ) : (
              <ActivityIndicator size="small" color="#1565C0" />
            )}
          </View>
        ))}
      </View>

      {/* Player picker modal */}
      <Modal
        visible={showPicker !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPicker(null)}
      >
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>Assign Scores To</Text>
            <Text style={styles.pickerSubtitle}>
              Select the player who owns these scores
            </Text>
            <FlatList
              data={playerState.players}
              keyExtractor={(item) => item.id}
              style={styles.pickerList}
              renderItem={({ item }) => {
                const isOwner = item.id === ownerPlayerId;
                return (
                  <TouchableOpacity
                    style={[styles.pickerItem, isOwner && styles.pickerItemCurrent]}
                    onPress={() => handleReassign(showPicker!, item.id)}
                  >
                    <Text style={[styles.pickerItemName, isOwner && styles.pickerItemNameCurrent]}>
                      {getPlayerDisplayName(item)}
                    </Text>
                    {isOwner && (
                      <Text style={{ fontSize: 11, color: '#2E7D32', fontWeight: '600' }}>YOU</Text>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
            <TouchableOpacity style={styles.pickerCloseButton} onPress={() => setShowPicker(null)}>
              <Text style={styles.pickerCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const reassignStyles = StyleSheet.create({
  orphanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    width: '100%',
  },
  orphanId: {
    fontSize: 12,
    fontFamily: 'Courier',
    color: '#666',
  },
  orphanDetail: {
    fontSize: 13,
    color: '#1A1A2E',
    fontWeight: '500',
    marginTop: 2,
  },
});

// ─── Glide Re-import Row ──────────────────────────────────────────────

function GlideReimportRow() {
  const router = useRouter();

  return (
    <View style={styles.row}>
      <FontAwesome name="database" size={18} color="#1565C0" style={styles.rowIcon} />
      <Text style={[styles.rowLabel, { color: '#666' }]}>Glide data import</Text>
      <TouchableOpacity
        onPress={() => router.push('/group/import')}
        style={[styles.changeButton, { borderColor: '#1565C0' }]}
      >
        <Text style={[styles.changeButtonText, { color: '#1565C0' }]}>Import</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Voice Settings ───────────────────────────────────────────────────

function VoiceSettingsSection() {
  const { state: voiceState, updateSettings, requestSttPermission } = useVoice();
  const { settings } = voiceState;

  async function handleSttToggle(enabled: boolean) {
    if (enabled) {
      const granted = await requestSttPermission();
      if (!granted) {
        Alert.alert(
          'Permission Required',
          'Scorekeeper needs microphone and speech recognition permission to enable voice input. Please enable them in your device Settings.',
          [{ text: 'OK' }],
        );
        return;
      }
    }
    await updateSettings({ sttEnabled: enabled });
  }

  return (
    <>
      <View style={styles.row}>
        <FontAwesome name="volume-up" size={18} color="#2E7D32" style={styles.rowIcon} />
        <Text style={styles.rowLabel}>Score Confirmations</Text>
        <Switch
          value={settings.confirmScores}
          onValueChange={(val) => updateSettings({ confirmScores: val, ttsEnabled: val || settings.announceHole })}
          trackColor={{ true: '#2E7D32' }}
        />
      </View>
      <View style={styles.row}>
        <FontAwesome name="bullhorn" size={18} color="#2E7D32" style={styles.rowIcon} />
        <Text style={styles.rowLabel}>Hole Announcements</Text>
        <Switch
          value={settings.announceHole}
          onValueChange={(val) => updateSettings({ announceHole: val, ttsEnabled: val || settings.confirmScores })}
          trackColor={{ true: '#2E7D32' }}
        />
      </View>
      <View style={styles.row}>
        <FontAwesome name="microphone" size={18} color="#2E7D32" style={styles.rowIcon} />
        <Text style={styles.rowLabel}>Voice Input</Text>
        <Switch
          value={settings.sttEnabled}
          onValueChange={handleSttToggle}
          trackColor={{ true: '#2E7D32' }}
        />
      </View>
    </>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── Generic Settings Row ─────────────────────────────────────────────

function SettingsRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <FontAwesome name={icon as any} size={18} color="#2E7D32" style={styles.rowIcon} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5', padding: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1A1A2E', marginBottom: 10, marginTop: 8 },
  card: {
    backgroundColor: '#FFF', borderRadius: 10, overflow: 'hidden', marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  rowIcon: { width: 28 },
  rowLabel: { flex: 1, fontSize: 15, color: '#1A1A2E' },
  rowValue: { fontSize: 14, color: '#666' },
  emptyText: { fontSize: 14, color: '#999' },
  swipeContainer: { marginBottom: 8, borderRadius: 10, overflow: 'hidden' },
  deleteAction: {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: 80,
    backgroundColor: '#D32F2F', justifyContent: 'center', alignItems: 'center',
    borderRadius: 10,
  },
  courseCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  courseInfo: { flex: 1 },
  courseName: { fontSize: 16, fontWeight: '600', color: '#1A1A2E' },
  courseDetail: { fontSize: 13, color: '#666', marginTop: 2 },
  teeCount: { fontSize: 13, color: '#999' },
  // GHIN styles
  ghinSubtext: { fontSize: 12, color: '#666', marginTop: 1 },
  connectButton: {
    backgroundColor: '#2E7D32', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6,
  },
  connectButtonText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  disconnectButton: {
    borderWidth: 1, borderColor: '#D32F2F', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6,
  },
  disconnectText: { color: '#D32F2F', fontSize: 13, fontWeight: '600' },
  cloudSyncForm: { padding: 14 },
  ghinForm: { padding: 14 },
  ghinFormLabel: { fontSize: 13, fontWeight: '600', color: '#1A1A2E', marginBottom: 4, marginTop: 8 },
  ghinFormInput: {
    backgroundColor: '#F5F5F5', borderRadius: 8, padding: 10, fontSize: 15,
    borderWidth: 1, borderColor: '#E0E0E0',
  },
  ghinFormButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  ghinCancelButton: { paddingHorizontal: 16, paddingVertical: 8 },
  ghinCancelText: { color: '#666', fontSize: 14, fontWeight: '500' },
  ghinConnectButton: {
    backgroundColor: '#2E7D32', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 6,
    minWidth: 90, alignItems: 'center',
  },
  ghinConnectButtonDisabled: { opacity: 0.6 },
  ghinConnectText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  // Profile section
  profileSubtext: { fontSize: 12, color: '#666', marginTop: 1 },
  changeButton: {
    borderWidth: 1, borderColor: '#2E7D32', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6,
  },
  changeButtonText: { color: '#2E7D32', fontSize: 13, fontWeight: '600' },
  // Picker modal
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  pickerContent: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, maxHeight: '70%' },
  pickerTitle: { fontSize: 20, fontWeight: 'bold', color: '#1A1A2E', marginBottom: 4 },
  pickerSubtitle: { fontSize: 13, color: '#666', marginBottom: 16 },
  pickerList: { maxHeight: 300 },
  pickerItem: {
    padding: 14, borderRadius: 8, backgroundColor: '#F5F5F5', marginBottom: 6,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  pickerItemCurrent: { backgroundColor: '#E8F5E9', borderWidth: 1, borderColor: '#2E7D32' },
  pickerItemName: { fontSize: 15, fontWeight: '500', color: '#1A1A2E' },
  pickerItemNameCurrent: { color: '#2E7D32', fontWeight: '600' },
  pickerCloseButton: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  pickerCloseText: { fontSize: 15, fontWeight: '600', color: '#666' },
});
