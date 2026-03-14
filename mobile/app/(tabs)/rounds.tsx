import React, { useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SectionList, ActivityIndicator,
  Alert, Animated, PanResponder,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useApp } from '@/src/context/AppContext';
import { useRound } from '@/src/context/RoundContext';
import { EnrichedRound } from '@/src/context/RoundContext';

export default function RoundsScreen() {
  const router = useRouter();
  const { state: appState } = useApp();
  const { state: roundState, loadAllRounds, deleteRoundById, isAppOwner } = useRound();

  useFocusEffect(
    useCallback(() => {
      if (appState.isDbReady) {
        loadAllRounds();
      }
    }, [appState.isDbReady]),
  );

  function getStatusColor(status: string): string {
    switch (status) {
      case 'in_progress': return '#FF9800';
      case 'completed': return '#2E7D32';
      case 'setup': return '#2196F3';
      default: return '#999';
    }
  }

  function confirmDeleteRound(roundId: string) {
    Alert.alert('Delete Round', 'Are you sure you want to delete this round?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteRoundById(roundId);
        },
      },
    ]);
  }

  if (roundState.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2E7D32" />
      </View>
    );
  }

  // Split rounds into sections
  const activeRounds = roundState.allRounds.filter(
    (r) => r.status === 'in_progress' || r.status === 'setup',
  );
  const completedRounds = roundState.allRounds.filter(
    (r) => r.status === 'completed',
  );

  const sections: { title: string; data: EnrichedRound[] }[] = [];
  if (activeRounds.length > 0) {
    sections.push({ title: 'Active Rounds', data: activeRounds });
  }
  sections.push({ title: 'Completed Rounds', data: completedRounds });

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.newRoundButton}
        onPress={() => router.push('/round/setup')}
      >
        <FontAwesome name="plus" size={18} color="#FFF" />
        <Text style={styles.newRoundText}>New Round</Text>
      </TouchableOpacity>

      {roundState.allRounds.length === 0 ? (
        <View style={styles.emptyState}>
          <FontAwesome name="flag-o" size={48} color="#CCC" />
          <Text style={styles.emptyText}>No rounds yet</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section: { title } }) => (
            <Text style={styles.sectionHeader}>{title}</Text>
          )}
          renderItem={({ item }) => (
            <SwipeableRoundCard
              round={item}
              statusColor={getStatusColor(item.status)}
              onPress={() => router.push(`/round/${item.id}`)}
              onDelete={isAppOwner ? () => confirmDeleteRound(item.id) : undefined}
            />
          )}
          stickySectionHeadersEnabled={false}
          renderSectionFooter={({ section }) =>
            section.title === 'Completed Rounds' && section.data.length === 0 ? (
              <View style={styles.emptySectionState}>
                <Text style={styles.emptySectionText}>No completed rounds yet</Text>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

function SwipeableRoundCard({
  round,
  statusColor,
  onPress,
  onDelete,
}: {
  round: EnrichedRound;
  statusColor: string;
  onPress: () => void;
  onDelete?: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const canSwipe = onDelete != null;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        canSwipe && Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_, gesture) => {
        if (canSwipe && gesture.dx < 0) {
          translateX.setValue(gesture.dx);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (canSwipe && gesture.dx < -80) {
          Animated.spring(translateX, { toValue: -80, useNativeDriver: true }).start();
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  return (
    <View style={styles.swipeContainer}>
      {canSwipe && (
        <TouchableOpacity style={styles.deleteAction} onPress={onDelete}>
          <FontAwesome name="trash" size={20} color="#FFF" />
        </TouchableOpacity>
      )}
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <TouchableOpacity style={styles.roundCard} onPress={onPress}>
          <View style={styles.roundHeader}>
            <Text style={styles.courseName}>{round.courseName || 'Unknown Course'}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
              <Text style={styles.statusText}>
                {round.status === 'in_progress' ? 'Resume' : round.status.replace('_', ' ')}
              </Text>
            </View>
          </View>
          <Text style={styles.roundMeta}>
            {round.date} — {round.roundType.replace('_', ' ')} — {round.players.length} player{round.players.length !== 1 ? 's' : ''}
          </Text>
          {round.status === 'in_progress' && (
            <Text style={styles.holeInfo}>Currently on Hole {round.currentHole}</Text>
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  newRoundButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#2E7D32', paddingVertical: 12, borderRadius: 10, marginBottom: 16,
  },
  newRoundText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  sectionHeader: {
    fontSize: 16, fontWeight: '700', color: '#1A1A2E', marginTop: 12, marginBottom: 8,
    paddingLeft: 2,
  },
  swipeContainer: { marginBottom: 8, borderRadius: 10, overflow: 'hidden' },
  deleteAction: {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: 80,
    backgroundColor: '#D32F2F', justifyContent: 'center', alignItems: 'center',
    borderRadius: 10,
  },
  roundCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  roundHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  courseName: { fontSize: 16, fontWeight: '600', color: '#1A1A2E', flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusText: { color: '#FFF', fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  roundMeta: { fontSize: 13, color: '#666', marginTop: 4 },
  holeInfo: { fontSize: 13, color: '#2E7D32', fontWeight: '500', marginTop: 2 },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#999', marginTop: 12 },
  emptySectionState: { alignItems: 'center', paddingVertical: 20 },
  emptySectionText: { fontSize: 14, color: '#BBB' },
});
