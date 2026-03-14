import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Player, getPlayerDisplayName } from '../models/Player';

interface PlayerCardProps {
  player: Player;
  onPress?: () => void;
  showHandicap?: boolean;
}

export function PlayerCard({ player, onPress, showHandicap = true }: PlayerCardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} disabled={!onPress}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {player.firstName[0]}{player.lastName[0]}
        </Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.name}>{getPlayerDisplayName(player)}</Text>
        {showHandicap && (
          <Text style={styles.handicap}>Index: {player.handicapIndex.toFixed(1)}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF',
    borderRadius: 10, padding: 12, marginBottom: 8,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#2E7D32',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  avatarText: { color: '#FFF', fontSize: 15, fontWeight: 'bold' },
  info: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: '#1A1A2E' },
  handicap: { fontSize: 13, color: '#666', marginTop: 2 },
});
