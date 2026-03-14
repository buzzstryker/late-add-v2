import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useRound } from '@/src/context/RoundContext';
import { usePlayers } from '@/src/context/PlayerContext';
import { getPlayerDisplayName } from '@/src/models/Player';
import { getScoreColor, isMainGame, isJunkGame, getGameTypeDisplayName } from '@/src/context/RoundContext';
import { ScoreIndicator } from '@/src/components/ScoreIndicator';

export default function RoundSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, loadRound } = useRound();
  const { state: playerState, loadPlayers } = usePlayers();

  useEffect(() => {
    if (id) {
      loadPlayers();
      loadRound(id);
    }
  }, [id]);

  const { activeRound, activeCourse, scores, gamePoints, bettingGames, isLoading } = state;

  if (isLoading || !activeRound || !activeCourse) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2E7D32" />
        <Text style={styles.loadingText}>Loading summary...</Text>
      </View>
    );
  }

  // Classify games
  const mainGames = bettingGames.filter((g) => isMainGame(g.type));
  const junkGames = bettingGames.filter((g) => isJunkGame(g.type));
  const hasMainAndJunk = mainGames.length > 0 && junkGames.length > 0;
  const mainGameIds = new Set(mainGames.map((g) => g.id));
  const junkGameIds = new Set(junkGames.map((g) => g.id));

  function getPlayerScore(playerId: string, holeNum: number) {
    return scores.find((s) => s.playerId === playerId && s.holeNumber === holeNum);
  }

  function getPlayerTotal(playerId: string) {
    return scores
      .filter((s) => s.playerId === playerId)
      .reduce((sum, s) => sum + s.grossScore, 0);
  }

  function getPlayerNetTotal(playerId: string) {
    return scores
      .filter((s) => s.playerId === playerId)
      .reduce((sum, s) => sum + s.netScore, 0);
  }

  function getPlayerGamePointsTotal(playerId: string) {
    return gamePoints
      .filter((gp) => gp.playerId === playerId)
      .reduce((sum, gp) => sum + gp.points, 0);
  }

  function getPlayerGamePoints(playerId: string, holeNum: number): number {
    return gamePoints
      .filter((gp) => gp.playerId === playerId && gp.holeNumber === holeNum)
      .reduce((sum, gp) => sum + gp.points, 0);
  }

  function getPlayerMainPointsForHole(playerId: string, holeNum: number): number {
    return gamePoints
      .filter((gp) => gp.playerId === playerId && gp.holeNumber === holeNum && gp.gameId && mainGameIds.has(gp.gameId))
      .reduce((sum, gp) => sum + gp.points, 0);
  }

  function getPlayerJunkPointsForHole(playerId: string, holeNum: number): number {
    return gamePoints
      .filter((gp) => gp.playerId === playerId && gp.holeNumber === holeNum && gp.gameId && junkGameIds.has(gp.gameId))
      .reduce((sum, gp) => sum + gp.points, 0);
  }

  function getPlayerMainPointsTotal(playerId: string): number {
    return gamePoints
      .filter((gp) => gp.playerId === playerId && gp.gameId && mainGameIds.has(gp.gameId))
      .reduce((sum, gp) => sum + gp.points, 0);
  }

  function getPlayerJunkPointsTotal(playerId: string): number {
    return gamePoints
      .filter((gp) => gp.playerId === playerId && gp.gameId && junkGameIds.has(gp.gameId))
      .reduce((sum, gp) => sum + gp.points, 0);
  }

  const coursePar = activeCourse.holes.reduce((sum, h) => sum + h.par, 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Round Summary</Text>
      <Text style={styles.subtitle}>{activeCourse.name}</Text>

      {activeRound.players.map((rp) => {
        const player = playerState.players.find((p) => p.id === rp.playerId);
        if (!player) return null;
        const gross = getPlayerTotal(rp.playerId);
        const net = getPlayerNetTotal(rp.playerId);
        const toPar = gross - coursePar;
        const totalPts = getPlayerGamePointsTotal(rp.playerId);
        return (
          <View key={rp.playerId} style={styles.summaryCard}>
            <Text style={styles.summaryName}>{getPlayerDisplayName(player)}</Text>
            <View style={styles.summaryNumbers}>
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>Gross</Text>
                <Text style={styles.summaryValue}>{gross}</Text>
              </View>
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>Net</Text>
                <Text style={styles.summaryValue}>{net}</Text>
              </View>
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>To Par</Text>
                <Text style={[styles.summaryValue, { color: toPar <= 0 ? '#2E7D32' : '#D32F2F' }]}>
                  {toPar > 0 ? '+' : ''}{toPar}
                </Text>
              </View>
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>Points</Text>
                <Text style={[styles.summaryValue, { color: '#6A1B9A' }]}>{totalPts}</Text>
              </View>
            </View>
          </View>
        );
      })}

      {/* Full Scorecard Grid */}
      <Text style={styles.sectionTitle}>Scorecard</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* Header row */}
          <View style={styles.gridRow}>
            <View style={[styles.gridCell, styles.gridHeaderCell, { width: 100 }]}>
              <Text style={styles.gridHeaderText}>Hole</Text>
            </View>
            {activeCourse.holes.map((h) => (
              <View key={h.holeNumber} style={[styles.gridCell, styles.gridHeaderCell]}>
                <Text style={styles.gridHeaderText}>{h.holeNumber}</Text>
              </View>
            ))}
            <View style={[styles.gridCell, styles.gridHeaderCell]}>
              <Text style={styles.gridHeaderText}>Tot</Text>
            </View>
          </View>
          {/* Par row */}
          <View style={styles.gridRow}>
            <View style={[styles.gridCell, { width: 100 }]}>
              <Text style={styles.gridParText}>Par</Text>
            </View>
            {activeCourse.holes.map((h) => (
              <View key={h.holeNumber} style={styles.gridCell}>
                <Text style={styles.gridParText}>{h.par}</Text>
              </View>
            ))}
            <View style={styles.gridCell}>
              <Text style={styles.gridParText}>{coursePar}</Text>
            </View>
          </View>
          {/* Player rows */}
          {activeRound.players.map((rp) => {
            const player = playerState.players.find((p) => p.id === rp.playerId);
            if (!player) return null;
            return (
              <View key={rp.playerId} style={styles.gridRow}>
                <View style={[styles.gridCell, { width: 100 }]}>
                  <Text style={styles.gridPlayerName} numberOfLines={1}>
                    {player.nickname || player.firstName}
                  </Text>
                </View>
                {activeCourse.holes.map((h) => {
                  const score = getPlayerScore(rp.playerId, h.holeNumber);
                  return (
                    <View
                      key={h.holeNumber}
                      style={[
                        styles.gridCell,
                        score && { backgroundColor: getScoreColor(score.grossScore, h.par) + '20' },
                      ]}
                    >
                      {score ? (
                        <ScoreIndicator
                          score={score.grossScore}
                          par={h.par}
                          size={13}
                          color="#1A1A2E"
                        />
                      ) : (
                        <Text style={styles.gridScoreText}>-</Text>
                      )}
                    </View>
                  );
                })}
                <View style={[styles.gridCell, styles.gridTotalCell]}>
                  <Text style={styles.gridTotalText}>{getPlayerTotal(rp.playerId)}</Text>
                </View>
              </View>
            );
          })}

          {/* ── Game Points: Total (all games combined) ── */}
          {/* "Total" header row */}
          <View style={[styles.gridRow, styles.gridGamePointsFirstRow]}>
            <View style={[styles.gridCell, { width: 100 }, styles.gridSectionHeaderCell]}>
              <Text style={[styles.gridSectionHeaderText, styles.gridGamePointsText]}>Tot. Pts</Text>
            </View>
            {activeCourse.holes.map((h) => (
              <View key={h.holeNumber} style={[styles.gridCell, styles.gridSectionHeaderCell]} />
            ))}
            <View style={[styles.gridCell, styles.gridSectionHeaderCell]} />
          </View>
          {activeRound.players.map((rp) => {
            const player = playerState.players.find((p) => p.id === rp.playerId);
            if (!player) return null;
            const gpTotal = getPlayerGamePointsTotal(rp.playerId);
            return (
              <View key={`gp-${rp.playerId}`} style={styles.gridRow}>
                <View style={[styles.gridCell, { width: 100 }]}>
                  <Text style={[styles.gridPlayerName, styles.gridGamePointsText]} numberOfLines={1}>
                    {player.nickname || player.firstName}
                  </Text>
                </View>
                {activeCourse.holes.map((h) => {
                  const pts = getPlayerGamePoints(rp.playerId, h.holeNumber);
                  return (
                    <View key={h.holeNumber} style={styles.gridCell}>
                      <Text style={[styles.gridScoreText, styles.gridGamePointsText]}>
                        {pts !== 0 ? pts : '-'}
                      </Text>
                    </View>
                  );
                })}
                <View style={[styles.gridCell, styles.gridTotalCell]}>
                  <Text style={[styles.gridTotalText, styles.gridGamePointsText]}>{gpTotal || '-'}</Text>
                </View>
              </View>
            );
          })}

          {/* ── Junk Game points rows — only when both main & junk games exist ── */}
          {hasMainAndJunk && (
            <>
              {/* "Junk" header row */}
              <View style={[styles.gridRow, styles.gridGameSubRowFirstRow]}>
                <View style={[styles.gridCell, { width: 100 }, styles.gridSectionHeaderCell]}>
                  <Text style={[styles.gridSectionHeaderText, styles.gridJunkGameText]}>Junk</Text>
                </View>
                {activeCourse.holes.map((h) => (
                  <View key={h.holeNumber} style={[styles.gridCell, styles.gridSectionHeaderCell]} />
                ))}
                <View style={[styles.gridCell, styles.gridSectionHeaderCell]} />
              </View>
              {activeRound.players.map((rp) => {
                const player = playerState.players.find((p) => p.id === rp.playerId);
                if (!player) return null;
                const junkTotal = getPlayerJunkPointsTotal(rp.playerId);
                return (
                  <View key={`junk-${rp.playerId}`} style={styles.gridRow}>
                    <View style={[styles.gridCell, { width: 100 }]}>
                      <Text style={[styles.gridPlayerName, styles.gridJunkGameText]} numberOfLines={1}>
                        {player.nickname || player.firstName}
                      </Text>
                    </View>
                    {activeCourse.holes.map((h) => {
                      const pts = getPlayerJunkPointsForHole(rp.playerId, h.holeNumber);
                      return (
                        <View key={h.holeNumber} style={styles.gridCell}>
                          <Text style={[styles.gridScoreText, styles.gridJunkGameText]}>
                            {pts !== 0 ? pts : '-'}
                          </Text>
                        </View>
                      );
                    })}
                    <View style={[styles.gridCell, styles.gridTotalCell]}>
                      <Text style={[styles.gridTotalText, styles.gridJunkGameText]}>{junkTotal || '-'}</Text>
                    </View>
                  </View>
                );
              })}
            </>
          )}

          {/* ── Main Game points rows — only when both main & junk games exist ── */}
          {hasMainAndJunk && (
            <>
              {/* Main game header row — uses actual game name */}
              <View style={[styles.gridRow, styles.gridGameSubRowFirstRow]}>
                <View style={[styles.gridCell, { width: 100 }, styles.gridSectionHeaderCell]}>
                  <Text style={[styles.gridSectionHeaderText, styles.gridMainGameText]} numberOfLines={1}>
                    {mainGames.map((g) => getGameTypeDisplayName(g.type)).join(', ')}
                  </Text>
                </View>
                {activeCourse.holes.map((h) => (
                  <View key={h.holeNumber} style={[styles.gridCell, styles.gridSectionHeaderCell]} />
                ))}
                <View style={[styles.gridCell, styles.gridSectionHeaderCell]} />
              </View>
              {activeRound.players.map((rp) => {
                const player = playerState.players.find((p) => p.id === rp.playerId);
                if (!player) return null;
                const mainTotal = getPlayerMainPointsTotal(rp.playerId);
                return (
                  <View key={`main-${rp.playerId}`} style={styles.gridRow}>
                    <View style={[styles.gridCell, { width: 100 }]}>
                      <Text style={[styles.gridPlayerName, styles.gridMainGameText]} numberOfLines={1}>
                        {player.nickname || player.firstName}
                      </Text>
                    </View>
                    {activeCourse.holes.map((h) => {
                      const pts = getPlayerMainPointsForHole(rp.playerId, h.holeNumber);
                      return (
                        <View key={h.holeNumber} style={styles.gridCell}>
                          <Text style={[styles.gridScoreText, styles.gridMainGameText]}>
                            {pts !== 0 ? pts : '-'}
                          </Text>
                        </View>
                      );
                    })}
                    <View style={[styles.gridCell, styles.gridTotalCell]}>
                      <Text style={[styles.gridTotalText, styles.gridMainGameText]}>{mainTotal || '-'}</Text>
                    </View>
                  </View>
                );
              })}
            </>
          )}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16, color: '#666' },

  title: { fontSize: 24, fontWeight: 'bold', color: '#1A1A2E' },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 16 },

  summaryCard: {
    backgroundColor: '#FFF', borderRadius: 12, padding: 16, marginBottom: 10,
  },
  summaryName: { fontSize: 16, fontWeight: '600', color: '#1A1A2E', marginBottom: 8 },
  summaryNumbers: { flexDirection: 'row', gap: 20 },
  summaryCol: { alignItems: 'center' },
  summaryLabel: { fontSize: 12, color: '#999' },
  summaryValue: { fontSize: 22, fontWeight: 'bold', color: '#1A1A2E', marginTop: 2 },

  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1A1A2E', marginTop: 20, marginBottom: 10 },
  gridRow: { flexDirection: 'row' },
  gridCell: {
    width: 40, height: 36, alignItems: 'center', justifyContent: 'center',
    borderWidth: 0.5, borderColor: '#E0E0E0',
  },
  gridHeaderCell: { backgroundColor: '#2E7D32' },
  gridHeaderText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  gridParText: { fontSize: 12, color: '#666', fontWeight: '500' },
  gridPlayerName: { fontSize: 11, color: '#1A1A2E', fontWeight: '500' },
  gridScoreText: { fontSize: 13, fontWeight: '600', color: '#1A1A2E' },
  gridTotalCell: { backgroundColor: '#F0F0F0' },
  gridTotalText: { fontSize: 13, fontWeight: 'bold', color: '#1A1A2E' },
  gridGamePointsFirstRow: { borderTopWidth: 2, borderTopColor: '#999' },
  gridGamePointsText: { color: '#6A1B9A' },
  gridGameSubRowFirstRow: { borderTopWidth: 1, borderTopColor: '#D1C4E9' },
  gridMainGameText: { color: '#1565C0' },
  gridJunkGameText: { color: '#E65100' },
  gridSectionHeaderCell: { height: 22 },
  gridSectionHeaderText: { fontSize: 11, fontWeight: '700' },
});
