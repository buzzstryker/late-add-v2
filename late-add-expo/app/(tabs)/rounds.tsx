import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Header } from '@/components/Header';
import { GroupBanner } from '@/components/GroupBanner';
// GroupSelector removed — group selection now in hamburger drawer
import { AddRoundModal } from '@/components/AddRoundModal';
import { ScorePill } from '@/components/ScorePill';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useDrawer } from '@/contexts/DrawerContext';
import { useGroup } from '@/contexts/GroupContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  ApiError,
  listEvents,
  getStoredAccessToken,
  type EventSummary,
} from '@/lib/api';
import { getApiBase, getSupabaseAnonKey } from '@/lib/config';

type PlayerScore = { player_id: string; player_name: string; points: number };
type RoundScores = Record<string, PlayerScore[]>; // round_id -> scores

function statusEmoji(status: string): string {
  if (status === 'draft') return '\u270F\uFE0F';
  return '\uD83D\uDD12';
}

function formatRoundDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      .toUpperCase();
  } catch {
    return dateStr.toUpperCase();
  }
}

async function fetchRoundScores(roundIds: string[]): Promise<RoundScores> {
  const base = getApiBase().replace(/\/functions\/v1\/?$/, '');
  const token = await getStoredAccessToken();
  const anonKey = getSupabaseAnonKey();
  if (!base || !token || roundIds.length === 0) return {};

  const headers = {
    Authorization: `Bearer ${token}`,
    apikey: anonKey || token,
  };

  const result: RoundScores = {};
  const BATCH = 100;

  for (let i = 0; i < roundIds.length; i += BATCH) {
    const batch = roundIds.slice(i, i + BATCH);
    const inList = batch.map((id) => `"${id}"`).join(',');
    try {
      const res = await fetch(
        `${base}/rest/v1/league_scores?league_round_id=in.(${inList})&select=league_round_id,player_id,score_value,score_override`,
        { headers }
      );
      if (!res.ok) continue;
      const scores: { league_round_id: string; player_id: string; score_value: number | null; score_override: number | null }[] = await res.json();
      for (const s of scores) {
        if (!result[s.league_round_id]) result[s.league_round_id] = [];
        result[s.league_round_id].push({
          player_id: s.player_id,
          player_name: s.player_id, // placeholder — will resolve below
          points: Math.round(s.score_override ?? s.score_value ?? 0),
        });
      }
    } catch {
      // continue
    }
  }

  // Resolve player names
  const allPlayerIds = new Set<string>();
  for (const scores of Object.values(result)) {
    for (const s of scores) allPlayerIds.add(s.player_id);
  }
  if (allPlayerIds.size > 0) {
    try {
      const idList = [...allPlayerIds].map((id) => `"${id}"`).join(',');
      const res = await fetch(
        `${base}/rest/v1/players?id=in.(${idList})&select=id,display_name`,
        { headers: { Authorization: `Bearer ${token}`, apikey: anonKey || token } }
      );
      if (res.ok) {
        const players: { id: string; display_name: string }[] = await res.json();
        const nameMap = new Map(players.map((p) => [p.id, p.display_name]));
        for (const scores of Object.values(result)) {
          for (const s of scores) {
            s.player_name = nameMap.get(s.player_id) ?? s.player_id.slice(0, 8);
          }
        }
      }
    } catch {
      // keep player_id as name
    }
  }

  // Sort each round's scores by points descending
  for (const scores of Object.values(result)) {
    scores.sort((a, b) => b.points - a.points);
  }

  return result;
}

