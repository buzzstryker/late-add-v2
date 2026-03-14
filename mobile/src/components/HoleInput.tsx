import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { getScoreLabel } from '../services/handicapService';

interface HoleInputProps {
  playerName: string;
  grossScore: number;
  netScore?: number;
  par: number;
  strokesOnHole: number;
  onIncrement: () => void;
  onDecrement: () => void;
  onSetScore: (score: number) => void;
}

export function HoleInput({
  playerName, grossScore, netScore, par, strokesOnHole,
  onIncrement, onDecrement, onSetScore,
}: HoleInputProps) {
  const diff = grossScore - par;

  function getColor(): string {
    if (diff <= -2) return '#FFD700';
    if (diff === -1) return '#E74C3C';
    if (diff === 0) return '#2E7D32';
    if (diff === 1) return '#3498DB';
    return '#1A1A2E';
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.playerName}>{playerName}</Text>
        {strokesOnHole > 0 && (
          <View style={styles.strokeDots}>
            {Array.from({ length: strokesOnHole }).map((_, i) => (
              <View key={i} style={styles.dot} />
            ))}
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.button} onPress={onDecrement}>
          <FontAwesome name="minus" size={18} color="#D32F2F" />
        </TouchableOpacity>

        <View style={styles.scoreDisplay}>
          <Text style={[styles.score, { color: getColor() }]}>{grossScore}</Text>
          <Text style={styles.label}>{getScoreLabel(grossScore, par)}</Text>
          {netScore !== undefined && (
            <Text style={styles.netScore}>Net: {netScore}</Text>
          )}
        </View>

        <TouchableOpacity style={styles.button} onPress={onIncrement}>
          <FontAwesome name="plus" size={18} color="#2E7D32" />
        </TouchableOpacity>
      </View>

      <View style={styles.quickScores}>
        {Array.from({ length: 7 }, (_, i) => par - 2 + i)
          .filter((s) => s >= 1)
          .map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.quickButton, s === grossScore && styles.quickActive]}
              onPress={() => onSetScore(s)}
            >
              <Text style={[styles.quickText, s === grossScore && styles.quickTextActive]}>
                {s}
              </Text>
            </TouchableOpacity>
          ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  playerName: { fontSize: 16, fontWeight: '600', color: '#1A1A2E' },
  strokeDots: { flexDirection: 'row', gap: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2E7D32' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  button: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#F5F5F5',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E0E0E0',
  },
  scoreDisplay: { alignItems: 'center', minWidth: 80 },
  score: { fontSize: 36, fontWeight: 'bold' },
  label: { fontSize: 12, color: '#666', marginTop: 2 },
  netScore: { fontSize: 12, color: '#999', marginTop: 1 },
  quickScores: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 },
  quickButton: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F5F5',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E0E0E0',
  },
  quickActive: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  quickText: { fontSize: 14, fontWeight: '600', color: '#666' },
  quickTextActive: { color: '#FFF' },
});
