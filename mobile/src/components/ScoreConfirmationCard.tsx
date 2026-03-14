/**
 * ScoreConfirmationCard — Shows pending voice-parsed scores for user confirmation.
 *
 * Displays each pending score entry with player name, gross score, and spoken term.
 * Auto-confirms after a countdown (default 2s) with a visual progress bar.
 * User can manually confirm or reject before the timer expires.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Platform,
  useWindowDimensions,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';

// ─── Types ──────────────────────────────────────────────────────────────

export interface PendingScoreEntry {
  playerId: string;
  playerDisplayName: string;
  holeNumber: number;
  grossScore: number;
  /** Original spoken term, e.g. "bogey" — shown for clarity */
  spokenTerm?: string;
  holePar: number;
  /** 0.0–1.0 confidence from voice parser (used for auto-confirm timing) */
  confidence?: number;
}

interface Props {
  entries: PendingScoreEntry[];
  onConfirm: () => void;
  onReject: () => void;
  /** Auto-confirm delay in ms. Overrides confidence-based timing if set. */
  autoConfirmMs?: number;
  /** Show "AI" badge when Claude was used for interpretation */
  usedClaude: boolean;
  /** Minimum confidence across all entries (0.0-1.0). Determines auto-confirm speed. */
  confidence?: number;
}

// ─── Component ──────────────────────────────────────────────────────────

/** Compute auto-confirm delay based on parser confidence. */
function getAutoConfirmDelay(confidence?: number, overrideMs?: number): number {
  if (overrideMs !== undefined) return overrideMs;
  if (confidence === undefined) return 4000;
  if (confidence >= 0.95) return 1500;
  if (confidence >= 0.85) return 2500;
  return 4000;
}

export function ScoreConfirmationCard({
  entries,
  onConfirm,
  onReject,
  autoConfirmMs,
  usedClaude,
  confidence,
}: Props) {
  const effectiveDelay = getAutoConfirmDelay(confidence, autoConfirmMs);
  const progressAnim = useRef(new Animated.Value(1)).current;
  const [confirmed, setConfirmed] = useState(false);
  const { width } = useWindowDimensions();
  const isTablet = (Platform as any).isPad === true || width >= 768;

  useEffect(() => {
    // Animate progress bar from 100% → 0%
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: effectiveDelay,
      useNativeDriver: false,
    }).start();

    // Auto-confirm when timer expires
    const timeout = setTimeout(() => {
      if (!confirmed) {
        setConfirmed(true);
        onConfirm();
      }
    }, effectiveDelay);

    return () => {
      clearTimeout(timeout);
    };
  }, []);

  function handleConfirm() {
    if (confirmed) return;
    setConfirmed(true);
    onConfirm();
  }

  function handleReject() {
    if (confirmed) return;
    setConfirmed(true);
    onReject();
  }

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.card, isTablet && styles.cardTablet]}>
      {/* Header */}
      <View style={styles.header}>
        <FontAwesome name="check-circle-o" size={isTablet ? 22 : 16} color="#2E7D32" />
        <Text style={[styles.headerText, isTablet && styles.headerTextTablet]}>Confirm scores?</Text>
        {usedClaude && (
          <View style={styles.aiBadge}>
            <Text style={[styles.aiBadgeText, isTablet && { fontSize: 12 }]}>AI</Text>
          </View>
        )}
      </View>

      {/* Score entries */}
      {entries.map((entry, i) => (
        <View
          key={`${entry.playerId}-${entry.holeNumber}-${i}`}
          style={[styles.entryRow, isTablet && styles.entryRowTablet]}
        >
          <Text style={[styles.playerName, isTablet && styles.playerNameTablet]}>{entry.playerDisplayName}</Text>
          <Text style={[styles.scoreValue, isTablet && styles.scoreValueTablet]}>
            {entry.grossScore}
            {entry.spokenTerm ? ` (${entry.spokenTerm})` : ''}
          </Text>
          <Text style={[styles.holeLabel, isTablet && styles.holeLabelTablet]}>hole {entry.holeNumber}</Text>
        </View>
      ))}

      {/* Progress bar (countdown) */}
      <View style={[styles.progressTrack, isTablet && { height: 5, marginVertical: 12 }]}>
        <Animated.View
          style={[styles.progressFill, { width: progressWidth }]}
        />
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity onPress={handleReject} style={[styles.rejectButton, isTablet && styles.buttonTablet]}>
          <FontAwesome name="times" size={isTablet ? 20 : 16} color="#D32F2F" />
          <Text style={[styles.rejectText, isTablet && styles.buttonTextTablet]}>Reject</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleConfirm} style={[styles.confirmButton, isTablet && styles.buttonTablet]}>
          <FontAwesome name="check" size={isTablet ? 20 : 16} color="#FFF" />
          <Text style={[styles.confirmText, isTablet && styles.buttonTextTablet]}>Confirm</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 12,
    width: '100%',
    borderWidth: 2,
    borderColor: '#2E7D32',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  headerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2E7D32',
    flex: 1,
  },
  aiBadge: {
    backgroundColor: '#E3F2FD',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  aiBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1565C0',
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 8,
  },
  playerName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A2E',
    flex: 1,
  },
  scoreValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1A2E',
  },
  holeLabel: {
    fontSize: 12,
    color: '#666',
  },
  progressTrack: {
    height: 3,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    marginVertical: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#2E7D32',
    borderRadius: 2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  rejectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D32F2F',
  },
  rejectText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D32F2F',
  },
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#2E7D32',
    flex: 1,
    justifyContent: 'center',
  },
  confirmText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },
  // ─── iPad / Tablet overrides ──────────────────────────────
  cardTablet: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 3,
    maxWidth: 500,
    alignSelf: 'center',
  },
  headerTextTablet: {
    fontSize: 20,
  },
  entryRowTablet: {
    paddingVertical: 8,
    gap: 12,
  },
  playerNameTablet: {
    fontSize: 20,
  },
  scoreValueTablet: {
    fontSize: 20,
  },
  holeLabelTablet: {
    fontSize: 15,
  },
  buttonTablet: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  buttonTextTablet: {
    fontSize: 18,
  },
});