export default function RoundsScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const muted = colors.icon;
  const router = useRouter();
  const { openDrawer } = useDrawer();

  const { selectedGroup, selectedSeason, seasonLabel, reload, dataVersion, invalidateData, isSelectedSeasonActive, isSuperAdmin, isGroupAdmin } = useGroup();

  // Members can only add rounds to active seasons; admins can backfill past seasons
  const canAddRound = isSelectedSeasonActive || isSuperAdmin || (selectedGroup ? isGroupAdmin(selectedGroup.id) : false);

  const [events, setEvents] = useState<EventSummary[]>([]);
  const [roundScores, setRoundScores] = useState<RoundScores>({});
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // showGroupSelector removed — group selection in drawer
  const [showAddRound, setShowAddRound] = useState(false);

  useEffect(() => {
    if (!selectedGroup) {
      setEvents([]);
      setRoundScores({});
      return;
    }
    let cancelled = false;
    setLoadingEvents(true);
    setError(null);
    const params: { group_id?: string; season_id?: string } = { group_id: selectedGroup.id };
    if (selectedSeason) params.season_id = selectedSeason.id;
    listEvents(params)
      .then(async (ev) => {
        if (cancelled) return;
        // Sort newest first
        ev.sort((a, b) => b.round_date.localeCompare(a.round_date));
        setEvents(ev);
        // Fetch scores for all rounds
        const scores = await fetchRoundScores(ev.map((e) => e.id));
        if (!cancelled) setRoundScores(scores);
      })
      .catch((e) => {
        if (!cancelled) {
          setEvents([]);
          setError(e instanceof ApiError ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingEvents(false);
      });
    return () => { cancelled = true; };
  }, [selectedGroup?.id, selectedSeason?.id, dataVersion]);

  const refreshData = useCallback(async () => {
    await reload();
    if (selectedGroup) {
      setLoadingEvents(true);
      const params: { group_id?: string; season_id?: string } = { group_id: selectedGroup.id };
      if (selectedSeason) params.season_id = selectedSeason.id;
      listEvents(params)
        .then(async (ev) => {
          ev.sort((a, b) => b.round_date.localeCompare(a.round_date));
          setEvents(ev);
          const scores = await fetchRoundScores(ev.map((e) => e.id));
          setRoundScores(scores);
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : String(e)))
        .finally(() => setLoadingEvents(false));
    }
  }, [reload, selectedGroup?.id, selectedSeason?.id]);

  const bannerSeasonLabel = selectedSeason
    ? `${seasonLabel(selectedSeason)} Season`
    : 'Season';

  const renderRoundCard = ({ item }: { item: EventSummary }) => {
    const emoji = item.is_tournament ? '\uD83C\uDFC6' : statusEmoji(item.status);
    const dateLabel = formatRoundDate(item.round_date);
    const scores = roundScores[item.id] ?? [];

    return (
      <Pressable
        style={[styles.card, { backgroundColor: colors.card }]}
        onPress={() => router.push(`/round/${item.id}`)}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardDateRow}>
            <Text style={styles.cardEmoji}>{emoji}</Text>
            <View>
              <Text style={[styles.cardDate, { color: colors.tint }]}>{dateLabel}</Text>
              {item.is_tournament ? (
                <Text style={styles.buyinLabel}>{item.tournament_buyin ?? 0} pt buy-in</Text>
              ) : null}
            </View>
            {item.is_signature_event ? (
              <Text style={styles.sigStar}>{'\u2605'}</Text>
            ) : null}
          </View>
          <Pressable hitSlop={8}>
            <Text style={[styles.cardMenu, { color: muted }]}>{'\u2026'}</Text>
          </Pressable>
        </View>

        {scores.length > 0 ? (
          <View style={styles.pillRow}>
            {scores.map((s) => (
              <ScorePill key={s.player_id} name={s.player_name} points={s.points} />
            ))}
          </View>
        ) : (
          <Text style={[styles.cardHint, { color: muted }]}>Tap to view</Text>
        )}
      </Pressable>
    );
  };

  const listHeader = (
    <View style={styles.seasonHeaderRow}>
      <View>
        <Text style={[styles.seasonTitle, { color: colors.text }]}>
          {bannerSeasonLabel}
        </Text>
        {!isSelectedSeasonActive && selectedSeason && (
          <Text style={styles.seasonEndedLabel}>Season ended</Text>
        )}
      </View>
      <View style={styles.seasonActions}>
        {canAddRound && (
          <Pressable style={[styles.addRoundBtn, { backgroundColor: colors.tint }]} onPress={() => setShowAddRound(true)}>
            <Text style={styles.addRoundText}>+ Add Round</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <ThemedView style={styles.screen}>
      <Header title="Rounds" onMenuPress={openDrawer} />

      <GroupBanner
        imageUrl={selectedGroup?.logo_url ?? null}
        groupName={selectedGroup?.name ?? ''}
        seasonLabel={bannerSeasonLabel}
      />

      {error ? (
        <ThemedText style={styles.errorBanner}>{error}</ThemedText>
      ) : null}

      {loadingEvents ? (
        <ActivityIndicator style={styles.spinner} size="large" />
      ) : selectedGroup && events.length === 0 && !error ? (
        <ThemedText style={[styles.empty, { color: muted }]}>
          No rounds found.
        </ThemedText>
      ) : null}

      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        renderItem={renderRoundCard}
        ListHeaderComponent={events.length > 0 ? listHeader : null}
        contentContainerStyle={styles.listContent}
        refreshing={loadingEvents}
        onRefresh={refreshData}
      />

      {/* Group selection is in the hamburger drawer */}

      <AddRoundModal
        visible={showAddRound}
        onClose={() => setShowAddRound(false)}
        onSuccess={() => { invalidateData(); refreshData(); }}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerWrap: { position: 'relative' },
  headerCenter: {
    position: 'absolute', left: 0, right: 0, bottom: 0, top: 0,
    justifyContent: 'center', alignItems: 'center', pointerEvents: 'box-none',
  },
  errorBanner: { color: '#c62828', marginBottom: 8, fontSize: 14, paddingHorizontal: 16 },
  spinner: { marginVertical: 24 },
  empty: { textAlign: 'center', marginTop: 24, fontSize: 15 },
  seasonHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 0, marginBottom: 12,
  },
  seasonTitle: { fontSize: 24, fontWeight: 'bold' },
  seasonEndedLabel: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  seasonActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addRoundBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  addRoundText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  card: {
    borderRadius: 12, padding: 14, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardDateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardEmoji: { fontSize: 14 },
  cardDate: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  sigStar: { fontSize: 14, color: '#DAA520' },
  buyinLabel: { fontSize: 11, color: '#8E8E93', marginTop: 1 },
  cardMenu: { fontSize: 20, fontWeight: '700', lineHeight: 20 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cardHint: { fontSize: 13 },
});
