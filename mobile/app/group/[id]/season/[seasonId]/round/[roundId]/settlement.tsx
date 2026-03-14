import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useGroups } from '@/src/context/GroupContext';
import { usePlayers } from '@/src/context/PlayerContext';
import { getPlayerDisplayName, Player } from '@/src/models/Player';
import { RoundSettlement, SettlementEntry, buildVenmoPayUrl, buildVenmoRequestUrl } from '@/src/services/settlementService';

export default function RoundSettlementScreen() {
  const { id, seasonId, roundId } = useLocalSearchParams<{ id: string; seasonId: string; roundId: string }>();
  const { getRoundSettlement } = useGroups();
  const { state: playerState } = usePlayers();
  const [settlement, setSettlement] = useState<RoundSettlement | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!roundId) return;
      try {
        const result = await getRoundSettlement(roundId);
        setSettlement(result);
      } catch (err: any) {
        Alert.alert('Error', err?.message || 'Failed to load round settlement.');
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [roundId]);

  function getPlayer(playerId: string): Player | undefined {
    return playerState.players.find((p) => p.id === playerId);
  }

  function getPlayerName(playerId: string): string {
    const player = getPlayer(playerId);
    return player ? getPlayerDisplayName(player) : 'Unknown';
  }

  function getShortName(playerId: string): string {
    const player = getPlayer(playerId);
    if (!player) return '?';
    if (player.nickname) return player.nickname;
    return player.firstName;
  }

  function getVenmoHandle(playerId: string): string | undefined {
    return getPlayer(playerId)?.venmoHandle;
  }

  function formatDollars(amount: number): string {
    if (amount >= 0) return `$${amount}`;
    return `-$${Math.abs(amount)}`;
  }

  function formatRoundDate(dateStr: string): string {
    const d = dateStr.split('T')[0];
    const [y, m, day] = d.split('-');
    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    return `${monthNames[parseInt(m)]} ${parseInt(day)}, ${y}`;
  }

  async function handleVenmoPay(entry: SettlementEntry) {
    const toVenmo = getVenmoHandle(entry.toPlayerId);
    if (!toVenmo) {
      Alert.alert('No Venmo', `${getPlayerName(entry.toPlayerId)} doesn't have a Venmo handle set.`);
      return;
    }

    const note = `Golf league - ${settlement?.roundDate || 'Round'} settlement`;
    const urls = buildVenmoPayUrl(toVenmo, entry.amount, note);

    try {
      const canOpen = await Linking.canOpenURL(urls.deepLink);
      await Linking.openURL(canOpen ? urls.deepLink : urls.webFallback);
    } catch {
      Alert.alert('Error', 'Unable to open Venmo. Is the app installed?');
    }
  }

  async function handleVenmoRequest(entry: SettlementEntry) {
    const fromVenmo = getVenmoHandle(entry.fromPlayerId);
    if (!fromVenmo) {
      Alert.alert('No Venmo', `${getPlayerName(entry.fromPlayerId)} doesn't have a Venmo handle set.`);
      return;
    }

    const note = `Golf league - ${settlement?.roundDate || 'Round'} settlement`;
    const urls = buildVenmoRequestUrl(fromVenmo, entry.amount, note);

    try {
      const canOpen = await Linking.canOpenURL(urls.deepLink);
      await Linking.openURL(canOpen ? urls.deepLink : urls.webFallback);
    } catch {
      Alert.alert('Error', 'Unable to open Venmo. Is the app installed?');
    }
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2E7D32" />
      </View>
    );
  }

  if (!settlement) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Failed to load settlement data</Text>
      </View>
    );
  }

  // Sort net amounts: winners first, losers last
  const sortedNets = [...settlement.playerNetAmounts.entries()]
    .sort((a, b) => b[1] - a[1]);

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.headerCard}>
        <Text style={styles.headerTitle}>Round Settlement</Text>
        <Text style={styles.headerSubtitle}>{formatRoundDate(settlement.roundDate)}</Text>
      </View>

      {/* Net Amounts Summary */}
      {sortedNets.length > 0 && (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Net Amounts</Text>
          {sortedNets.map(([playerId, net]) => (
            <View key={playerId} style={styles.summaryRow}>
              <Text style={styles.summaryName}>{getShortName(playerId)}</Text>
              <Text style={[
                styles.summaryAmount,
                net > 0 && styles.amountPositive,
                net < 0 && styles.amountNegative,
              ]}>
                {formatDollars(net)}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Settlement Entries */}
      {settlement.entries.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>
            Payments ({settlement.entries.length})
          </Text>
          {settlement.entries.map((entry, index) => {
            const fromVenmo = getVenmoHandle(entry.fromPlayerId);
            const toVenmo = getVenmoHandle(entry.toPlayerId);

            return (
              <View key={index} style={styles.entryCard}>
                <View style={styles.entryInfo}>
                  <View style={styles.entryNames}>
                    <Text style={styles.entryFrom}>{getPlayerName(entry.fromPlayerId)}</Text>
                    <FontAwesome name="long-arrow-right" size={14} color="#999" style={styles.entryArrow} />
                    <Text style={styles.entryTo}>{getPlayerName(entry.toPlayerId)}</Text>
                  </View>
                  <Text style={styles.entryAmount}>${entry.amount.toFixed(2)}</Text>
                </View>

                <View style={styles.venmoButtons}>
                  {toVenmo && (
                    <TouchableOpacity
                      style={styles.venmoPayButton}
                      onPress={() => handleVenmoPay(entry)}
                    >
                      <FontAwesome name="credit-card" size={13} color="#FFF" />
                      <Text style={styles.venmoButtonText}>Pay @{toVenmo}</Text>
                    </TouchableOpacity>
                  )}
                  {fromVenmo && (
                    <TouchableOpacity
                      style={styles.venmoRequestButton}
                      onPress={() => handleVenmoRequest(entry)}
                    >
                      <FontAwesome name="hand-paper-o" size={13} color="#1565C0" />
                      <Text style={styles.venmoRequestText}>Request from @{fromVenmo}</Text>
                    </TouchableOpacity>
                  )}
                  {!fromVenmo && !toVenmo && (
                    <Text style={styles.noVenmoText}>No Venmo handles set</Text>
                  )}
                </View>
              </View>
            );
          })}

          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Total Pool</Text>
            <Text style={styles.totalAmount}>${settlement.totalPool.toFixed(2)}</Text>
          </View>
        </>
      ) : (
        <View style={styles.evenCard}>
          <FontAwesome name="handshake-o" size={36} color="#2E7D32" />
          <Text style={styles.evenText}>Everyone is even!</Text>
          <Text style={styles.evenSubtext}>No payments needed for this round</Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: '#999' },
  // Header
  headerCard: {
    backgroundColor: '#1565C0', borderRadius: 10, padding: 16, marginBottom: 16,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  headerSubtitle: { fontSize: 14, color: '#BBDEFB', marginTop: 4 },
  // Summary
  summaryCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 14, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  summaryTitle: { fontSize: 14, fontWeight: '600', color: '#1A1A2E', marginBottom: 8 },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4,
  },
  summaryName: { fontSize: 14, color: '#666' },
  summaryAmount: { fontSize: 14, fontWeight: '700', color: '#1A1A2E' },
  amountPositive: { color: '#2E7D32' },
  amountNegative: { color: '#D32F2F' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1A1A2E', marginBottom: 8 },
  // Entry Card
  entryCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  entryInfo: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,
  },
  entryNames: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  entryFrom: { fontSize: 14, fontWeight: '500', color: '#D32F2F' },
  entryArrow: { marginHorizontal: 8 },
  entryTo: { fontSize: 14, fontWeight: '500', color: '#2E7D32' },
  entryAmount: { fontSize: 20, fontWeight: '700', color: '#1A1A2E' },
  venmoButtons: { gap: 6 },
  venmoPayButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#3D95CE', paddingVertical: 10, borderRadius: 8,
  },
  venmoButtonText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  venmoRequestButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#E3F2FD', paddingVertical: 10, borderRadius: 8,
  },
  venmoRequestText: { color: '#1565C0', fontSize: 13, fontWeight: '600' },
  noVenmoText: { fontSize: 12, color: '#999', fontStyle: 'italic', textAlign: 'center' },
  totalCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#E8F5E9', borderRadius: 10, padding: 16, marginTop: 8,
  },
  totalLabel: { fontSize: 16, fontWeight: '600', color: '#2E7D32' },
  totalAmount: { fontSize: 20, fontWeight: '700', color: '#2E7D32' },
  // Even
  evenCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 32, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  evenText: { fontSize: 18, fontWeight: '600', color: '#2E7D32', marginTop: 12 },
  evenSubtext: { fontSize: 14, color: '#999', marginTop: 4, textAlign: 'center' },
});
