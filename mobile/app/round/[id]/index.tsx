import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Animated, Modal, TextInput, FlatList, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useKeepAwake } from 'expo-keep-awake';
import { useRound } from '@/src/context/RoundContext';
import { usePlayers } from '@/src/context/PlayerContext';
import { getPlayerDisplayName } from '@/src/models/Player';
import { getScoreColor, getScoreLabel, getNetDoubleBogey, isAutoCalculated, isMainGame, isJunkGame, getGameTypeDisplayName, isBaseballCarryHole, hasBaseballCarryInto, getDotPointValue, getAutoAwardDots, getAutoAwardDotDisplayName, AVAILABLE_DOTS, getGreenieWinnerOnHole, getGreenieCarryInfo, getSweepieInfo, getDynamicDotPointValue, calcDynamicDotPoints, getHolesByPar, getWolfForHole, getWolfHittingOrder, getTeamPairingForHole, getPlayerTeam, isTeamRotationBoundary, getSharedJunkPlayerIds, getWolfJunkTeammateIds } from '@/src/context/RoundContext';
import type { GreenieRoundContext } from '@/src/context/RoundContext';
import { DotsConfig, WolfConfig } from '@/src/models/BettingGame';
import { ScoreIndicator } from '@/src/components/ScoreIndicator';
import { useVoice, relativeScoreToAbsolute, parseMultipleScores, parseDotCommand, parseNavigationCommand } from '@/src/context/VoiceContext';
import type { ParsedScoreIntent, ParsedDotIntent, PlayerMatchInfo, RoundVoiceContext } from '@/src/context/VoiceContext';
import { ScoreConfirmationCard, type PendingScoreEntry } from '@/src/components/ScoreConfirmationCard';
import { useDeviceLayout } from '@/src/hooks/useDeviceLayout';

export default function ActiveScorecardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const {
    state, loadRound, startRound, completeRound, deleteRound,
    recordScore, recordGamePoint, recordWolfChoice, getWolfChoiceForHole,
    advanceHole, goToHole, getHoleInfo, getPlayerStrokes,
    roundHoles, splitNines, activeNineIndex, isAppOwner,
  } = useRound();
  const { state: playerState, loadPlayers, ghinConnected, searchGhinCourses, postScoreToGhin, ownerPlayerId } = usePlayers();
  const {
    state: voiceState,
    speakScoreConfirmation,
    speakHoleAnnouncement,
    startListening,
    stopListening,
    clearTranscript,
    parseTranscript,
    parseTranscriptWithClaude,
    parseCommandWithClaude,
    startHandsFreeMode,
    stopHandsFreeMode,
    clearWakeWordCommand,
  } = useVoice();

  // Device layout for iPad-specific rendering
  const { isTablet, isLandscape, screenWidth } = useDeviceLayout();

  // Keep screen awake during active scoring
  useKeepAwake();

  useEffect(() => {
    if (id) {
      loadPlayers();
      loadRound(id);
    }
  }, [id]);

  const { activeRound, activeCourse, scores, gamePoints, bettingGames, isLoading } = state;

  // Classify betting games for display logic
  const hasGames = bettingGames.length > 0;
  const autoCalcGames = bettingGames.filter((g) => isAutoCalculated(g.type));
  const manualGames = bettingGames.filter((g) => !isAutoCalculated(g.type));
  const mainGames = bettingGames.filter((g) => isMainGame(g.type));
  const junkGames = bettingGames.filter((g) => isJunkGame(g.type));
  const hasMainGames = mainGames.length > 0;
  const hasJunkGames = junkGames.length > 0;
  const hasMainAndJunk = hasMainGames && hasJunkGames;
  const mainGameIds = new Set(mainGames.map((g) => g.id));
  const junkGameIds = new Set(junkGames.map((g) => g.id));

  // Junk multiplier (from dots config)
  const junkMultiplier = junkGames.length > 0
    ? (junkGames[0].config as unknown as DotsConfig)?.junkMultiplier ?? 1
    : 1;

  // Baseball game reference (for carry hole detection)
  const baseballGame = bettingGames.find(
    (g) => g.type === 'baseball_3man' || g.type === 'baseball_4man'
  );
  const baseballVariant = baseballGame?.type === 'baseball_3man' ? '3man' as const
    : baseballGame?.type === 'baseball_4man' ? '4man' as const
    : null;

  // 'hole' = single hole entry (initial view), 'scorecard' = nine-hole grid (rest state after scoring)
  const [viewMode, setViewMode] = useState<'hole' | 'scorecard'>('hole');

  // Track which players have confirmed their junk dots on the current hole.
  // Keyed by `${holeNumber}-${playerId}`.  Resets implicitly on hole change
  // because the keys won't match the new hole number.
  const [confirmedDots, setConfirmedDots] = useState<Set<string>>(new Set());

  // Junk Detail expanded state: when true, show dot chips; when false, show summary only.
  // Starts collapsed when revisiting a hole (all players already scored), expands when
  // a player's score is touched.  Collapses per-player on confirm (checkmark) and
  // collapses for all on hole advance.
  const [junkDetailExpanded, setJunkDetailExpanded] = useState(true);

  // ── Wolf Partner Selection State ──
  const [wolfModalVisible, setWolfModalVisible] = useState(false);
  const [wolfModalGameId, setWolfModalGameId] = useState<string | null>(null);

  // ── GHIN Score Posting State ──
  const [ghinModalVisible, setGhinModalVisible] = useState(false);
  const [ghinCourseSearch, setGhinCourseSearch] = useState('');
  const [ghinCourseResults, setGhinCourseResults] = useState<{ facilityId: number; courseId: number; facilityName: string; city?: string; state?: string }[]>([]);
  const [ghinSelectedFacility, setGhinSelectedFacility] = useState<{ facilityId: number; courseId: number; facilityName: string } | null>(null);
  const [ghinSearching, setGhinSearching] = useState(false);
  const [ghinPosting, setGhinPosting] = useState(false);
  const [ghinPosted, setGhinPosted] = useState(false);
  // Two-step flow: 'search' = course selection, 'preview' = dry-run review before actual post
  const [ghinStep, setGhinStep] = useState<'search' | 'preview'>('search');
  const [ghinPostError, setGhinPostError] = useState<string | null>(null);

  // Detect hole changes and decide initial junk detail state
  const prevHoleForJunkRef = useRef<number | null>(null);
  useEffect(() => {
    if (!activeRound) return;
    const hole = activeRound.currentHole;
    if (prevHoleForJunkRef.current !== hole) {
      prevHoleForJunkRef.current = hole;
      // If all players already have scores on this hole, we're revisiting → start collapsed
      const allHaveScores = activeRound.players.every(
        (rp) => scores.some((s) => s.playerId === rp.playerId && s.holeNumber === hole)
      );
      setJunkDetailExpanded(!allHaveScores);
      // Clear confirmed dots for this hole so junk can be re-edited on revisit
      setConfirmedDots((prev) => {
        const next = new Set(prev);
        for (const key of prev) {
          if (key.startsWith(`${hole}-`)) next.delete(key);
        }
        return next.size !== prev.size ? next : prev;
      });
    }
  }, [activeRound?.currentHole, scores]);

  // iPad: default to scorecard view (cart-mounted landscape mode)
  useEffect(() => {
    if (isTablet && activeRound) setViewMode('scorecard');
  }, [isTablet, activeRound?.id]);

  // Switch to landscape when viewing scorecard, portrait otherwise;
  // hide the Stack navigator header in landscape to maximise grid space.
  // iPad: always landscape with header hidden.
  useEffect(() => {
    if (isTablet) {
      // iPad: always landscape; hide header only in scorecard mode
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      navigation.setOptions({ headerShown: viewMode === 'hole' });
      return;
    }
    // Phone: existing behavior unchanged
    if (viewMode === 'scorecard') {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      navigation.setOptions({ headerShown: false });
    } else {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      navigation.setOptions({ headerShown: true });
    }
    // Restore portrait + header when leaving this screen
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      navigation.setOptions({ headerShown: true });
    };
  }, [viewMode, navigation, isTablet]);

  // If somehow the round is still in 'setup' state, auto-start it
  useEffect(() => {
    if (activeRound && activeRound.status === 'setup') {
      startRound();
    }
  }, [activeRound?.status]);

  // Announce hole info when navigating to a new hole (not on initial load)
  const prevHoleRef = React.useRef<number | null>(null);
  useEffect(() => {
    if (!activeRound || !activeCourse) return;
    const currentHoleNum = activeRound.currentHole;
    if (prevHoleRef.current !== null && prevHoleRef.current !== currentHoleNum) {
      const info = getHoleInfo(currentHoleNum);
      if (info) {
        speakHoleAnnouncement(info.holeNumber, info.par, info.strokeIndex);
      }
    }
    prevHoleRef.current = currentHoleNum;
  }, [activeRound?.currentHole]);

  // ── Mic button pulse animation ──
  const micPulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (voiceState.isListening) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(micPulse, { toValue: 1.2, duration: 600, useNativeDriver: true }),
          Animated.timing(micPulse, { toValue: 1.0, duration: 600, useNativeDriver: true }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      micPulse.setValue(1);
    }
  }, [voiceState.isListening]);

  // ── Hands-free mode: start continuous listening when screen is focused ──
  // Only listens while this round screen is the active/visible screen.
  // Stops when navigating away (isFocused=false) and restarts on return.
  // Delayed by 3s on initial start so data load / sync can settle first.
  useEffect(() => {
    if (
      !isFocused ||
      !voiceState.settings.sttEnabled ||
      !activeRound ||
      activeRound.status === 'completed'
    ) {
      // Screen lost focus or round not ready — stop listening
      stopHandsFreeMode();
      return;
    }

    const timer = setTimeout(() => {
      // Build player name list for contextual biasing
      const playerNames = activeRound.players.flatMap((rp) => {
        const player = playerState.players.find((p) => p.id === rp.playerId);
        if (!player) return [];
        return [player.nickname, player.firstName, player.lastName]
          .filter(Boolean) as string[];
      });
      const uniqueNames = [...new Set(playerNames)];

      startHandsFreeMode(uniqueNames);
    }, 3000);

    return () => {
      clearTimeout(timer);
      stopHandsFreeMode();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused, voiceState.settings.sttEnabled, activeRound?.id, activeRound?.status]);

  // ── Voice score parsing & application ──
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const voiceAppliedRef = useRef<string | null>(null);
  const [pendingScores, setPendingScores] = useState<PendingScoreEntry[] | null>(null);
  const [pendingUsedClaude, setPendingUsedClaude] = useState(false);
  const [pendingConfidence, setPendingConfidence] = useState<number | undefined>(undefined);
  // Keep a ref to scores so wake word useEffect always reads latest values
  const scoresRef = useRef(scores);
  scoresRef.current = scores;

  /** Build the round context object needed by Claude API interpretation */
  function buildRoundVoiceContext(): RoundVoiceContext | null {
    if (!activeRound || !activeCourse) return null;
    const currentHoleNum = activeRound.currentHole;
    const hi = getHoleInfo(currentHoleNum);
    return {
      currentHole: currentHoleNum,
      holePar: hi?.par || 4,
      holeStrokeIndex: hi?.strokeIndex || 1,
      players: activeRound.players.map((rp) => {
        const player = playerState.players.find((p) => p.id === rp.playerId);
        const displayName = player ? getPlayerDisplayName(player) : rp.playerId;
        return {
          id: rp.playerId,
          displayName,
          firstName: player?.firstName ?? '',
          lastName: player?.lastName ?? '',
          nickname: player?.nickname,
          courseHandicap: rp.courseHandicap ?? 0,
          playingHandicap: rp.playingHandicap ?? 0,
          hasScoreOnCurrentHole: scores.some(
            (s) => s.playerId === rp.playerId && s.holeNumber === currentHoleNum,
          ),
        };
      }),
      activeBettingGames: bettingGames.map((g) => ({
        type: g.type,
        name: getGameTypeDisplayName(g.type),
      })),
      courseName: activeCourse.name ?? 'Unknown Course',
      roundType: activeRound.roundType ?? 'strokeplay',
    };
  }

  // ── Push-to-talk: parse transcript when listening ends (fallback mode) ──
  useEffect(() => {
    // Skip in hands-free mode — that uses wakeWordCommand instead
    if (voiceState.handsFreeModeActive) return;

    if (
      voiceState.isListening ||
      !voiceState.transcript ||
      !activeRound ||
      !activeCourse ||
      activeRound.status === 'completed'
    ) return;

    // Prevent duplicate application of the same transcript
    if (voiceAppliedRef.current === voiceState.transcript) return;
    voiceAppliedRef.current = voiceState.transcript;

    const currentHoleNum = activeRound.currentHole;
    const holeInfoLocal = getHoleInfo(currentHoleNum);
    const holePar = holeInfoLocal?.par || 4;

    // Build player match info and name list
    const playerMatchInfos: PlayerMatchInfo[] = activeRound.players.map((rp) => {
      const player = playerState.players.find((p) => p.id === rp.playerId);
      return {
        id: rp.playerId,
        displayName: player ? getPlayerDisplayName(player) : rp.playerId,
        firstName: player?.firstName ?? '',
        lastName: player?.lastName ?? '',
        nickname: player?.nickname,
      };
    });

    // Try Claude first (async), fall back to regex
    if (voiceState.claudeAvailable) {
      const roundCtx = buildRoundVoiceContext();
      if (roundCtx) {
        (async () => {
          const { intents, usedClaude } = await parseTranscriptWithClaude(
            roundCtx,
            playerMatchInfos,
            currentHoleNum,
          );
          buildPendingFromIntents(intents, usedClaude, currentHoleNum, holePar, playerMatchInfos);
        })();
        return;
      }
    }

    // Regex-only path (no API key)
    const playerNames = playerMatchInfos.flatMap((p) => [
      p.nickname, p.firstName, p.lastName, p.displayName,
    ].filter(Boolean) as string[]);
    const uniqueNames = [...new Set(playerNames)];
    const intents = parseTranscript(uniqueNames, currentHoleNum, playerMatchInfos);
    buildPendingFromIntents(intents, false, currentHoleNum, holePar, playerMatchInfos);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState.isListening, voiceState.transcript, voiceState.handsFreeModeActive]);

  // ── Hands-free: process wake word command ──
  useEffect(() => {
    const command = voiceState.wakeWordCommand;
    if (
      !command ||
      !activeRound ||
      !activeCourse ||
      activeRound.status === 'completed' ||
      pendingScores // don't process new command while confirmation card is showing
    ) return;

    // Prevent duplicate processing of the same command
    if (voiceAppliedRef.current === command) return;
    voiceAppliedRef.current = command;

    const currentHoleNum = activeRound.currentHole;
    const holeInfoLocal = getHoleInfo(currentHoleNum);
    const holePar = holeInfoLocal?.par || 4;

    const playerMatchInfos: PlayerMatchInfo[] = activeRound.players.map((rp) => {
      const player = playerState.players.find((p) => p.id === rp.playerId);
      return {
        id: rp.playerId,
        displayName: player ? getPlayerDisplayName(player) : rp.playerId,
        firstName: player?.firstName ?? '',
        lastName: player?.lastName ?? '',
        nickname: player?.nickname,
      };
    });

    // Build player name list for regex parsing
    const playerNames = playerMatchInfos.flatMap((p) => [
      p.nickname, p.firstName, p.lastName, p.displayName,
    ].filter(Boolean) as string[]);
    const uniqueNames = [...new Set(playerNames)];

    // ── Navigation commands (e.g. "show hole 8", "go to scorecard view") ──
    const navIntent = parseNavigationCommand(command);
    if (navIntent) {
      if (navIntent.action === 'go_to_hole' && navIntent.holeNumber) {
        goToHole(navIntent.holeNumber);
        setViewMode('hole');
      } else if (navIntent.action === 'show_scorecard') {
        setViewMode('scorecard');
      } else if (navIntent.action === 'show_hole_view') {
        setViewMode('hole');
      }
      clearWakeWordCommand();
      return;
    }

    // ── Try junk dot command first (e.g. "Rage sandy", "Buzz code red") ──
    const dotIntents = parseDotCommand(command, uniqueNames);
    if (dotIntents.length > 0) {
      handleDotIntents(dotIntents, playerMatchInfos, currentHoleNum);
      clearWakeWordCommand();
      return;
    }

    // ── Score parsing: try Claude first (async), fall back to regex ──
    if (voiceState.claudeAvailable) {
      const roundCtx = buildRoundVoiceContext();
      if (roundCtx) {
        (async () => {
          try {
            const { intents, usedClaude } = await parseCommandWithClaude(
              command,
              roundCtx,
              playerMatchInfos,
              currentHoleNum,
            );
            if (intents.length > 0) {
              buildPendingFromIntents(intents, usedClaude, currentHoleNum, holePar, playerMatchInfos);
            } else {
              // Claude returned no intents — fall back to regex
              const regexIntents = parseMultipleScores(command, uniqueNames, currentHoleNum);
              buildPendingFromIntents(regexIntents, false, currentHoleNum, holePar, playerMatchInfos);
            }
          } catch {
            // Claude failed — fall back to regex
            const regexIntents = parseMultipleScores(command, uniqueNames, currentHoleNum);
            buildPendingFromIntents(regexIntents, false, currentHoleNum, holePar, playerMatchInfos);
          }
        })();
        return;
      }
    }

    // Regex-only path — parse command string directly (not state.transcript)
    const intents = parseMultipleScores(command, uniqueNames, currentHoleNum);
    buildPendingFromIntents(intents, false, currentHoleNum, holePar, playerMatchInfos);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState.wakeWordCommand]);

  /** Handle voice-parsed junk dot intents (e.g. "Rage sandy") */
  async function handleDotIntents(
    dotIntents: ParsedDotIntent[],
    playerMatchInfos: PlayerMatchInfo[],
    currentHoleNum: number,
  ) {
    if (!activeRound || junkGames.length === 0) {
      setVoiceFeedback('No junk games active');
      return;
    }

    const feedbackParts: string[] = [];

    for (const intent of dotIntents) {
      // Resolve player ID from spoken name
      let playerId: string | undefined;
      if (intent.playerName) {
        const nameLower = intent.playerName.toLowerCase();
        const match = playerMatchInfos.find((p) =>
          p.displayName.toLowerCase() === nameLower ||
          (p.nickname && p.nickname.toLowerCase() === nameLower) ||
          p.firstName.toLowerCase() === nameLower ||
          p.lastName.toLowerCase() === nameLower
        );
        if (match) playerId = match.id;
      }

      // If no player resolved and only one player, use them
      if (!playerId) {
        if (activeRound.players.length === 1) {
          playerId = activeRound.players[0].playerId;
        }
      }

      if (!playerId) {
        feedbackParts.push(`${intent.dotDisplayName}: unknown player`);
        continue;
      }

      // Toggle the dot via existing handler
      try {
        await handleDotToggle(playerId, intent.dotId);
        const player = playerState.players.find((p) => p.id === playerId);
        const name = player ? (player.nickname || player.firstName) : 'Player';
        feedbackParts.push(`${name}: ${intent.dotDisplayName}`);
      } catch {
        feedbackParts.push(`${intent.dotDisplayName}: Error`);
      }
    }

    if (feedbackParts.length > 0) {
      setVoiceFeedback(feedbackParts.join(' | '));
    } else {
      setVoiceFeedback('Could not understand dot command');
    }
  }

  /** Convert parsed intents into pending score entries for the confirmation card */
  function buildPendingFromIntents(
    intents: ParsedScoreIntent[],
    usedClaude: boolean,
    currentHoleNum: number,
    holePar: number,
    playerMatchInfos: PlayerMatchInfo[],
  ) {
    if (intents.length === 0) {
      setVoiceFeedback('Could not understand. Try again.');
      return;
    }

    const entries: PendingScoreEntry[] = [];
    for (const intent of intents) {
      // Resolve the score
      let grossScore = intent.score;
      if (!grossScore && intent.scoreRelative) {
        grossScore = relativeScoreToAbsolute(intent.scoreRelative, holePar) ?? undefined;
      }
      if (!grossScore) continue;
      grossScore = Math.max(1, Math.min(15, grossScore));

      // Resolve the player — intent.playerName may be a display name ("Mike")
      // or an actual player ID (UUID). First try matching as an ID, then by name.
      let playerId: string | undefined;
      const spokenName = intent.playerName;

      if (spokenName) {
        // Check if it's already a valid player ID
        const directMatch = playerMatchInfos.find((p) => p.id === spokenName);
        if (directMatch) {
          playerId = directMatch.id;
        } else {
          // Match by display name, nickname, first name, or last name (case-insensitive)
          const nameLower = spokenName.toLowerCase();
          const nameMatch = playerMatchInfos.find((p) =>
            p.displayName.toLowerCase() === nameLower ||
            (p.nickname && p.nickname.toLowerCase() === nameLower) ||
            p.firstName.toLowerCase() === nameLower ||
            p.lastName.toLowerCase() === nameLower
          );
          if (nameMatch) {
            playerId = nameMatch.id;
          }
        }
      }

      // If still no player, fall back to first unscored player
      if (!playerId) {
        if (activeRound!.players.length === 1) {
          playerId = activeRound!.players[0].playerId;
        } else {
          const currentScores = scoresRef.current;
          const unscoredPlayer = activeRound!.players.find(
            (rp) => !currentScores.find((s) => s.playerId === rp.playerId && s.holeNumber === currentHoleNum),
          );
          if (unscoredPlayer) playerId = unscoredPlayer.playerId;
        }
      }
      if (!playerId) continue;

      // Resolve display name
      const matchInfo = playerMatchInfos.find((p) => p.id === playerId);
      const player = playerState.players.find((p) => p.id === playerId);
      const displayName = player
        ? (player.nickname || player.firstName)
        : matchInfo?.displayName ?? 'Player';

      entries.push({
        playerId,
        playerDisplayName: displayName,
        holeNumber: currentHoleNum,
        grossScore,
        spokenTerm: intent.scoreRelative || undefined,
        holePar,
        confidence: intent.confidence,
      });
    }

    if (entries.length > 0) {
      // Compute minimum confidence across all entries for auto-confirm timing
      const confidences = entries.map((e) => e.confidence).filter((c): c is number => c !== undefined);
      const minConfidence = confidences.length > 0 ? Math.min(...confidences) : undefined;
      setPendingScores(entries);
      setPendingUsedClaude(usedClaude);
      setPendingConfidence(minConfidence);
      // Auto-switch to hole view so user can verify scores/junk
      if (viewMode === 'scorecard') {
        setViewMode('hole');
      }
    } else {
      setVoiceFeedback('Could not understand. Try again.');
    }
  }

  /** Confirm pending voice-parsed scores — applies each to the round */
  async function handleConfirmScores() {
    if (!pendingScores || !activeRound) return;
    const feedbackParts: string[] = [];
    const successPlayerIds = new Set<string>();
    const currentHoleNum = activeRound.currentHole;

    for (const entry of pendingScores) {
      try {
        const savedScore = await recordScore({
          roundId: activeRound.id,
          playerId: entry.playerId,
          holeNumber: entry.holeNumber,
          grossScore: entry.grossScore,
        });

        successPlayerIds.add(entry.playerId);

        // Auto-award junk dots
        if (hasJunkGames && savedScore) {
          await autoAwardDots(entry.playerId, savedScore.grossScore, savedScore.netScore, entry.holePar);
        }

        // TTS confirmation (use ref for latest scores)
        const existing = scoresRef.current.find(
          (s) => s.playerId === entry.playerId && s.holeNumber === entry.holeNumber,
        );
        if (!existing) {
          speakScoreConfirmation(entry.playerDisplayName, entry.grossScore, entry.holePar, entry.holeNumber);
        }

        const label = entry.spokenTerm || String(entry.grossScore);
        feedbackParts.push(`${entry.playerDisplayName}: ${label}`);
      } catch {
        feedbackParts.push(`${entry.playerDisplayName}: Error`);
      }
    }

    setPendingScores(null);
    voiceAppliedRef.current = null; // allow same command text to be re-spoken
    clearWakeWordCommand(); // resume wake word detection
    if (feedbackParts.length > 0) {
      setVoiceFeedback(feedbackParts.join(' | '));
    }

    // Auto-advance to the next hole if every player now has a score on this hole.
    // Combine previously existing scores with the ones we just successfully recorded.
    const allScored = activeRound.players.every((rp) =>
      successPlayerIds.has(rp.playerId) ||
      scoresRef.current.some((s) => s.playerId === rp.playerId && s.holeNumber === currentHoleNum),
    );
    if (allScored) {
      const last = roundHoles.length > 0 ? roundHoles[roundHoles.length - 1].holeNumber : 18;
      if (currentHoleNum < last) {
        // Small delay so the user sees the feedback before advancing,
        // then switch to scorecard as the rest state
        setTimeout(() => {
          advanceHole();
          setViewMode('scorecard');
        }, 1500);
      }
    }
  }

  /** Reject pending voice-parsed scores — clears without applying */
  function handleRejectScores() {
    setPendingScores(null);
    voiceAppliedRef.current = null; // allow same command text to be re-spoken
    clearWakeWordCommand(); // resume wake word detection
    setVoiceFeedback('Scores rejected');
  }

  // Clear voice feedback after a delay
  useEffect(() => {
    if (voiceFeedback) {
      const timer = setTimeout(() => setVoiceFeedback(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [voiceFeedback]);

  // ── Hooks that must run before early return to maintain consistent hook count ──

  /** Get the active dot IDs from the dots game config */
  const activeDotIds: string[] = junkGames.length > 0
    ? (junkGames[0].config as unknown as DotsConfig)?.activeDots ?? []
    : [];

  /** Greenie round context for dynamic carry/sweepie/ouzel calculations */
  const greenieCtx: GreenieRoundContext = React.useMemo(() => ({
    holes: activeCourse?.holes.map((h) => ({ holeNumber: h.holeNumber, par: h.par })) ?? [],
    junkGamePoints: gamePoints
      .filter((gp) => junkGames.length > 0 && gp.gameId === junkGames[0].id)
      .map((gp) => ({ playerId: gp.playerId, holeNumber: gp.holeNumber, awardedDots: gp.awardedDots })),
    activeDotIds,
    scoredHoleNumbers: new Set(scores.map((s) => s.holeNumber)),
  }), [activeCourse?.holes, gamePoints, junkGames, activeDotIds, scores]);

  // Track previous greenieCtx to detect greenie changes and trigger recalc
  const prevGreenieCtxRef = React.useRef<string>('');

  useEffect(() => {
    if (!hasJunkGames || !activeRound || !activeCourse) return;

    const junkGame = junkGames[0];
    if (!junkGame) return;

    // Build a fingerprint of greenie awards to detect changes
    const greenieFingerprint = JSON.stringify(
      greenieCtx.junkGamePoints
        .filter((gp) => gp.awardedDots?.includes('greenie'))
        .map((gp) => `${gp.holeNumber}:${gp.playerId}`)
        .sort()
    );

    const fingerChanged = greenieFingerprint !== prevGreenieCtxRef.current;
    prevGreenieCtxRef.current = greenieFingerprint;

    // Only run on actual greenie changes (not every gamePoints change)
    if (!fingerChanged) return;

    // Auto-award/remove sweepies
    (async () => {
      for (const parType of [3, 4, 5] as const) {
        const sweepieId = parType === 3 ? 'par3_sweepie' : parType === 4 ? 'par4_sweepie' : 'par5_sweepie';
        if (!activeDotIds.includes(sweepieId)) continue;

        const info = getSweepieInfo(greenieCtx, parType);
        const parHoles = getHolesByPar(greenieCtx.holes, parType);
        if (parHoles.length === 0) continue;
        const lastParHole = parHoles[parHoles.length - 1];

        if (info.earned && info.playerId) {
          // Award sweepie on the last hole of that par type
          const existingDots = getPlayerAwardedDots(info.playerId, lastParHole);
          if (!existingDots.includes(sweepieId)) {
            const newDots = [...existingDots, sweepieId];
            const rawSum = calcRawDotPoints(newDots, lastParHole);
            const effectiveMult = getEffectiveJunkMultiplier(lastParHole);
            try {
              await recordGamePoint({
                roundId: activeRound.id,
                gameId: junkGame.id,
                playerId: info.playerId,
                holeNumber: lastParHole,
                points: Math.round(rawSum * effectiveMult),
                awardedDots: newDots,
              });
            } catch { /* best-effort */ }
          }
        } else {
          // Remove sweepie if no longer earned (greenie was removed)
          for (const rp of activeRound.players) {
            const existingDots = getPlayerAwardedDots(rp.playerId, lastParHole);
            if (existingDots.includes(sweepieId)) {
              const newDots = existingDots.filter((d) => d !== sweepieId);
              const rawSum = calcRawDotPoints(newDots, lastParHole);
              const effectiveMult = getEffectiveJunkMultiplier(lastParHole);
              try {
                await recordGamePoint({
                  roundId: activeRound.id,
                  gameId: junkGame.id,
                  playerId: rp.playerId,
                  holeNumber: lastParHole,
                  points: Math.round(rawSum * effectiveMult),
                  awardedDots: newDots.length > 0 ? newDots : null,
                });
              } catch { /* best-effort */ }
            }
          }
        }
      }

      // Recalculate all junk points (carry values may have shifted)
      await recalculateAllJunkPoints();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greenieCtx]);

  if (isLoading || !activeRound || !activeCourse) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2E7D32" />
        <Text style={styles.loadingText}>Loading scorecard...</Text>
      </View>
    );
  }

  const currentHole = activeRound.currentHole;
  const holeInfo = getHoleInfo(currentHole);
  const isComplete = activeRound.status === 'completed';

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

  function getPlayerNineTotal(playerId: string, holeNumbers: number[]) {
    const set = new Set(holeNumbers);
    return scores
      .filter((s) => s.playerId === playerId && set.has(s.holeNumber))
      .reduce((sum, s) => sum + s.grossScore, 0);
  }

  function getCoursePar() {
    return roundHoles.reduce((sum, h) => sum + h.par, 0);
  }

  function getNinePar(holeNumbers: number[]) {
    return roundHoles
      .filter((h) => holeNumbers.includes(h.holeNumber))
      .reduce((sum, h) => sum + h.par, 0);
  }

  // ── Game point helpers ──

  /** Get game points for a specific game, player, and hole */
  function getPlayerGamePointsForGame(gameId: string | null, playerId: string, holeNum: number): number {
    return gamePoints.find(
      (gp) => gp.gameId === gameId && gp.playerId === playerId && gp.holeNumber === holeNum
    )?.points ?? 0;
  }

  /** Aggregate game points across ALL games for a player on a hole (for scorecard grid) */
  function getPlayerGamePointsAggregate(playerId: string, holeNum: number): number {
    return gamePoints
      .filter((gp) => gp.playerId === playerId && gp.holeNumber === holeNum)
      .reduce((sum, gp) => sum + gp.points, 0);
  }

  function getPlayerGamePointsTotal(playerId: string) {
    return gamePoints
      .filter((gp) => gp.playerId === playerId)
      .reduce((sum, gp) => sum + gp.points, 0);
  }

  function getPlayerGamePointsTotalForGame(gameId: string | null, playerId: string) {
    return gamePoints
      .filter((gp) => gp.gameId === gameId && gp.playerId === playerId)
      .reduce((sum, gp) => sum + gp.points, 0);
  }

  function getPlayerGamePointsNineTotal(playerId: string, holeNumbers: number[]) {
    const set = new Set(holeNumbers);
    return gamePoints
      .filter((gp) => gp.playerId === playerId && set.has(gp.holeNumber))
      .reduce((sum, gp) => sum + gp.points, 0);
  }

  // ── Filtered game point helpers (main vs junk) ──

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

  function getPlayerMainPointsNineTotal(playerId: string, holeNumbers: number[]): number {
    const set = new Set(holeNumbers);
    return gamePoints
      .filter((gp) => gp.playerId === playerId && set.has(gp.holeNumber) && gp.gameId && mainGameIds.has(gp.gameId))
      .reduce((sum, gp) => sum + gp.points, 0);
  }

  function getPlayerJunkPointsNineTotal(playerId: string, holeNumbers: number[]): number {
    const set = new Set(holeNumbers);
    return gamePoints
      .filter((gp) => gp.playerId === playerId && set.has(gp.holeNumber) && gp.gameId && junkGameIds.has(gp.gameId))
      .reduce((sum, gp) => sum + gp.points, 0);
  }

  // ── Baseball carry → junk doubling ──

  /** Whether a hole has accumulated carry from prior all-tie holes — junk is doubled */
  function isCarryHole(holeNum: number): boolean {
    if (!baseballVariant || !activeRound) return false;
    const playerIds = activeRound.players.map((rp) => rp.playerId);
    const holeNumbers = roundHoles.map((h) => h.holeNumber);
    return hasBaseballCarryInto(scores, playerIds, holeNum, holeNumbers, baseballVariant);
  }

  /** Effective junk multiplier for a hole: base junkMultiplier × 2 on carry holes */
  function getEffectiveJunkMultiplier(holeNum: number): number {
    return junkMultiplier * (isCarryHole(holeNum) ? 2 : 1);
  }

  // ── Junk dots eligibility & confirmation ──

  /** Whether a player qualifies for junk dots on a hole (net score <= par) */
  function playerQualifiesForJunk(playerId: string, holeNum: number): boolean {
    const score = getPlayerScore(playerId, holeNum);
    if (!score) return false;
    const hole = activeCourse?.holes.find((h) => h.holeNumber === holeNum);
    if (!hole) return false;
    return score.netScore <= hole.par;
  }

  /** Get all player IDs that qualify for junk on the current hole */
  function getJunkQualifyingPlayerIds(): string[] {
    if (!activeRound) return [];
    return activeRound.players
      .filter((rp) => playerQualifiesForJunk(rp.playerId, currentHole))
      .map((rp) => rp.playerId);
  }

  /** Whether a specific player's dots are confirmed on the current hole */
  function isDotsConfirmed(playerId: string): boolean {
    return confirmedDots.has(`${currentHole}-${playerId}`);
  }

  /** Whether ALL qualifying players have confirmed dots on the current hole */
  function allDotsConfirmed(): boolean {
    const qualifying = getJunkQualifyingPlayerIds();
    if (qualifying.length === 0) return true; // No one qualifies → nothing to confirm
    return qualifying.every((pid) => confirmedDots.has(`${currentHole}-${pid}`));
  }

  /** Confirm a player's dots and check if we should auto-advance */
  async function handleConfirmDots(playerId: string) {
    // Ensure a game point record exists (even if 0) so the dot entry is persisted
    const junkGame = junkGames[0]; // There's only one junk game type (dots)
    if (junkGame) {
      const currentPts = getPlayerGamePointsForGame(junkGame.id, playerId, currentHole);
      const currentDots = getPlayerAwardedDots(playerId, currentHole);
      // Upsert with current value to ensure the record exists in the DB
      try {
        await recordGamePoint({
          roundId: activeRound!.id,
          gameId: junkGame.id,
          playerId,
          holeNumber: currentHole,
          points: currentPts,
          awardedDots: currentDots.length > 0 ? currentDots : null,
        });
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to confirm dots');
        return;
      }
    }

    const newConfirmed = new Set(confirmedDots);
    newConfirmed.add(`${currentHole}-${playerId}`);
    setConfirmedDots(newConfirmed);

    // Check if all qualifying players are now confirmed → auto-advance
    const qualifying = getJunkQualifyingPlayerIds();
    const allNowConfirmed = qualifying.every((pid) => newConfirmed.has(`${currentHole}-${pid}`));
    if (allNowConfirmed) {
      setTimeout(() => handleNextHole(), 400);
    }
  }

  // ── Dot toggle helpers ──

  /** Get the awarded dots array for a player on a specific hole */
  function getPlayerAwardedDots(playerId: string, holeNum: number): string[] {
    const junkGame = junkGames[0];
    if (!junkGame) return [];
    const gp = gamePoints.find(
      (g) => g.gameId === junkGame.id && g.playerId === playerId && g.holeNumber === holeNum
    );
    return gp?.awardedDots ?? [];
  }

  /** Calculate total junk points from awarded dots using dynamic context */
  function calcRawDotPoints(awardedDots: string[], holeNum: number): number {
    return calcDynamicDotPoints(awardedDots, greenieCtx, holeNum);
  }

  /** Persist awarded dots for a single player on a given hole */
  async function persistPlayerDots(pid: string, dots: string[], holeNum: number, gameId: string) {
    const rawSum = calcRawDotPoints(dots, holeNum);
    const effectiveMult = getEffectiveJunkMultiplier(holeNum);
    // Lone wolf 3x junk: check if this player is the lone wolf on this hole
    let loneWolf3xMult = 1;
    const wg = bettingGames.find((g) => g.type === 'wolf');
    if (wg) {
      const wCfg = wg.config as unknown as WolfConfig;
      if (wCfg.loneWolfJunk3x) {
        const wChoice = getWolfChoiceForHole(wg.id, holeNum);
        if (wChoice && wChoice.isLoneWolf && wChoice.wolfPlayerId === pid) {
          loneWolf3xMult = 3;
        }
      }
    }
    const totalPoints = Math.round(rawSum * effectiveMult * loneWolf3xMult);
    await recordGamePoint({
      roundId: activeRound!.id,
      gameId,
      playerId: pid,
      holeNumber: holeNum,
      points: totalPoints,
      awardedDots: dots.length > 0 ? dots : null,
    });
  }

  /** Get junk sharing recipients for a player on the current hole (team match OR wolf). */
  function getJunkRecipients(playerId: string): string[] {
    // Check team match config first
    if (activeRound?.teamConfig) {
      return getSharedJunkPlayerIds(activeRound.teamConfig, playerId, currentHole);
    }
    // Check wolf choices — wolf teams change every hole
    const wolfGames = bettingGames.filter((g) => g.type === 'wolf');
    for (const wg of wolfGames) {
      if (!(wg.config as any)?.sharedJunk) continue;
      const choice = getWolfChoiceForHole(wg.id, currentHole);
      if (choice) {
        const allIds = activeRound?.players.map((rp) => rp.playerId) ?? [];
        const teammates = getWolfJunkTeammateIds(choice, playerId, allIds);
        return [playerId, ...teammates];
      }
    }
    return [playerId];
  }

  /** Toggle a dot on/off for a player and persist (+ shared junk to teammates) */
  async function handleDotToggle(playerId: string, dotId: string) {
    const junkGame = junkGames[0];
    if (!junkGame) return;

    // Greenie and ouzel only allowed on par 3/4/5 holes
    if ((dotId === 'greenie' || dotId === 'ouzel') && holeInfo?.par !== 3 && holeInfo?.par !== 4 && holeInfo?.par !== 5) return;

    const current = getPlayerAwardedDots(playerId, currentHole);
    let newDots: string[];

    if (current.includes(dotId)) {
      newDots = current.filter((d) => d !== dotId);
      // Removing a greenie may invalidate a sweepie — remove it too
      if (dotId === 'greenie') {
        newDots = newDots.filter((d) => d !== 'par3_sweepie' && d !== 'par4_sweepie' && d !== 'par5_sweepie');
      }
    } else {
      newDots = [...current, dotId];
      // Greenie and ouzel are mutually exclusive — ouzel = failed greenie conversion,
      // so awarding one removes the other (and ouzel removes sweepies too)
      if (dotId === 'ouzel') {
        newDots = newDots.filter((d) => d !== 'greenie' && d !== 'par3_sweepie' && d !== 'par4_sweepie' && d !== 'par5_sweepie');
      } else if (dotId === 'greenie') {
        newDots = newDots.filter((d) => d !== 'ouzel');
      }
      // Par 3: sandy and greenie are mutually exclusive (can't hit green from tee AND be in a bunker)
      if (holeInfo?.par === 3) {
        if (dotId === 'sandy') {
          newDots = newDots.filter((d) => d !== 'greenie' && d !== 'par3_sweepie');
        } else if (dotId === 'greenie') {
          newDots = newDots.filter((d) => d !== 'sandy');
        }
      }
    }

    try {
      await persistPlayerDots(playerId, newDots, currentHole, junkGame.id);

      // Shared junk: propagate the same toggle to teammates (team match or wolf)
      {
        const recipients = getJunkRecipients(playerId);
        for (const tmId of recipients) {
          if (tmId === playerId) continue; // already handled above
          const tmCurrent = getPlayerAwardedDots(tmId, currentHole);
          let tmDots: string[];
          if (current.includes(dotId)) {
            // Removing — remove the dot from teammate too
            tmDots = tmCurrent.filter((d) => d !== dotId);
            if (dotId === 'greenie') {
              tmDots = tmDots.filter((d) => d !== 'par3_sweepie' && d !== 'par4_sweepie' && d !== 'par5_sweepie');
            }
          } else {
            // Adding — add the dot to teammate if they don't already have it
            tmDots = tmCurrent.includes(dotId) ? tmCurrent : [...tmCurrent, dotId];
            // Greenie/ouzel mutual exclusion on teammate too
            if (dotId === 'ouzel') {
              tmDots = tmDots.filter((d) => d !== 'greenie' && d !== 'par3_sweepie' && d !== 'par4_sweepie' && d !== 'par5_sweepie');
            } else if (dotId === 'greenie') {
              tmDots = tmDots.filter((d) => d !== 'ouzel');
            }
            // Par 3: sandy/greenie mutual exclusion on teammate too
            if (holeInfo?.par === 3) {
              if (dotId === 'sandy') {
                tmDots = tmDots.filter((d) => d !== 'greenie' && d !== 'par3_sweepie');
              } else if (dotId === 'greenie') {
                tmDots = tmDots.filter((d) => d !== 'sandy');
              }
            }
          }
          try {
            await persistPlayerDots(tmId, tmDots, currentHole, junkGame.id);
          } catch { /* best-effort for teammate */ }
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to record dots');
    }
  }

  /** Auto-award score-based dots after a score is entered/changed */
  async function autoAwardDots(playerId: string, grossScore: number, netScore: number, par: number) {
    const junkGame = junkGames[0];
    if (!junkGame) return;

    const autoDots = getAutoAwardDots(grossScore, netScore, par, activeDotIds);
    const current = getPlayerAwardedDots(playerId, currentHole);

    // All auto-awardable dot IDs (to know which ones to remove if no longer qualifying)
    const allAutoIds = AVAILABLE_DOTS.filter((d) => d.autoAward).map((d) => d.id);

    // Check if shared junk is active (team match or wolf)
    const recipients = getJunkRecipients(playerId);
    const hasSharedJunk = recipients.length > 1;

    if (hasSharedJunk) {
      // Compute the union of auto-dots across ALL teammates from their scores
      const sharedAutoUnion = new Set(autoDots);
      for (const tmId of recipients) {
        if (tmId === playerId) continue;
        const tmScore = getPlayerScore(tmId, currentHole);
        if (tmScore && holeInfo) {
          const tmAuto = getAutoAwardDots(tmScore.grossScore, tmScore.netScore, holeInfo.par, activeDotIds);
          tmAuto.forEach((d) => sharedAutoUnion.add(d));
        }
      }

      // Update every recipient: their manual dots + the shared auto-dot union
      for (const rid of recipients) {
        const ridCurrent = getPlayerAwardedDots(rid, currentHole);
        const manualDots = ridCurrent.filter((d) => !allAutoIds.includes(d));
        const merged = [...manualDots, ...sharedAutoUnion];
        if (merged.length !== ridCurrent.length || !merged.every((d) => ridCurrent.includes(d))) {
          try {
            await persistPlayerDots(rid, merged, currentHole, junkGame.id);
          } catch { /* best-effort */ }
        }
      }
    } else {
      // No shared junk — original single-player logic
      const autoDotSet = new Set(autoDots);
      const merged = [
        ...current.filter((d) => !allAutoIds.includes(d) || autoDotSet.has(d)),
        ...autoDots.filter((d) => !current.includes(d)),
      ];

      if (merged.length === current.length && merged.every((d) => current.includes(d))) return;

      try {
        await persistPlayerDots(playerId, merged, currentHole, junkGame.id);
      } catch (err: any) {
        // Silently fail auto-award — user can manually toggle
      }
    }
  }

  /** Recalculate junk points for all holes that have awarded dots (carry values may have changed) */
  async function recalculateAllJunkPoints() {
    const junkGame = junkGames[0];
    if (!junkGame || !activeRound) return;

    for (const hole of roundHoles) {
      // Lone wolf 3x junk for recalculation
      let recalcWolfChoice: ReturnType<typeof getWolfChoiceForHole> | undefined;
      let recalcLoneWolf3x = false;
      const wg = bettingGames.find((g) => g.type === 'wolf');
      if (wg && (wg.config as unknown as WolfConfig).loneWolfJunk3x) {
        recalcWolfChoice = getWolfChoiceForHole(wg.id, hole.holeNumber);
        recalcLoneWolf3x = !!(recalcWolfChoice && recalcWolfChoice.isLoneWolf);
      }

      for (const rp of activeRound.players) {
        const awarded = getPlayerAwardedDots(rp.playerId, hole.holeNumber);
        if (awarded.length === 0) continue;

        const rawSum = calcRawDotPoints(awarded, hole.holeNumber);
        const effectiveMult = getEffectiveJunkMultiplier(hole.holeNumber);
        const lw3x = recalcLoneWolf3x && recalcWolfChoice?.wolfPlayerId === rp.playerId ? 3 : 1;
        const totalPoints = Math.round(rawSum * effectiveMult * lw3x);

        const currentPts = getPlayerGamePointsForGame(junkGame.id, rp.playerId, hole.holeNumber);
        if (currentPts !== totalPoints) {
          try {
            await recordGamePoint({
              roundId: activeRound.id,
              gameId: junkGame.id,
              playerId: rp.playerId,
              holeNumber: hole.holeNumber,
              points: totalPoints,
              awardedDots: awarded,
            });
          } catch {
            // Best-effort recalculation
          }
        }
      }
    }
  }

  /** Handle manual game point change for a specific game (non-junk games only) */
  async function handleGamePointChange(gameId: string | null, playerId: string, delta: number) {
    const current = getPlayerGamePointsForGame(gameId, playerId, currentHole);
    const newPoints = current + delta;
    if (newPoints === current) return;
    try {
      await recordGamePoint({
        roundId: activeRound!.id,
        gameId,
        playerId,
        holeNumber: currentHole,
        points: newPoints,
      });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to record game points');
    }
  }

  // Check if recording a score for this player completes the hole (all players scored).
  // Only returns true when the score is NEW (first entry), not when editing an existing score.
  // When junk games exist and qualifying players remain, returns false so dots can be confirmed first.
  function shouldAutoAdvance(forPlayerId: string, newGrossScore?: number) {
    if (!activeRound) return false;
    // If this player already has a score on this hole, they're editing — don't advance
    const alreadyHasScore = scores.some(
      (s) => s.playerId === forPlayerId && s.holeNumber === currentHole
    );
    if (alreadyHasScore) return false;

    const playerCount = activeRound.players.length;
    const scoredPlayerIds = new Set(
      scores.filter((s) => s.holeNumber === currentHole).map((s) => s.playerId)
    );
    scoredPlayerIds.add(forPlayerId);
    if (scoredPlayerIds.size < playerCount) return false;

    // All players scored — but if junk games exist, check if anyone qualifies
    if (hasJunkGames && newGrossScore !== undefined) {
      // We need to check if ANY player will qualify for junk after this score is saved.
      // For already-saved scores, use existing data.  For the player being scored now,
      // compute their net score to check qualification.
      const hole = activeCourse?.holes.find((h) => h.holeNumber === currentHole);
      if (hole) {
        const existingQualifiers = activeRound.players.filter((rp) => {
          if (rp.playerId === forPlayerId) {
            // Use the about-to-be-saved gross score for this player
            const strokes = getPlayerStrokes(rp.playerId, currentHole);
            const netScore = newGrossScore - strokes;
            return netScore <= hole.par;
          }
          return playerQualifiesForJunk(rp.playerId, currentHole);
        });
        if (existingQualifiers.length > 0) return false; // Wait for dots confirmation
      }
    }

    return true;
  }

  async function handleScoreChange(playerId: string, delta: number) {
    // Touching a score expands junk detail (e.g. when revisiting a hole)
    if (hasJunkGames && !junkDetailExpanded) setJunkDetailExpanded(true);

    const existing = getPlayerScore(playerId, currentHole);
    const holePar = holeInfo?.par || 4;
    const currentGross = existing?.grossScore || holePar;
    const strokes = getPlayerStrokes(playerId, currentHole);
    const maxScore = getNetDoubleBogey(holePar, strokes);
    const newGross = Math.max(1, Math.min(maxScore, currentGross + delta));
    if (newGross === currentGross && existing) return;
    const willAutoAdvance = !existing && shouldAutoAdvance(playerId, newGross);

    try {
      const savedScore = await recordScore({
        roundId: activeRound!.id,
        playerId,
        holeNumber: currentHole,
        grossScore: newGross,
      });
      // Auto-award score-based junk dots
      if (hasJunkGames && savedScore) {
        await autoAwardDots(playerId, savedScore.grossScore, savedScore.netScore, holePar);
      }
      // TTS: Announce first-time score entry (not edits via +/-)
      if (!existing) {
        const player = playerState.players.find((p) => p.id === playerId);
        if (player) {
          speakScoreConfirmation(player.nickname || player.firstName, newGross, holePar, currentHole);
        }
      }
      if (willAutoAdvance) {
        setTimeout(() => handleNextHole(), 400);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to record score');
    }
  }

  async function handleSetScore(playerId: string, score: number) {
    // Touching a score expands junk detail (e.g. when revisiting a hole)
    if (hasJunkGames && !junkDetailExpanded) setJunkDetailExpanded(true);

    const existing = getPlayerScore(playerId, currentHole);
    const willAutoAdvance = !existing && shouldAutoAdvance(playerId, score);
    const holePar = holeInfo?.par || 4;

    try {
      const savedScore = await recordScore({
        roundId: activeRound!.id,
        playerId,
        holeNumber: currentHole,
        grossScore: score,
      });
      // Auto-award score-based junk dots
      if (hasJunkGames && savedScore) {
        await autoAwardDots(playerId, savedScore.grossScore, savedScore.netScore, holePar);
      }
      // TTS: Announce first-time score entry
      if (!existing) {
        const player = playerState.players.find((p) => p.id === playerId);
        if (player) {
          speakScoreConfirmation(player.nickname || player.firstName, score, holePar, currentHole);
        }
      }
      if (willAutoAdvance) {
        setTimeout(() => handleNextHole(), 400);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to record score');
    }
  }

  function isRoundComplete() {
    if (!activeRound || !activeCourse) return false;
    const totalExpected = activeRound.players.length * roundHoles.length;
    return scores.length >= totalExpected;
  }

  function handleMicPress() {
    // Disable mic during pending confirmation or Claude interpretation
    if (pendingScores || voiceState.isInterpreting) return;
    if (voiceState.isListening) {
      stopListening();
    } else {
      clearTranscript();
      voiceAppliedRef.current = null;
      setVoiceFeedback(null);
      startListening();
    }
  }

  function handleEndRound() {
    const allScored = isRoundComplete();
    const buttons: any[] = [
      {
        text: allScored ? 'Complete Round' : 'Save & Exit',
        isPreferred: true,
        onPress: async () => {
          if (allScored) {
            // Mark completed first, then stay on screen to show completed view
            await completeRound();
          } else {
            // Incomplete — just go back (round stays in_progress)
            router.back();
          }
        },
      },
    ];
    // Only app owner (super_admin) or group admin can delete
    if (isAppOwner) {
      buttons.push({
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteRound();
          router.back();
        },
      });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(
      'End Round',
      allScored
        ? 'All scores recorded. Save this round?'
        : 'Not all scores are recorded. You can resume this round later.',
      buttons,
    );
  }

  const firstHole = roundHoles.length > 0 ? roundHoles[0].holeNumber : 1;
  const lastHole = roundHoles.length > 0 ? roundHoles[roundHoles.length - 1].holeNumber : 18;

  async function handleNextHole() {
    if (currentHole >= lastHole) {
      handleEndRound();
      return;
    }
    await advanceHole();
  }

  async function handlePrevHole() {
    if (currentHole > firstHole) {
      await goToHole(currentHole - 1);
    }
  }

  // ── GHIN Score Posting ──

  async function handleGhinCourseSearch() {
    if (!ghinCourseSearch.trim()) return;
    setGhinSearching(true);
    setGhinPostError(null);
    try {
      const results = await searchGhinCourses(ghinCourseSearch.trim());
      setGhinCourseResults(results);
      if (results.length === 0) {
        setGhinPostError('No courses found. Try a different search.');
      }
    } catch (err: any) {
      setGhinPostError(err.message || 'Course search failed');
    } finally {
      setGhinSearching(false);
    }
  }

  async function openGhinModal() {
    const courseName = activeCourse?.name || '';
    setGhinCourseSearch(courseName);
    setGhinCourseResults([]);
    setGhinSelectedFacility(null);
    setGhinPostError(null);
    setGhinStep('search');
    setGhinModalVisible(true);

    // Auto-search using the course name we already know
    if (courseName) {
      setGhinSearching(true);
      try {
        const results = await searchGhinCourses(courseName);
        setGhinCourseResults(results);
        // Auto-select if there's an exact (case-insensitive) match
        const exact = results.find(
          (r) => r.facilityName.toLowerCase() === courseName.toLowerCase()
        );
        if (exact) {
          setGhinSelectedFacility({ facilityId: exact.facilityId, courseId: exact.courseId, facilityName: exact.facilityName });
        } else if (results.length === 1) {
          // Only one result — auto-select it
          setGhinSelectedFacility({ facilityId: results[0].facilityId, courseId: results[0].courseId, facilityName: results[0].facilityName });
        }
        if (results.length === 0) {
          setGhinPostError('No GHIN course match found. Try editing the search.');
        }
      } catch (err: any) {
        setGhinPostError(err.message || 'Course search failed');
      } finally {
        setGhinSearching(false);
      }
    }
  }

  async function handlePostToGhin() {
    if (!ghinSelectedFacility || !activeRound || !ownerPlayerId) return;
    setGhinPosting(true);
    setGhinPostError(null);

    const ownerPlayer = playerState.players.find((p) => p.id === ownerPlayerId);
    if (!ownerPlayer?.ghinNumber) {
      setGhinPostError('No GHIN number on your profile.');
      setGhinPosting(false);
      return;
    }

    const gross = scores
      .filter((s) => s.playerId === ownerPlayerId)
      .reduce((sum, s) => sum + s.grossScore, 0);
    if (gross === 0) {
      setGhinPostError('No scores recorded for you.');
      setGhinPosting(false);
      return;
    }

    const holesPlayed = activeRound.roundType === 'full_18' ? 18 : 9;
    const playedAt = activeRound.date?.split('T')[0]
      || new Date().toISOString().split('T')[0];

    try {
      await postScoreToGhin({
        ghinNumber: ownerPlayer.ghinNumber,
        facilityId: ghinSelectedFacility.facilityId,
        holesPlayed,
        adjustedGrossScore: gross,
        scoreType: 'Home',
        playedAt,
      });
      setGhinPosted(true);
      setGhinPostError(null);
      Alert.alert('Success', 'Your score was posted to GHIN!');
      setGhinModalVisible(false);
    } catch (err: any) {
      setGhinPostError(err.message || 'Post failed');
    } finally {
      setGhinPosting(false);
    }
  }

  // Dynamic grid sizing — iPad fills full landscape width, phone uses compact defaults
  // iPad landscape ~1194px. Full 18 holes + Name + Out + In + Total = 22 columns.
  // These must be computed before any early return that calls renderScorecardGrid.
  const totalHoleCount = splitNines.reduce((sum, n) => sum + n.holes.length, 0);
  const totalColCount = isTablet ? (totalHoleCount + 1 + splitNines.length + (splitNines.length > 1 ? 1 : 0)) : 0;
  const gridCellW = isTablet && totalColCount > 0 ? Math.floor((screenWidth - 120) / totalColCount) : CELL_W;
  const gridNameW = isTablet ? 110 : NAME_W;
  const gridCellH = isTablet ? 38 : 32;
  const gridFontSize = isTablet ? 14 : 12;
  const gridHeaderFontSize = isTablet ? 13 : 11;

  // Dynamic grid style overrides (iPad uses larger cells/fonts; phone uses defaults)
  const dynCell = { width: gridCellW, height: gridCellH } as const;
  const dynName = { width: gridNameW } as const;
  const dynFont = { fontSize: gridFontSize } as const;
  const dynHeaderFont = { fontSize: gridHeaderFontSize } as const;

  // ── Scorecard grid helper ──
  // frontNineData: when showing only the back nine, pass the front nine here
  //   so an "Out" summary column is prepended to the grid.
  function renderScorecardGrid(
    nines: { label: string; holes: typeof roundHoles }[],
    options: {
      highlightCurrentHole?: boolean;
      tappable?: boolean;
      showGrandTotal?: boolean;
      frontNineData?: { label: string; holes: typeof roundHoles };
      onHoleTap?: (holeNumber: number) => void;
    } = {}
  ) {
    const { highlightCurrentHole = false, tappable = false, showGrandTotal = nines.length > 1, frontNineData, onHoleTap } = options;
    const roundPar = getCoursePar(); // par for all holes in the round
    const frontNinePar = frontNineData ? frontNineData.holes.reduce((s, h) => s + h.par, 0) : 0;

    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* Header row: Hole numbers */}
          <View style={styles.gridRow}>
            <View style={[styles.gridCell, dynCell, styles.gridNameCell, dynName, styles.gridHeaderCell]}>
              <Text style={[styles.gridHeaderText, dynHeaderFont]}>Hole</Text>
            </View>
            {frontNineData && (
              <View style={[styles.gridCell, dynCell, styles.gridHeaderCell, styles.gridTotalCell]}>
                <Text style={[styles.gridHeaderText, dynHeaderFont]}>{frontNineData.label}</Text>
              </View>
            )}
            {nines.map((nine) => (
              <React.Fragment key={nine.label}>
                {nine.holes.map((h) => (
                  <View
                    key={h.holeNumber}
                    style={[
                      styles.gridCell, dynCell, styles.gridHeaderCell,
                      highlightCurrentHole && h.holeNumber === currentHole && styles.gridCurrentHoleHeader,
                    ]}
                  >
                    <Text style={[styles.gridHeaderText, dynHeaderFont]}>{h.holeNumber}</Text>
                  </View>
                ))}
                <View style={[styles.gridCell, dynCell, styles.gridHeaderCell, styles.gridTotalCell]}>
                  <Text style={[styles.gridHeaderText, dynHeaderFont]}>{nine.label}</Text>
                </View>
              </React.Fragment>
            ))}
            {showGrandTotal && (
              <View style={[styles.gridCell, dynCell, styles.gridHeaderCell, styles.gridGrandTotalCell]}>
                <Text style={[styles.gridHeaderText, dynHeaderFont]}>Tot</Text>
              </View>
            )}
          </View>

          {/* Par row */}
          <View style={styles.gridRow}>
            <View style={[styles.gridCell, dynCell, styles.gridNameCell, dynName]}>
              <Text style={[styles.gridParText, dynFont]}>Par</Text>
            </View>
            {frontNineData && (
              <View style={[styles.gridCell, dynCell, styles.gridTotalCell]}>
                <Text style={[styles.gridParText, dynFont]}>{frontNinePar}</Text>
              </View>
            )}
            {nines.map((nine) => (
              <React.Fragment key={nine.label}>
                {nine.holes.map((h) => (
                  <View
                    key={h.holeNumber}
                    style={[
                      styles.gridCell, dynCell,
                      highlightCurrentHole && h.holeNumber === currentHole && styles.gridCurrentHoleCol,
                    ]}
                  >
                    <Text style={[styles.gridParText, dynFont]}>{h.par}</Text>
                  </View>
                ))}
                <View style={[styles.gridCell, dynCell, styles.gridTotalCell]}>
                  <Text style={[styles.gridParText, dynFont]}>
                    {nine.holes.reduce((s, h) => s + h.par, 0)}
                  </Text>
                </View>
              </React.Fragment>
            ))}
            {showGrandTotal && (
              <View style={[styles.gridCell, dynCell, styles.gridGrandTotalCell]}>
                <Text style={[styles.gridParText, dynFont]}>{roundPar}</Text>
              </View>
            )}
          </View>

          {/* Handicap (SI) row */}
          <View style={styles.gridRow}>
            <View style={[styles.gridCell, dynCell, styles.gridNameCell, dynName]}>
              <Text style={[styles.gridHdcpText, dynFont]}>Hdcp</Text>
            </View>
            {frontNineData && (
              <View style={[styles.gridCell, dynCell, styles.gridTotalCell]}>
                <Text style={[styles.gridHdcpText, dynFont]} />
              </View>
            )}
            {nines.map((nine) => (
              <React.Fragment key={nine.label}>
                {nine.holes.map((h) => (
                  <View
                    key={h.holeNumber}
                    style={[
                      styles.gridCell, dynCell,
                      highlightCurrentHole && h.holeNumber === currentHole && styles.gridCurrentHoleCol,
                    ]}
                  >
                    <Text style={[styles.gridHdcpText, dynFont]}>{h.strokeIndex}</Text>
                  </View>
                ))}
                <View style={[styles.gridCell, dynCell, styles.gridTotalCell]}>
                  <Text style={[styles.gridHdcpText, dynFont]} />
                </View>
              </React.Fragment>
            ))}
            {showGrandTotal && (
              <View style={[styles.gridCell, dynCell, styles.gridGrandTotalCell]}>
                <Text style={[styles.gridHdcpText, dynFont]} />
              </View>
            )}
          </View>

          {/* Player rows */}
          {activeRound!.players.map((rp) => {
            const player = playerState.players.find((p) => p.id === rp.playerId);
            if (!player) return null;
            const grandTotal = getPlayerTotal(rp.playerId);
            const frontNineTotal = frontNineData
              ? getPlayerNineTotal(rp.playerId, frontNineData.holes.map((h) => h.holeNumber))
              : 0;
            return (
              <View key={rp.playerId} style={styles.gridRow}>
                <View style={[styles.gridCell, dynCell, styles.gridNameCell, dynName]}>
                  <Text style={[styles.gridPlayerName, dynFont]} numberOfLines={1}>
                    {player.nickname || player.firstName}
                  </Text>
                </View>
                {frontNineData && (
                  <View style={[styles.gridCell, dynCell, styles.gridTotalCell]}>
                    <Text style={[styles.gridTotalText, dynFont]}>{frontNineTotal || '-'}</Text>
                  </View>
                )}
                {nines.map((nine) => {
                  const nineTotal = getPlayerNineTotal(
                    rp.playerId,
                    nine.holes.map((h) => h.holeNumber)
                  );
                  return (
                    <React.Fragment key={nine.label}>
                      {nine.holes.map((h) => {
                        const score = getPlayerScore(rp.playerId, h.holeNumber);
                        const isCurrentCell = highlightCurrentHole && h.holeNumber === currentHole;
                        const strokes = getPlayerStrokes(rp.playerId, h.holeNumber);
                        return (
                          <TouchableOpacity
                            key={h.holeNumber}
                            disabled={!tappable}
                            onPress={() => tappable && (onHoleTap ? onHoleTap(h.holeNumber) : goToHole(h.holeNumber))}
                            style={[
                              styles.gridCell, dynCell,
                              isCurrentCell && styles.gridCurrentHoleCol,
                              score && { backgroundColor: getScoreColor(score.grossScore, h.par) + '20' },
                            ]}
                          >
                            {strokes > 0 && (
                              <View style={styles.gridStrokeDots}>
                                {Array.from({ length: strokes }).map((_, i) => (
                                  <View key={i} style={styles.gridStrokeDot} />
                                ))}
                              </View>
                            )}
                            {score ? (
                              <ScoreIndicator
                                score={score.grossScore}
                                par={h.par}
                                size={gridFontSize}
                                color="#1A1A2E"
                                fontWeight={isCurrentCell ? 'bold' : '600'}
                              />
                            ) : (
                              <Text style={[
                                styles.gridScoreText, dynFont,
                                isCurrentCell && styles.gridCurrentHoleText,
                              ]}>-</Text>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                      <View style={[styles.gridCell, dynCell, styles.gridTotalCell]}>
                        <Text style={[styles.gridTotalText, dynFont]}>{nineTotal || '-'}</Text>
                      </View>
                    </React.Fragment>
                  );
                })}
                {showGrandTotal && (
                  <View style={[styles.gridCell, dynCell, styles.gridGrandTotalCell]}>
                    <Text style={[styles.gridGrandTotalText, dynFont]}>{grandTotal || '-'}</Text>
                  </View>
                )}
              </View>
            );
          })}

          {/* ── Game Points: Total (all games combined) ── */}
          {hasGames && (
            <>
              {/* "Total" header row */}
              <View style={[styles.gridRow, styles.gridSectionHeaderRow, styles.gridGamePointsFirstRow]}>
                <View style={[styles.gridCell, dynCell, styles.gridNameCell, dynName, styles.gridSectionHeaderCell]}>
                  <Text style={[styles.gridSectionHeaderText, dynFont, styles.gridGamePointsText]}>Tot. Pts</Text>
                </View>
                {frontNineData && <View style={[styles.gridCell, dynCell, styles.gridSectionHeaderCell]} />}
                {nines.map((nine) => (
                  <React.Fragment key={nine.label}>
                    {nine.holes.map((h) => (
                      <View key={h.holeNumber} style={[styles.gridCell, dynCell, styles.gridSectionHeaderCell]} />
                    ))}
                    <View style={[styles.gridCell, dynCell, styles.gridSectionHeaderCell]} />
                  </React.Fragment>
                ))}
                {showGrandTotal && <View style={[styles.gridCell, dynCell, styles.gridSectionHeaderCell]} />}
              </View>
              {activeRound!.players.map((rp) => {
                const player = playerState.players.find((p) => p.id === rp.playerId);
                if (!player) return null;
                const gpGrandTotal = getPlayerGamePointsTotal(rp.playerId);
                const gpFrontNineTotal = frontNineData
                  ? getPlayerGamePointsNineTotal(rp.playerId, frontNineData.holes.map((h) => h.holeNumber))
                  : 0;
                return (
                  <View key={`gp-${rp.playerId}`} style={styles.gridRow}>
                    <View style={[styles.gridCell, dynCell, styles.gridNameCell, dynName]}>
                      <Text style={[styles.gridPlayerName, dynFont, styles.gridGamePointsText]} numberOfLines={1}>
                        {player.nickname || player.firstName}
                      </Text>
                    </View>
                    {frontNineData && (
                      <View style={[styles.gridCell, dynCell, styles.gridTotalCell]}>
                        <Text style={[styles.gridTotalText, dynFont, styles.gridGamePointsText]}>{gpFrontNineTotal || '-'}</Text>
                      </View>
                    )}
                    {nines.map((nine) => {
                      const gpNineTotal = getPlayerGamePointsNineTotal(
                        rp.playerId,
                        nine.holes.map((h) => h.holeNumber)
                      );
                      return (
                        <React.Fragment key={nine.label}>
                          {nine.holes.map((h) => {
                            const pts = getPlayerGamePointsAggregate(rp.playerId, h.holeNumber);
                            const isCurrentCell = highlightCurrentHole && h.holeNumber === currentHole;
                            return (
                              <View
                                key={h.holeNumber}
                                style={[
                                  styles.gridCell, dynCell,
                                  isCurrentCell && styles.gridCurrentHoleCol,
                                ]}
                              >
                                <Text style={[
                                  styles.gridScoreText, dynFont,
                                  styles.gridGamePointsText,
                                  isCurrentCell && styles.gridCurrentHoleText,
                                ]}>
                                  {pts !== 0 ? pts : '-'}
                                </Text>
                              </View>
                            );
                          })}
                          <View style={[styles.gridCell, dynCell, styles.gridTotalCell]}>
                            <Text style={[styles.gridTotalText, dynFont, styles.gridGamePointsText]}>{gpNineTotal || '-'}</Text>
                          </View>
                        </React.Fragment>
                      );
                    })}
                    {showGrandTotal && (
                      <View style={[styles.gridCell, dynCell, styles.gridGrandTotalCell]}>
                        <Text style={[styles.gridGrandTotalText, dynFont, styles.gridGamePointsText]}>{gpGrandTotal || '-'}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}

          {/* ── Junk Game points rows — only when both main & junk games exist ── */}
          {hasMainAndJunk && (
            <>
              {/* "Junk" header row */}
              <View style={[styles.gridRow, styles.gridSectionHeaderRow, styles.gridGameSubRowFirstRow]}>
                <View style={[styles.gridCell, dynCell, styles.gridNameCell, dynName, styles.gridSectionHeaderCell]}>
                  <Text style={[styles.gridSectionHeaderText, dynFont, styles.gridJunkGameText]}>Junk</Text>
                </View>
                {frontNineData && <View style={[styles.gridCell, dynCell, styles.gridSectionHeaderCell]} />}
                {nines.map((nine) => (
                  <React.Fragment key={nine.label}>
                    {nine.holes.map((h) => (
                      <View key={h.holeNumber} style={[styles.gridCell, dynCell, styles.gridSectionHeaderCell]} />
                    ))}
                    <View style={[styles.gridCell, dynCell, styles.gridSectionHeaderCell]} />
                  </React.Fragment>
                ))}
                {showGrandTotal && <View style={[styles.gridCell, dynCell, styles.gridSectionHeaderCell]} />}
              </View>
              {activeRound!.players.map((rp) => {
                const player = playerState.players.find((p) => p.id === rp.playerId);
                if (!player) return null;
                const junkTotal = getPlayerJunkPointsTotal(rp.playerId);
                const junkFrontNine = frontNineData
                  ? getPlayerJunkPointsNineTotal(rp.playerId, frontNineData.holes.map((h) => h.holeNumber))
                  : 0;
                return (
                  <View key={`junk-${rp.playerId}`} style={styles.gridRow}>
                    <View style={[styles.gridCell, dynCell, styles.gridNameCell, dynName]}>
                      <Text style={[styles.gridPlayerName, dynFont, styles.gridJunkGameText]} numberOfLines={1}>
                        {player.nickname || player.firstName}
                      </Text>
                    </View>
                    {frontNineData && (
                      <View style={[styles.gridCell, dynCell, styles.gridTotalCell]}>
                        <Text style={[styles.gridTotalText, dynFont, styles.gridJunkGameText]}>{junkFrontNine || '-'}</Text>
                      </View>
                    )}
                    {nines.map((nine) => {
                      const junkNine = getPlayerJunkPointsNineTotal(
                        rp.playerId,
                        nine.holes.map((h) => h.holeNumber)
                      );
                      return (
                        <React.Fragment key={nine.label}>
                          {nine.holes.map((h) => {
                            const pts = getPlayerJunkPointsForHole(rp.playerId, h.holeNumber);
                            const isCurrentCell = highlightCurrentHole && h.holeNumber === currentHole;
                            return (
                              <View
                                key={h.holeNumber}
                                style={[
                                  styles.gridCell, dynCell,
                                  isCurrentCell && styles.gridCurrentHoleCol,
                                ]}
                              >
                                <Text style={[
                                  styles.gridScoreText, dynFont,
                                  styles.gridJunkGameText,
                                  isCurrentCell && styles.gridCurrentHoleText,
                                ]}>
                                  {pts !== 0 ? pts : '-'}
                                </Text>
                              </View>
                            );
                          })}
                          <View style={[styles.gridCell, dynCell, styles.gridTotalCell]}>
                            <Text style={[styles.gridTotalText, dynFont, styles.gridJunkGameText]}>{junkNine || '-'}</Text>
                          </View>
                        </React.Fragment>
                      );
                    })}
                    {showGrandTotal && (
                      <View style={[styles.gridCell, dynCell, styles.gridGrandTotalCell]}>
                        <Text style={[styles.gridGrandTotalText, dynFont, styles.gridJunkGameText]}>{junkTotal || '-'}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}

          {/* ── Main Game points rows — only when both main & junk games exist ── */}
          {hasMainAndJunk && (
            <>
              {/* Main game header row — uses actual game name */}
              <View style={[styles.gridRow, styles.gridSectionHeaderRow, styles.gridGameSubRowFirstRow]}>
                <View style={[styles.gridCell, dynCell, styles.gridNameCell, dynName, styles.gridSectionHeaderCell]}>
                  <Text style={[styles.gridSectionHeaderText, dynFont, styles.gridMainGameText]} numberOfLines={1}>
                    {mainGames.map((g) => getGameTypeDisplayName(g.type)).join(', ')}
                  </Text>
                </View>
                {frontNineData && <View style={[styles.gridCell, dynCell, styles.gridSectionHeaderCell]} />}
                {nines.map((nine) => (
                  <React.Fragment key={nine.label}>
                    {nine.holes.map((h) => (
                      <View key={h.holeNumber} style={[styles.gridCell, dynCell, styles.gridSectionHeaderCell]} />
                    ))}
                    <View style={[styles.gridCell, dynCell, styles.gridSectionHeaderCell]} />
                  </React.Fragment>
                ))}
                {showGrandTotal && <View style={[styles.gridCell, dynCell, styles.gridSectionHeaderCell]} />}
              </View>
              {activeRound!.players.map((rp) => {
                const player = playerState.players.find((p) => p.id === rp.playerId);
                if (!player) return null;
                const mainTotal = getPlayerMainPointsTotal(rp.playerId);
                const mainFrontNine = frontNineData
                  ? getPlayerMainPointsNineTotal(rp.playerId, frontNineData.holes.map((h) => h.holeNumber))
                  : 0;
                return (
                  <View key={`main-${rp.playerId}`} style={styles.gridRow}>
                    <View style={[styles.gridCell, dynCell, styles.gridNameCell, dynName]}>
                      <Text style={[styles.gridPlayerName, dynFont, styles.gridMainGameText]} numberOfLines={1}>
                        {player.nickname || player.firstName}
                      </Text>
                    </View>
                    {frontNineData && (
                      <View style={[styles.gridCell, dynCell, styles.gridTotalCell]}>
                        <Text style={[styles.gridTotalText, dynFont, styles.gridMainGameText]}>{mainFrontNine || '-'}</Text>
                      </View>
                    )}
                    {nines.map((nine) => {
                      const mainNine = getPlayerMainPointsNineTotal(
                        rp.playerId,
                        nine.holes.map((h) => h.holeNumber)
                      );
                      return (
                        <React.Fragment key={nine.label}>
                          {nine.holes.map((h) => {
                            const pts = getPlayerMainPointsForHole(rp.playerId, h.holeNumber);
                            const isCurrentCell = highlightCurrentHole && h.holeNumber === currentHole;
                            return (
                              <View
                                key={h.holeNumber}
                                style={[
                                  styles.gridCell, dynCell,
                                  isCurrentCell && styles.gridCurrentHoleCol,
                                ]}
                              >
                                <Text style={[
                                  styles.gridScoreText, dynFont,
                                  styles.gridMainGameText,
                                  isCurrentCell && styles.gridCurrentHoleText,
                                ]}>
                                  {pts !== 0 ? pts : '-'}
                                </Text>
                              </View>
                            );
                          })}
                          <View style={[styles.gridCell, dynCell, styles.gridTotalCell]}>
                            <Text style={[styles.gridTotalText, dynFont, styles.gridMainGameText]}>{mainNine || '-'}</Text>
                          </View>
                        </React.Fragment>
                      );
                    })}
                    {showGrandTotal && (
                      <View style={[styles.gridCell, dynCell, styles.gridGrandTotalCell]}>
                        <Text style={[styles.gridGrandTotalText, dynFont, styles.gridMainGameText]}>{mainTotal || '-'}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}
        </View>
      </ScrollView>
    );
  }

  // ── Completed state ──
  if (isComplete) {
    const coursePar = getCoursePar();
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.contentPadded}>
        <Text style={styles.completeTitle}>Round Complete</Text>
        <Text style={styles.completeSubtitle}>{activeCourse.name}</Text>

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
                {hasGames && (
                  <View style={styles.summaryCol}>
                    <Text style={styles.summaryLabel}>Points</Text>
                    <Text style={[styles.summaryValue, { color: '#6A1B9A' }]}>{totalPts}</Text>
                  </View>
                )}
              </View>
            </View>
          );
        })}

        <Text style={styles.sectionTitle}>Scorecard</Text>
        {renderScorecardGrid(splitNines)}

        {/* Post to GHIN button — only show if GHIN connected, owner is in round, and owner has a GHIN number */}
        {ghinConnected && ownerPlayerId && !ghinPosted &&
          activeRound.players.some((rp) => rp.playerId === ownerPlayerId) &&
          (() => {
            const ownerPlayer = playerState.players.find((p) => p.id === ownerPlayerId);
            return !!ownerPlayer?.ghinNumber;
          })() && (
          <TouchableOpacity
            style={styles.ghinButton}
            onPress={openGhinModal}
          >
            <FontAwesome name="cloud-upload" size={16} color="#FFF" />
            <Text style={styles.ghinButtonText}>Post My Score to GHIN</Text>
          </TouchableOpacity>
        )}
        {ghinPosted && (
          <View style={[styles.ghinButton, { backgroundColor: '#388E3C' }]}>
            <FontAwesome name="check-circle" size={16} color="#FFF" />
            <Text style={styles.ghinButtonText}>Score Posted to GHIN</Text>
          </View>
        )}

        <TouchableOpacity style={styles.doneButton} onPress={() => router.back()}>
          <Text style={styles.doneButtonText}>Done</Text>
        </TouchableOpacity>

        {/* GHIN Course Search + Post Modal (two-step: search → preview) */}
        <Modal
          visible={ghinModalVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setGhinModalVisible(false)}
        >
          <View style={styles.ghinModalOverlay}>
            <View style={styles.ghinModalContent}>

              {ghinStep === 'search' ? (
                <>
                  <Text style={styles.ghinModalTitle}>Post to GHIN</Text>
                  <Text style={styles.ghinModalSubtitle}>
                    Select the GHIN facility for this round
                  </Text>

                  {/* Course search */}
                  <View style={styles.ghinSearchRow}>
                    <TextInput
                      style={styles.ghinSearchInput}
                      placeholder="Search course name..."
                      value={ghinCourseSearch}
                      onChangeText={setGhinCourseSearch}
                      onSubmitEditing={handleGhinCourseSearch}
                      returnKeyType="search"
                      autoCorrect={false}
                    />
                    <TouchableOpacity
                      style={styles.ghinSearchButton}
                      onPress={handleGhinCourseSearch}
                      disabled={ghinSearching}
                    >
                      {ghinSearching ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <FontAwesome name="search" size={14} color="#FFF" />
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Course results */}
                  {ghinCourseResults.length > 0 && (
                    <FlatList
                      data={ghinCourseResults}
                      keyExtractor={(item) => String(item.facilityId)}
                      style={styles.ghinCourseList}
                      renderItem={({ item }) => {
                        const isSelected = ghinSelectedFacility?.facilityId === item.facilityId;
                        return (
                          <TouchableOpacity
                            style={[styles.ghinCourseItem, isSelected && styles.ghinCourseItemSelected]}
                            onPress={() => setGhinSelectedFacility({ facilityId: item.facilityId, courseId: item.courseId, facilityName: item.facilityName })}
                          >
                            <Text style={[styles.ghinCourseName, isSelected && styles.ghinCourseNameSelected]}>
                              {item.facilityName}
                            </Text>
                            {(item.city || item.state) && (
                              <Text style={styles.ghinCourseLocation}>
                                {[item.city, item.state].filter(Boolean).join(', ')}
                              </Text>
                            )}
                            {isSelected && (
                              <FontAwesome name="check-circle" size={18} color="#2E7D32" style={{ position: 'absolute', right: 12, top: 12 }} />
                            )}
                          </TouchableOpacity>
                        );
                      }}
                    />
                  )}

                  {/* Error */}
                  {ghinPostError && (
                    <Text style={styles.ghinErrorText}>{ghinPostError}</Text>
                  )}

                  {/* Action buttons — step 1 */}
                  <View style={styles.ghinModalActions}>
                    <TouchableOpacity
                      style={styles.ghinCancelButton}
                      onPress={() => setGhinModalVisible(false)}
                    >
                      <Text style={styles.ghinCancelButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.ghinPostButton, !ghinSelectedFacility && styles.ghinPostButtonDisabled]}
                      onPress={() => { setGhinPostError(null); setGhinStep('preview'); }}
                      disabled={!ghinSelectedFacility}
                    >
                      <Text style={styles.ghinPostButtonText}>Review Scores</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  {/* ── Step 2: Preview / Dry-Run ── */}
                  <Text style={styles.ghinModalTitle}>Review Before Posting</Text>

                  <View style={styles.ghinWarningBanner}>
                    <FontAwesome name="exclamation-triangle" size={16} color="#E65100" />
                    <Text style={styles.ghinWarningText}>
                        This will post your score to your real GHIN account and may affect your handicap index.
                    </Text>
                  </View>

                  {/* What will be posted */}
                  <View style={styles.ghinPreviewSection}>
                    <Text style={styles.ghinPreviewLabel}>Course</Text>
                    <Text style={styles.ghinPreviewValue}>{ghinSelectedFacility?.facilityName}</Text>

                    <Text style={[styles.ghinPreviewLabel, { marginTop: 8 }]}>Date</Text>
                    <Text style={styles.ghinPreviewValue}>
                      {activeRound.date?.split('T')[0] || new Date().toISOString().split('T')[0]}
                    </Text>

                    <Text style={[styles.ghinPreviewLabel, { marginTop: 8 }]}>Holes</Text>
                    <Text style={styles.ghinPreviewValue}>
                      {activeRound.roundType === 'full_18' ? '18' : '9'}
                    </Text>
                  </View>

                  {/* Owner's score to post */}
                  <View style={styles.ghinPlayersSection}>
                    <Text style={styles.ghinPlayersSectionTitle}>Your score</Text>
                    {(() => {
                      const ownerPlayer = playerState.players.find((p) => p.id === ownerPlayerId);
                      if (!ownerPlayer) return null;
                      const gross = getPlayerTotal(ownerPlayerId!);
                      return (
                        <View style={styles.ghinPlayerRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.ghinPlayerName}>{getPlayerDisplayName(ownerPlayer)}</Text>
                            <Text style={styles.ghinPlayerGhin}>GHIN #{ownerPlayer.ghinNumber}</Text>
                          </View>
                          <Text style={styles.ghinPlayerScore}>{gross}</Text>
                        </View>
                      );
                    })()}
                  </View>

                  {/* Error */}
                  {ghinPostError && (
                    <Text style={styles.ghinErrorText}>{ghinPostError}</Text>
                  )}

                  {/* Action buttons — step 2 */}
                  <View style={styles.ghinModalActions}>
                    <TouchableOpacity
                      style={styles.ghinCancelButton}
                      onPress={() => setGhinStep('search')}
                    >
                      <Text style={styles.ghinCancelButtonText}>Back</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.ghinPostButton, styles.ghinPostButtonConfirm, ghinPosting && styles.ghinPostButtonDisabled]}
                      onPress={handlePostToGhin}
                      disabled={ghinPosting}
                    >
                      {ghinPosting ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <Text style={styles.ghinPostButtonText}>Post to GHIN</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}

            </View>
          </View>
        </Modal>
      </ScrollView>
    );
  }

  // ── Active round - score entry ──
  const holePar = holeInfo?.par || 4;

  // Wolf hitting order: reorder players so wolf is first or last based on config
  const wolfGame = bettingGames.find((g) => g.type === 'wolf');
  const wolfHittingOrderIds = wolfGame
    ? getWolfHittingOrder(
        (wolfGame.config as unknown as WolfConfig)?.playerOrder ?? [],
        currentHole,
        (wolfGame.config as unknown as WolfConfig)?.wolfHitsFirst ?? false,
      )
    : null;
  const sortedPlayers = wolfHittingOrderIds
    ? [...activeRound.players].sort((a, b) => {
        const ai = wolfHittingOrderIds.indexOf(a.playerId);
        const bi = wolfHittingOrderIds.indexOf(b.playerId);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      })
    : activeRound.players;

  // Show only the active nine in the grid during play
  const visibleNine = splitNines[activeNineIndex] ? [splitNines[activeNineIndex]] : splitNines;
  // Show grand total column on back nine of a full 18
  const showGrandTotalInGrid = activeNineIndex === 1 && splitNines.length > 1;
  // When on the back nine, show the front 9 "Out" total as a leading column
  const frontNineForGrid = (activeNineIndex === 1 && splitNines.length > 1) ? splitNines[0] : undefined;

  // iPad: show all 18 holes; phone: show active nine only
  const scorecardNines = isTablet ? splitNines : visibleNine;
  const scorecardShowGrandTotal = isTablet ? (splitNines.length > 1) : showGrandTotalInGrid;
  const scorecardFrontNine = isTablet ? undefined : frontNineForGrid;

  // Tap a hole cell in scorecard view — switch to full hole entry
  function handleGridHoleTap(holeNumber: number) {
    goToHole(holeNumber);
    setViewMode('hole');
  }

  // ── Voice input render function (reused in hole view + iPad scorecard) ──
  function renderVoiceInput() {
    if (!voiceState.settings.sttEnabled) return null;
    const micDisabled = !!pendingScores || voiceState.isInterpreting;
    const isHandsFree = voiceState.handsFreeModeActive;
    return (
      <View style={isTablet ? styles.voiceInputAreaTablet : styles.voiceInputArea}>
        {/* Confirmation card — shown above mic when pending scores exist */}
        {pendingScores ? (
          <ScoreConfirmationCard
            entries={pendingScores}
            onConfirm={handleConfirmScores}
            onReject={handleRejectScores}
            usedClaude={pendingUsedClaude}
            confidence={pendingConfidence}
          />
        ) : voiceFeedback ? (
          <View style={styles.voiceFeedbackContainer}>
            <FontAwesome name="check-circle" size={14} color="#2E7D32" />
            <Text style={styles.voiceFeedbackText}>{voiceFeedback}</Text>
          </View>
        ) : voiceState.transcript && !voiceState.isInterpreting ? (
          <View style={styles.transcriptContainer}>
            <Text style={styles.transcriptText}>{voiceState.transcript}</Text>
            {!isHandsFree && (
              <TouchableOpacity onPress={() => { clearTranscript(); voiceAppliedRef.current = null; }} style={styles.clearTranscriptButton}>
                <FontAwesome name="times-circle" size={16} color="#999" />
              </TouchableOpacity>
            )}
          </View>
        ) : null}
        {voiceState.error && !voiceState.isListening ? (
          <Text style={styles.voiceErrorText}>{voiceState.error}</Text>
        ) : null}

        {/* Hands-free status indicator OR push-to-talk mic button */}
        {isHandsFree ? (
          <View style={styles.handsFreeIndicator}>
            <Animated.View style={{ transform: [{ scale: micPulse }] }}>
              <FontAwesome name="microphone" size={20} color="#2E7D32" />
            </Animated.View>
            <Text style={styles.handsFreeLabel}>
              {voiceState.isInterpreting ? 'Interpreting...' : 'Say "Scorecard" + command'}
            </Text>
          </View>
        ) : (
          <>
            <Animated.View style={{ transform: [{ scale: micPulse }], opacity: micDisabled ? 0.4 : 1 }}>
              <TouchableOpacity
                style={[
                  styles.micButton,
                  voiceState.isListening && styles.micButtonActive,
                  micDisabled && styles.micButtonDisabled,
                ]}
                onPress={handleMicPress}
                activeOpacity={0.7}
                disabled={micDisabled}
              >
                <FontAwesome
                  name="microphone"
                  size={24}
                  color={voiceState.isListening ? '#FFF' : '#2E7D32'}
                />
              </TouchableOpacity>
            </Animated.View>
            {voiceState.isListening ? (
              <Text style={styles.listeningLabel}>Listening...</Text>
            ) : voiceState.isInterpreting ? (
              <Text style={styles.interpretingLabel}>Interpreting...</Text>
            ) : null}
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {viewMode === 'hole' ? (
        <>
          {/* Hole Navigation */}
          <View style={styles.holeNav}>
            <TouchableOpacity onPress={() => setViewMode('scorecard')} style={styles.holeNavScorecardLink} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <FontAwesome name="table" size={14} color="#2E7D32" />
              <Text style={styles.holeNavScorecardText}>Scorecard</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handlePrevHole} disabled={currentHole <= firstHole} style={styles.holeNavButton}>
              <FontAwesome name="chevron-left" size={20} color={currentHole <= firstHole ? '#CCC' : '#1A1A2E'} />
            </TouchableOpacity>
            <View style={styles.holeCenter}>
              <Text style={styles.holeNumber}>Hole {currentHole}</Text>
              <Text style={styles.holePar}>Par {holeInfo?.par || '-'} | SI {holeInfo?.strokeIndex || '-'}</Text>
            </View>
            <TouchableOpacity onPress={handleNextHole} style={styles.holeNavButton}>
              <FontAwesome name="chevron-right" size={20} color="#1A1A2E" />
            </TouchableOpacity>
          </View>

          {/* Team banner (when teams are configured) */}
          {activeRound.teamConfig && (() => {
            const teamConfig = activeRound.teamConfig;
            const pairing = getTeamPairingForHole(teamConfig, currentHole);
            const isRotationChange = isTeamRotationBoundary(teamConfig, currentHole);
            if (!pairing) return null;

            const getNames = (ids: string[]) =>
              ids.map((pid) => {
                const pl = playerState.players.find((p) => p.id === pid);
                return pl ? (pl.nickname || pl.firstName) : pid;
              }).join(' & ');

            return (
              <View style={styles.teamBanner}>
                {isRotationChange && (
                  <Text style={styles.teamRotationNotice}>Teams Changed!</Text>
                )}
                <View style={styles.teamBannerRow}>
                  <View style={styles.teamBannerSide}>
                    <Text style={styles.teamBannerLabelA}>Team A</Text>
                    <Text style={styles.teamBannerNamesA}>{getNames(pairing.teamA)}</Text>
                  </View>
                  <Text style={styles.teamBannerVs}>vs</Text>
                  <View style={styles.teamBannerSide}>
                    <Text style={styles.teamBannerLabelB}>Team B</Text>
                    <Text style={styles.teamBannerNamesB}>{getNames(pairing.teamB)}</Text>
                  </View>
                </View>
              </View>
            );
          })()}

          {/* Player Score Entry for current hole */}
          <ScrollView style={styles.scoreEntryArea}>
            {sortedPlayers.map((rp) => {
              const player = playerState.players.find((p) => p.id === rp.playerId);
              if (!player) return null;
              const score = getPlayerScore(rp.playerId, currentHole);
              const grossScore = score?.grossScore || holePar;
              const strokes = getPlayerStrokes(rp.playerId, currentHole);
              const maxScore = getNetDoubleBogey(holePar, strokes);
              const diff = grossScore - holePar;
              const atMax = grossScore >= maxScore;

              const teamId = activeRound.teamConfig
                ? getPlayerTeam(activeRound.teamConfig, rp.playerId, currentHole)
                : null;

              return (
                <View key={rp.playerId} style={[
                  styles.playerScoreCard,
                  teamId === 'A' && styles.teamAPlayerCard,
                  teamId === 'B' && styles.teamBPlayerCard,
                ]}>
                  <View style={styles.playerScoreHeader}>
                    <Text style={styles.playerScoreName}>{getPlayerDisplayName(player)}</Text>
                    {strokes > 0 && (
                      <View style={styles.strokeDots}>
                        {Array.from({ length: strokes }).map((_, i) => (
                          <View key={i} style={styles.strokeDot} />
                        ))}
                      </View>
                    )}
                  </View>

                  <View style={styles.scoreRow}>
                    <TouchableOpacity
                      style={styles.scoreButton}
                      onPress={() => handleScoreChange(rp.playerId, -1)}
                    >
                      <FontAwesome name="minus" size={16} color="#D32F2F" />
                    </TouchableOpacity>

                    <View style={styles.scoreNumberContainer}>
                      <Text style={[
                        styles.scoreNumber,
                        { color: diff < 0 ? '#E74C3C' : diff === 0 ? '#2E7D32' : diff === 1 ? '#3498DB' : '#1A1A2E' },
                      ]}>
                        {grossScore}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={[styles.scoreButton, atMax && styles.scoreButtonDisabled]}
                      onPress={() => handleScoreChange(rp.playerId, 1)}
                      disabled={atMax}
                    >
                      <FontAwesome name="plus" size={16} color={atMax ? '#CCC' : '#2E7D32'} />
                    </TouchableOpacity>

                    <Text style={styles.scoreLabel}>
                      {getScoreLabel(grossScore, holePar)}
                    </Text>

                    {/* Quick score buttons */}
                    <View style={styles.quickScores}>
                      {Array.from({ length: 5 }, (_, i) => holePar - 1 + i)
                        .filter((s) => s >= 1 && s <= maxScore)
                        .map((s) => (
                          <TouchableOpacity
                            key={s}
                            style={[
                              styles.quickScoreButton,
                              s === grossScore && styles.quickScoreActive,
                            ]}
                            onPress={() => handleSetScore(rp.playerId, s)}
                          >
                            <Text style={[
                              styles.quickScoreText,
                              s === grossScore && styles.quickScoreTextActive,
                            ]}>
                              {s}
                            </Text>
                          </TouchableOpacity>
                        ))}
                    </View>
                  </View>
                </View>
              );
            })}

            {/* ── Junk / Dots — dot toggle chips per player ── */}
            {junkGames.map((game) => {
              const allScored = activeRound.players.every(
                (rp) => scores.some((s) => s.playerId === rp.playerId && s.holeNumber === currentHole)
              );
              const isGreenieHole = holeInfo?.par === 3 || holeInfo?.par === 4 || holeInfo?.par === 5;
              const carryInfo = isGreenieHole ? getGreenieCarryInfo(greenieCtx, currentHole) : null;
              // Check if a player already has the greenie or ouzel on this hole (only one player can have each)
              const greenieWinnerId = isGreenieHole ? getGreenieWinnerOnHole(greenieCtx, currentHole) : null;
              const ouzelHolderId = gamePoints.find(
                (gp) => gp.holeNumber === currentHole && gp.gameId === game.id && gp.awardedDots?.includes('ouzel')
              )?.playerId ?? null;

              // Split dot types into par-gated toggleable, auto-awarded (display-only), and ungated toggleable
              const activeDotDefs = AVAILABLE_DOTS.filter((d) => activeDotIds.includes(d.id));
              // Par-gated toggleable: exclude auto-awarded dots (birdie/eagle/albatross) and greenie on non-par-3/5 holes
              const parGatedDots = activeDotDefs.filter((d) => {
                if (!d.requiresParOrBetter) return false;
                if (d.autoAward) return false; // birdie/eagle/albatross handled separately
                if (d.id === 'greenie' && !isGreenieHole) return false;
                return true;
              });
              // Auto-awarded dots (birdie, eagle, albatross, hole_in_one) — display-only when awarded
              const autoAwardDots = activeDotDefs.filter((d) => !!d.autoAward);
              // Auto-calculated dots (sweepies) — display-only when awarded
              const autoCalcDots = activeDotDefs.filter((d) => !!d.autoCalculated);
              // Ungated toggleable: hide sweepies (auto-calculated), auto-awarded, and ouzel on non-par-3/5 holes
              const ungatedDots = activeDotDefs.filter((d) => {
                if (d.requiresParOrBetter) return false;
                if (d.autoCalculated) return false;
                if (d.autoAward) return false; // hole_in_one handled in autoAwardDots
                if (d.id === 'ouzel' && !isGreenieHole) return false;
                return true;
              });

              const carryHole = isCarryHole(currentHole);
              const effectiveMult = getEffectiveJunkMultiplier(currentHole);

              return (
                <View key={`junk-${game.id}`}>
                  <View style={[styles.gamePointsHeader, styles.junkGameHeader]}>
                    <View style={styles.gamePointsHeaderRow}>
                      <FontAwesome name="hand-o-up" size={12} color="#E65100" />
                      <Text style={[styles.gamePointsHeaderText, styles.junkGameHeaderText]}>
                        {getGameTypeDisplayName(game.type)}
                        {carryHole ? ' (2x carry)' : ''}
                      </Text>
                    </View>
                    {/* Greenie carry info on par 3/4/5 holes */}
                    {isGreenieHole && carryInfo && (() => {
                      const effectiveGreenie = Math.round(carryInfo.carryValue * effectiveMult);
                      return (
                        <Text style={styles.greenieCarryLabel}>
                          Greenie: {effectiveGreenie}pt{effectiveGreenie !== 1 ? 's' : ''}
                          {carryInfo.carriedFromHoles.length > 0
                            ? ` (carried from ${carryInfo.carriedFromHoles.map((h) => `#${h}`).join(', ')})`
                            : ''}
                        </Text>
                      );
                    })()}
                  </View>
                  {sortedPlayers.map((rp) => {
                    const player = playerState.players.find((p) => p.id === rp.playerId);
                    if (!player) return null;
                    const qualifies = playerQualifiesForJunk(rp.playerId, currentHole);
                    const confirmed = isDotsConfirmed(rp.playerId);
                    const awarded = getPlayerAwardedDots(rp.playerId, currentHole);
                    const awardedSet = new Set(awarded);
                    const pts = getPlayerGamePointsForGame(game.id, rp.playerId, currentHole);
                    const totalPts = getPlayerGamePointsTotalForGame(game.id, rp.playerId);
                    const hasScore = scores.some(
                      (s) => s.playerId === rp.playerId && s.holeNumber === currentHole
                    );

                    // Whether this player is in summary mode (collapsed)
                    const isSummary = hasScore && (!junkDetailExpanded || confirmed);

                    return (
                      <View key={`junk-${game.id}-${rp.playerId}`} style={styles.dotPlayerCard}>
                        <View style={styles.dotPlayerHeader}>
                          <Text style={[styles.gamePointPlayerName, !hasScore && styles.dotPlayerNamePending]}>
                            {getPlayerDisplayName(player)}
                          </Text>
                          <View style={styles.dotPlayerPtsRow}>
                            {hasScore ? (
                              <>
                                {/* Summary: compact dot name chips to the LEFT of the numbers */}
                                {isSummary && awarded.length > 0 && (
                                  <View style={styles.dotSummaryRow}>
                                    {awarded.map((dotId) => {
                                      const dotDef = AVAILABLE_DOTS.find((d) => d.id === dotId);
                                      if (!dotDef) return null;
                                      const playerScore = getPlayerScore(rp.playerId, currentHole);
                                      const displayName = dotDef.autoAward && playerScore && holeInfo
                                        ? getAutoAwardDotDisplayName(dotId, dotDef.name, playerScore.grossScore, holeInfo.par)
                                        : dotDef.name;
                                      return (
                                        <View key={dotId} style={styles.dotSummaryChip}>
                                          <Text style={styles.dotSummaryChipText}>{displayName}</Text>
                                        </View>
                                      );
                                    })}
                                  </View>
                                )}
                                <Text style={[styles.dotPlayerPts, pts < 0 && styles.dotPlayerPtsNeg]}>
                                  {pts !== 0 ? pts : '-'}
                                </Text>
                                <Text style={styles.gamePointTotalLabel}>({totalPts})</Text>
                                {junkDetailExpanded && allScored && !confirmed && (
                                  <TouchableOpacity
                                    style={styles.confirmDotsButton}
                                    onPress={() => handleConfirmDots(rp.playerId)}
                                  >
                                    <FontAwesome name="check" size={12} color="#FFF" />
                                  </TouchableOpacity>
                                )}
                                {confirmed && (
                                  <FontAwesome name="check-circle" size={16} color="#2E7D32" />
                                )}
                              </>
                            ) : (
                              <Text style={styles.dotPlayerPtsPending}>—</Text>
                            )}
                          </View>
                        </View>
                        {/* Dot chips: only shown when score entered, detail expanded, and not yet confirmed */}
                        {(!hasScore || !junkDetailExpanded || confirmed) ? null : (
                        <>
                        {/* Par-gated dot chips — only when player qualifies */}
                        {qualifies && parGatedDots.length > 0 && (() => {
                          // Greenie requires gross par, not net par
                          const score = scores.find(
                            (s) => s.playerId === rp.playerId && s.holeNumber === currentHole
                          );
                          const grossQualifies = score ? score.grossScore <= holePar : false;
                          return (
                            <View style={styles.dotChipRow}>
                              {parGatedDots.map((dot) => {
                                const isOn = awardedSet.has(dot.id);
                                // Greenie requires gross par; once any player has greenie or ouzel,
                                // all other players' greenie is disabled; own greenie disabled if ouzel selected
                                const greenieOrOuzelAwarded = greenieWinnerId !== null || ouzelHolderId !== null;
                                const greenieDisabled = dot.id === 'greenie' && (
                                  !grossQualifies
                                  || (greenieOrOuzelAwarded && greenieWinnerId !== rp.playerId && ouzelHolderId !== rp.playerId)
                                  || awardedSet.has('ouzel')
                                );
                                // Par 3: sandy and greenie are mutually exclusive (can't be in a bunker and hit the green from the tee)
                                const sandyGreenieExclusion = holePar === 3 && (
                                  (dot.id === 'sandy' && awardedSet.has('greenie'))
                                  || (dot.id === 'greenie' && awardedSet.has('sandy'))
                                );
                                // Sneak / Super Sneak require net score exactly equal to par
                                const sneakDisabled = (dot.id === 'sneak' || dot.id === 'super_sneak') &&
                                  (!score || score.netScore !== holePar);
                                // Show effective value for greenie chip (includes carry hole doubling)
                                const chipLabel = dot.id === 'greenie' && isGreenieHole && carryInfo
                                  ? `Greenie (${Math.round(carryInfo.carryValue * effectiveMult)})`
                                  : dot.name;
                                const chipDisabled = confirmed || greenieDisabled || sandyGreenieExclusion || sneakDisabled;
                                return (
                                  <TouchableOpacity
                                    key={dot.id}
                                    style={[
                                      styles.dotChip,
                                      isOn && styles.dotChipOn,
                                      chipDisabled && styles.dotChipDisabled,
                                    ]}
                                    onPress={() => !chipDisabled && handleDotToggle(rp.playerId, dot.id)}
                                    disabled={chipDisabled}
                                  >
                                    <Text style={[styles.dotChipText, isOn && styles.dotChipTextOn]}>
                                      {chipLabel}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          );
                        })()}
                        {/* Auto-awarded dot chips (birdie/eagle/albatross/hole-in-one) — display only when awarded */}
                        {autoAwardDots.length > 0 && (() => {
                          const awarded = autoAwardDots.filter((d) => awardedSet.has(d.id));
                          if (awarded.length === 0) return null;
                          const playerScore = getPlayerScore(rp.playerId, currentHole);
                          return (
                            <View style={styles.dotChipRow}>
                              {awarded.map((dot) => {
                                const displayName = playerScore && holeInfo
                                  ? getAutoAwardDotDisplayName(dot.id, dot.name, playerScore.grossScore, holeInfo.par)
                                  : dot.name;
                                return (
                                <View
                                  key={dot.id}
                                  style={[styles.dotChip, styles.dotChipAutoAwarded]}
                                >
                                  <Text style={[styles.dotChipText, styles.dotChipTextAutoAwarded]}>
                                    {displayName}
                                  </Text>
                                </View>
                                );
                              })}
                            </View>
                          );
                        })()}
                        {/* Auto-calculated dot chips (sweepies) — display only when awarded */}
                        {autoCalcDots.length > 0 && (() => {
                          const awardedCalc = autoCalcDots.filter((d) => awardedSet.has(d.id));
                          if (awardedCalc.length === 0) return null;
                          return (
                            <View style={styles.dotChipRow}>
                              {awardedCalc.map((dot) => {
                                const sweepieValue = Math.round(getDynamicDotPointValue(dot.id, greenieCtx, currentHole) * effectiveMult);
                                return (
                                  <View
                                    key={dot.id}
                                    style={[styles.dotChip, styles.dotChipAutoAwarded]}
                                  >
                                    <Text style={[styles.dotChipText, styles.dotChipTextAutoAwarded]}>
                                      {dot.name} ({sweepieValue})
                                    </Text>
                                  </View>
                                );
                              })}
                            </View>
                          );
                        })()}
                        {/* Ungated dot chips — always available when player has a score */}
                        {ungatedDots.length > 0 && (() => {
                          const playerScore = scores.find(
                            (s) => s.playerId === rp.playerId && s.holeNumber === currentHole
                          );
                          const playerGross = playerScore?.grossScore ?? 0;
                          const visibleUngated = ungatedDots.filter((d) => {
                            // Ouzel requires OVER gross par (failed greenie conversion)
                            if (d.id === 'ouzel' && playerGross <= holePar) return false;
                            return true;
                          });
                          if (visibleUngated.length === 0) return null;
                          return (
                          <View style={styles.dotChipRow}>
                            {visibleUngated.map((dot) => {
                              const isOn = awardedSet.has(dot.id);
                              const rawDynamicVal = (dot.id === 'ouzel' && isGreenieHole)
                                ? getDynamicDotPointValue('ouzel', greenieCtx, currentHole)
                                : dot.points;
                              const dynamicVal = Math.round(rawDynamicVal * effectiveMult);
                              const isNeg = dynamicVal < 0;
                              // Ouzel = failed greenie conversion. Once any player has greenie or ouzel,
                              // all other players' ouzel is disabled; own ouzel disabled if greenie selected
                              const greenieOrOuzelAwarded = greenieWinnerId !== null || ouzelHolderId !== null;
                              const ouzelDisabled = dot.id === 'ouzel' && (
                                (greenieOrOuzelAwarded && greenieWinnerId !== rp.playerId && ouzelHolderId !== rp.playerId)
                                || awardedSet.has('greenie')
                              );
                              // Show effective value for ouzel chip (includes carry hole doubling)
                              const chipLabel = dot.id === 'ouzel' && isGreenieHole
                                ? `Ouzel (${dynamicVal})`
                                : dot.name;
                              return (
                                <TouchableOpacity
                                  key={dot.id}
                                  style={[
                                    styles.dotChip,
                                    isOn && (isNeg ? styles.dotChipOnNeg : styles.dotChipOn),
                                    (confirmed || ouzelDisabled) && styles.dotChipDisabled,
                                  ]}
                                  onPress={() => !confirmed && !ouzelDisabled && handleDotToggle(rp.playerId, dot.id)}
                                  disabled={confirmed || ouzelDisabled}
                                >
                                  <Text style={[styles.dotChipText, isOn && styles.dotChipTextOn]}>
                                    {chipLabel}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                          );
                        })()}
                        {!qualifies && parGatedDots.length > 0 && (
                          <Text style={styles.dotNoQualifyLabel}>Over par — situational dots unavailable</Text>
                        )}
                        </>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            })}

            {/* ── Auto-calculated main games (Nassau, Skins, Baseball): read-only display ── */}
            {autoCalcGames.map((game) => (
              <View key={`auto-${game.id}`}>
                <View style={styles.gamePointsHeader}>
                  <View style={styles.gamePointsHeaderRow}>
                    <FontAwesome name="calculator" size={12} color="#6A1B9A" />
                    <Text style={styles.gamePointsHeaderText}>{getGameTypeDisplayName(game.type)}</Text>
                    <Text style={styles.gamePointsAutoLabel}>Auto</Text>
                  </View>
                </View>
                {sortedPlayers.map((rp) => {
                  const player = playerState.players.find((p) => p.id === rp.playerId);
                  if (!player) return null;
                  const pts = getPlayerGamePointsForGame(game.id, rp.playerId, currentHole);
                  const totalPts = getPlayerGamePointsTotalForGame(game.id, rp.playerId);
                  return (
                    <View key={`auto-${game.id}-${rp.playerId}`} style={styles.gamePointCard}>
                      <Text style={styles.gamePointPlayerName}>{getPlayerDisplayName(player)}</Text>
                      <View style={styles.gamePointControls}>
                        <Text style={styles.gamePointValue}>{pts}</Text>
                        <Text style={styles.gamePointTotalLabel}>({totalPts})</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}

            {/* ── Wolf game: partner selection + auto-calculated points ── */}
            {manualGames.filter((g) => g.type === 'wolf').map((game) => {
              const wolfConfig = game.config as unknown as WolfConfig;
              const wolfPlayerId = getWolfForHole(wolfConfig?.playerOrder ?? [], currentHole);
              const wolfPlayer = wolfPlayerId ? playerState.players.find((p) => p.id === wolfPlayerId) : null;
              const wolfChoice = getWolfChoiceForHole(game.id, currentHole);

              return (
                <View key={`wolf-${game.id}`}>
                  {/* Wolf header with badge */}
                  <View style={styles.gamePointsHeader}>
                    <View style={styles.gamePointsHeaderRow}>
                      <FontAwesome name={'paw' as any} size={12} color="#6A1B9A" />
                      <Text style={styles.gamePointsHeaderText}>Wolf</Text>
                      {wolfPlayer && (
                        <View style={styles.wolfBadge}>
                          <FontAwesome name="paw" size={10} color="#FFF" />
                          <Text style={styles.wolfBadgeText}>
                            {getPlayerDisplayName(wolfPlayer)}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Partner selection prompt or current choice */}
                  {wolfPlayerId && !wolfChoice && (
                    <TouchableOpacity
                      style={styles.wolfChoicePrompt}
                      onPress={() => {
                        setWolfModalGameId(game.id);
                        setWolfModalVisible(true);
                      }}
                    >
                      <FontAwesome name="user-plus" size={14} color="#6A1B9A" />
                      <Text style={styles.wolfChoicePromptText}>Select Partner or Go Lone</Text>
                    </TouchableOpacity>
                  )}

                  {wolfChoice && (
                    <TouchableOpacity
                      style={styles.wolfChoiceDisplay}
                      onPress={() => {
                        setWolfModalGameId(game.id);
                        setWolfModalVisible(true);
                      }}
                    >
                      {wolfChoice.isLoneWolf ? (
                        <View style={styles.wolfChoiceLabelRow}>
                          <FontAwesome name={'paw' as any} size={13} color="#6A1B9A" />
                          <Text style={styles.wolfChoiceLabel}>Lone Wolf</Text>
                        </View>
                      ) : (
                        <View style={styles.wolfChoiceLabelRow}>
                          <FontAwesome name="handshake-o" size={13} color="#1565C0" />
                          <Text style={[styles.wolfChoiceLabel, { color: '#1565C0' }]}>
                            {(() => {
                              const partner = playerState.players.find((p) => p.id === wolfChoice.partnerId);
                              return partner ? getPlayerDisplayName(partner) : 'Partner';
                            })()}
                          </Text>
                        </View>
                      )}
                      <FontAwesome name="pencil" size={11} color="#999" />
                    </TouchableOpacity>
                  )}

                  {/* Point display per player (read-only, auto-calculated) */}
                  {sortedPlayers.map((rp) => {
                    const player = playerState.players.find((p) => p.id === rp.playerId);
                    if (!player) return null;
                    const pts = getPlayerGamePointsForGame(game.id, rp.playerId, currentHole);
                    const totalPts = getPlayerGamePointsTotalForGame(game.id, rp.playerId);
                    const isWolf = rp.playerId === wolfPlayerId;
                    const isPartner = wolfChoice && !wolfChoice.isLoneWolf && rp.playerId === wolfChoice.partnerId;
                    return (
                      <View
                        key={`wolf-${game.id}-${rp.playerId}`}
                        style={[styles.gamePointCard, isWolf && styles.wolfPlayerCard, isPartner && styles.wolfPartnerCard]}
                      >
                        <View style={styles.gamePointPlayerRow}>
                          {isWolf && <FontAwesome name={'paw' as any} size={11} color="#6A1B9A" style={{ marginRight: 4 }} />}
                          {isPartner && <FontAwesome name="handshake-o" size={11} color="#1565C0" style={{ marginRight: 4 }} />}
                          <Text style={[styles.gamePointPlayerName, isWolf && styles.wolfPlayerName, isPartner && styles.wolfPartnerName]}>
                            {getPlayerDisplayName(player)}
                          </Text>
                        </View>
                        <View style={styles.wolfPointValues}>
                          <Text style={[styles.gamePointValue, pts > 0 && { color: '#2E7D32' }]}>{pts}</Text>
                          <Text style={styles.gamePointTotalLabel}>({totalPts})</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            })}

            {/* ── Other manual games (Custom, Stableford, etc. — non-junk, non-wolf): +/- buttons ── */}
            {manualGames.filter((g) => !isJunkGame(g.type) && g.type !== 'wolf').map((game) => (
              <View key={`manual-${game.id}`}>
                <View style={styles.gamePointsHeader}>
                  <View style={styles.gamePointsHeaderRow}>
                    <FontAwesome name="hand-o-up" size={12} color="#6A1B9A" />
                    <Text style={styles.gamePointsHeaderText}>{getGameTypeDisplayName(game.type)}</Text>
                  </View>
                </View>
                {sortedPlayers.map((rp) => {
                  const player = playerState.players.find((p) => p.id === rp.playerId);
                  if (!player) return null;
                  const pts = getPlayerGamePointsForGame(game.id, rp.playerId, currentHole);
                  const totalPts = getPlayerGamePointsTotalForGame(game.id, rp.playerId);
                  return (
                    <View
                      key={`manual-${game.id}-${rp.playerId}`}
                      style={styles.gamePointCard}
                    >
                      <View style={styles.gamePointPlayerRow}>
                        <Text style={styles.gamePointPlayerName}>
                          {getPlayerDisplayName(player)}
                        </Text>
                      </View>
                      <View style={styles.gamePointControls}>
                        <TouchableOpacity
                          style={styles.gamePointButton}
                          onPress={() => handleGamePointChange(game.id, rp.playerId, -1)}
                        >
                          <FontAwesome name="minus" size={12} color="#D32F2F" />
                        </TouchableOpacity>
                        <Text style={styles.gamePointValue}>{pts}</Text>
                        <TouchableOpacity
                          style={styles.gamePointButton}
                          onPress={() => handleGamePointChange(game.id, rp.playerId, 1)}
                        >
                          <FontAwesome name="plus" size={12} color="#2E7D32" />
                        </TouchableOpacity>
                        <Text style={styles.gamePointTotalLabel}>({totalPts})</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </ScrollView>

          {/* Voice Input */}
          {renderVoiceInput()}

          {/* End Round — subdued button at bottom, separated from View Scorecard */}
          <View style={styles.bottomButtons}>
            <TouchableOpacity style={styles.endRoundButtonSubdued} onPress={handleEndRound}>
              <Text style={styles.endRoundButtonSubduedText}>End Round</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <SafeAreaView style={styles.scorecardSafeArea} edges={['top', 'left', 'right']}>
          {/* Scorecard header — tap a hole cell to enter hole detail */}
          <View style={styles.scorecardHeader}>
            <Text style={[styles.scorecardTitle, { flex: 1 }]}>
              {activeCourse?.name ? `${activeCourse.name}  ·  ` : ''}Hole {currentHole}
            </Text>
            <TouchableOpacity style={styles.scorecardEndRoundButton} onPress={handleEndRound}>
              <Text style={styles.scorecardEndRoundText}>End Round</Text>
            </TouchableOpacity>
          </View>

          {/* Voice input lives exclusively on hole detail view now */}

          {/* Scorecard Grid — iPad: full 18 holes, Phone: active nine */}
          <ScrollView style={styles.scorecardScrollArea}>
            <View style={styles.gridContainer}>
              {renderScorecardGrid(scorecardNines, {
                highlightCurrentHole: true,
                tappable: true,
                showGrandTotal: scorecardShowGrandTotal,
                frontNineData: scorecardFrontNine,
                onHoleTap: handleGridHoleTap,
              })}
            </View>
          </ScrollView>
        </SafeAreaView>
      )}


      {/* Wolf Partner Selection Modal */}
      {wolfModalVisible && activeRound && wolfModalGameId && (() => {
        const wolfGame = bettingGames.find((g) => g.id === wolfModalGameId);
        if (!wolfGame || wolfGame.type !== 'wolf') return null;
        const wConfig = wolfGame.config as unknown as WolfConfig;
        const wPlayerId = getWolfForHole(wConfig.playerOrder ?? [], currentHole);
        const wPlayer = wPlayerId ? playerState.players.find((p) => p.id === wPlayerId) : null;
        const otherPlayers = activeRound.players.filter((rp) => rp.playerId !== wPlayerId);

        return (
          <Modal
            visible={true}
            transparent
            animationType="fade"
            onRequestClose={() => setWolfModalVisible(false)}
          >
            <Pressable
              style={styles.wolfModalOverlay}
              onPress={() => setWolfModalVisible(false)}
            >
              <View style={styles.wolfModalContent} onStartShouldSetResponder={() => true}>
                <Text style={styles.wolfModalTitle}>Wolf's Choice</Text>
                <Text style={styles.wolfModalSubtitle}>
                  Hole {currentHole} — {wPlayer ? getPlayerDisplayName(wPlayer) : 'Wolf'} is the Wolf
                </Text>

                <Text style={styles.wolfModalSectionLabel}>Pick a Partner</Text>
                {otherPlayers.map((rp) => {
                  const pPlayer = playerState.players.find((p) => p.id === rp.playerId);
                  if (!pPlayer) return null;
                  return (
                    <TouchableOpacity
                      key={rp.playerId}
                      style={styles.wolfModalPartnerBtn}
                      onPress={async () => {
                        await recordWolfChoice({
                          roundId: activeRound.id,
                          gameId: wolfModalGameId!,
                          holeNumber: currentHole,
                          wolfPlayerId: wPlayerId!,
                          partnerId: rp.playerId,
                        });
                        setWolfModalVisible(false);
                      }}
                    >
                      <FontAwesome name="handshake-o" size={16} color="#1565C0" />
                      <Text style={styles.wolfModalPartnerText}>
                        {getPlayerDisplayName(pPlayer)}
                      </Text>
                      <Text style={styles.wolfModalPtsHint}>{wConfig.teamPoints ?? 2} pts/player</Text>
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity
                  style={styles.wolfModalLoneBtn}
                  onPress={async () => {
                    await recordWolfChoice({
                      roundId: activeRound.id,
                      gameId: wolfModalGameId!,
                      holeNumber: currentHole,
                      wolfPlayerId: wPlayerId!,
                      partnerId: null,
                    });
                    setWolfModalVisible(false);
                  }}
                >
                  <FontAwesome name={'paw' as any} size={16} color="#6A1B9A" />
                  <Text style={styles.wolfModalLoneText}>Go Lone Wolf</Text>
                  <Text style={styles.wolfModalPtsHint}>{(wConfig.teamPoints ?? 2) * 2} pts/opponent</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.wolfModalCancelBtn}
                  onPress={() => setWolfModalVisible(false)}
                >
                  <Text style={styles.wolfModalCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Modal>
        );
      })()}
    </View>
  );
}

const CELL_W = 36;
const NAME_W = 72;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  contentPadded: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16, color: '#666' },

  // Bottom buttons (hole view)
  bottomButtons: { paddingHorizontal: 8, paddingBottom: 8, gap: 6 },
  viewScorecardButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 10, borderRadius: 10, backgroundColor: '#FFF',
    borderWidth: 1, borderColor: '#2E7D32',
  },
  viewScorecardButtonText: { fontSize: 15, fontWeight: '600', color: '#2E7D32' },

  // Scorecard safe area (landscape – avoids Dynamic Island / notch)
  scorecardSafeArea: { flex: 1, backgroundColor: '#F5F5F5' },

  // Scorecard header (landscape scorecard view)
  scorecardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#2E7D32', paddingVertical: 6, gap: 6,
  },
  scorecardTitle: { color: '#FFF', fontSize: 14, fontWeight: 'bold' },

  // Scorecard scroll area (scorecard view)
  scorecardScrollArea: { flex: 1 },

  // Hole navigation
  holeNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFF', paddingVertical: 10, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#E0E0E0',
  },
  holeNavButton: { padding: 8 },
  holeNavScorecardLink: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6 },
  holeNavScorecardText: { fontSize: 13, fontWeight: '600', color: '#2E7D32' },
  holeCenter: { alignItems: 'center' },
  holeNumber: { fontSize: 20, fontWeight: 'bold', color: '#1A1A2E' },
  holePar: { fontSize: 13, color: '#666' },

  // Scorecard grid
  gridContainer: { backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E0E0E0' },
  gridRow: { flexDirection: 'row' },
  gridCell: {
    width: CELL_W, height: 32, alignItems: 'center', justifyContent: 'center',
    borderWidth: 0.5, borderColor: '#E0E0E0',
  },
  gridNameCell: { width: NAME_W, alignItems: 'flex-start', paddingLeft: 6 },
  gridHeaderCell: { backgroundColor: '#2E7D32' },
  gridHeaderText: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  gridParText: { fontSize: 11, color: '#666', fontWeight: '500' },
  gridHdcpText: { fontSize: 10, color: '#999', fontWeight: '400' },
  gridPlayerName: { fontSize: 11, color: '#1A1A2E', fontWeight: '500' },
  gridScoreText: { fontSize: 12, fontWeight: '600', color: '#1A1A2E' },
  gridTotalCell: { backgroundColor: '#F0F0F0' },
  gridTotalText: { fontSize: 12, fontWeight: 'bold', color: '#1A1A2E' },
  gridGrandTotalCell: { backgroundColor: '#E0E0E0' },
  gridGrandTotalText: { fontSize: 12, fontWeight: 'bold', color: '#1A1A2E' },
  gridStrokeDots: { position: 'absolute', top: 2, right: 2, flexDirection: 'row', gap: 1 },
  gridStrokeDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#000' },
  gridCurrentHoleHeader: { backgroundColor: '#1B5E20' },
  gridCurrentHoleCol: { backgroundColor: '#E8F5E9' },
  gridCurrentHoleText: { fontWeight: 'bold' },

  // Nine toggle
  nineToggle: {
    flexDirection: 'row', backgroundColor: '#FFF',
    paddingVertical: 6, paddingHorizontal: 12, gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#E0E0E0',
  },
  nineToggleButton: {
    flex: 1, paddingVertical: 6, borderRadius: 6,
    alignItems: 'center', backgroundColor: '#F5F5F5',
  },
  nineToggleActive: { backgroundColor: '#2E7D32' },
  nineToggleText: { fontSize: 13, fontWeight: '600', color: '#666' },
  nineToggleTextActive: { color: '#FFF' },

  // Score entry (compact row per player)
  scoreEntryArea: { flex: 1, paddingHorizontal: 8, paddingTop: 6 },
  playerScoreCard: {
    backgroundColor: '#FFF', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12,
    marginBottom: 6,
  },
  playerScoreHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  playerScoreName: { fontSize: 14, fontWeight: '600', color: '#1A1A2E' },
  strokeDots: { flexDirection: 'row', gap: 3 },
  strokeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2E7D32' },

  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scoreButton: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F5F5',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E0E0E0',
  },
  scoreButtonDisabled: { opacity: 0.4 },
  scoreNumber: { fontSize: 28, fontWeight: 'bold', width: 40, textAlign: 'center' },
  scoreNumberContainer: { width: 52, alignItems: 'center', justifyContent: 'center' },
  scoreLabel: { fontSize: 11, color: '#666', width: 50 },

  quickScores: { flexDirection: 'row', gap: 4, marginLeft: 'auto' },
  quickScoreButton: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#F5F5F5',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E0E0E0',
  },
  quickScoreActive: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  quickScoreText: { fontSize: 13, fontWeight: '600', color: '#666' },
  quickScoreTextActive: { color: '#FFF' },

  // Done button (completed view)
  doneButton: {
    backgroundColor: '#2E7D32', paddingVertical: 14, borderRadius: 10, alignItems: 'center',
    marginTop: 20,
  },
  doneButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },

  // End round
  endRoundButton: {
    backgroundColor: '#D32F2F', paddingVertical: 12, borderRadius: 10, alignItems: 'center',
  },
  endRoundButtonText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  // End round (subdued — hole view bottom)
  endRoundButtonSubdued: {
    paddingVertical: 10, alignItems: 'center',
  },
  endRoundButtonSubduedText: { color: '#999', fontSize: 13, fontWeight: '500' },

  // Voice input area
  voiceInputArea: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8, gap: 6 },
  micButton: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#FFF', borderWidth: 2, borderColor: '#2E7D32',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  micButtonActive: { backgroundColor: '#D32F2F', borderColor: '#D32F2F' },
  micButtonDisabled: { opacity: 0.5 },
  listeningLabel: { fontSize: 12, color: '#D32F2F', fontWeight: '600' },
  interpretingLabel: { fontSize: 12, color: '#1565C0', fontWeight: '600' },
  transcriptContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFF', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12,
    width: '100%', borderWidth: 1, borderColor: '#E0E0E0',
  },
  transcriptText: { flex: 1, fontSize: 14, color: '#1A1A2E', fontStyle: 'italic' },
  clearTranscriptButton: { padding: 4, marginLeft: 8 },
  voiceErrorText: { fontSize: 12, color: '#D32F2F', textAlign: 'center' },
  voiceFeedbackContainer: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#E8F5E9', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12,
    width: '100%', borderWidth: 1, borderColor: '#C8E6C9',
  },
  voiceFeedbackText: { flex: 1, fontSize: 14, color: '#2E7D32', fontWeight: '500' },

  // Complete state
  completeTitle: { fontSize: 24, fontWeight: 'bold', color: '#1A1A2E' },
  completeSubtitle: { fontSize: 16, color: '#666', marginBottom: 16 },
  summaryCard: {
    backgroundColor: '#FFF', borderRadius: 12, padding: 16, marginBottom: 10,
  },
  summaryName: { fontSize: 16, fontWeight: '600', color: '#1A1A2E', marginBottom: 8 },
  summaryNumbers: { flexDirection: 'row', gap: 20 },
  summaryCol: { alignItems: 'center' },
  summaryLabel: { fontSize: 12, color: '#999' },
  summaryValue: { fontSize: 22, fontWeight: 'bold', color: '#1A1A2E', marginTop: 2 },

  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1A1A2E', marginTop: 20, marginBottom: 10 },

  // Game Points grid rows
  gridGamePointsFirstRow: { borderTopWidth: 2, borderTopColor: '#999' },
  gridGamePointsText: { color: '#6A1B9A' },
  gridGameSubRowFirstRow: { borderTopWidth: 1, borderTopColor: '#D1C4E9' },
  gridMainGameText: { color: '#1565C0' },
  gridJunkGameText: { color: '#E65100' },
  gridSectionHeaderRow: {},
  gridSectionHeaderCell: { height: 20 },
  gridSectionHeaderText: { fontSize: 10, fontWeight: '700' },

  // Game Points entry section
  gamePointsHeader: {
    backgroundColor: '#F3E5F5', paddingVertical: 6, paddingHorizontal: 12,
    marginTop: 4, borderRadius: 8, marginHorizontal: 0,
  },
  gamePointsHeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  gamePointsHeaderText: { fontSize: 13, fontWeight: '700', color: '#6A1B9A' },
  gamePointsAutoLabel: {
    fontSize: 10, fontWeight: '600', color: '#9C27B0',
    backgroundColor: '#E1BEE7', paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: 4, overflow: 'hidden', marginLeft: 'auto',
  },
  gamePointCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFF', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12,
    marginBottom: 4,
  },
  gamePointPlayerName: { fontSize: 13, fontWeight: '500', color: '#1A1A2E', flex: 1 },
  gamePointControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  gamePointButton: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#F5F5F5',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E0E0E0',
  },
  gamePointValue: { fontSize: 18, fontWeight: 'bold', color: '#6A1B9A', width: 36, textAlign: 'center' },
  gamePointTotalLabel: { fontSize: 11, color: '#999', fontWeight: '500' },

  // Junk game styles
  junkGameHeader: { backgroundColor: '#FFF3E0' },
  junkGameHeaderText: { color: '#E65100' },
  junkGameValue: { color: '#E65100' },
  gamePointCardDisabled: { opacity: 0.5 },
  gamePointPlayerNameDisabled: { color: '#999' },
  gamePointDisabledLabel: { fontSize: 14, color: '#CCC', fontWeight: '600' },
  confirmDotsButton: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#E65100',
    alignItems: 'center', justifyContent: 'center', marginLeft: 4,
  },

  // Dot toggle chip styles
  dotPlayerCard: {
    backgroundColor: '#FFF', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12,
    marginBottom: 4,
  },
  dotPlayerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 6,
  },
  dotPlayerPtsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dotPlayerPts: { fontSize: 16, fontWeight: 'bold', color: '#E65100' },
  dotPlayerPtsNeg: { color: '#D32F2F' },
  dotChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  dotChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
    borderWidth: 1, borderColor: '#E0E0E0', backgroundColor: '#F5F5F5',
  },
  dotChipOn: { backgroundColor: '#E65100', borderColor: '#E65100' },
  dotChipOnNeg: { backgroundColor: '#D32F2F', borderColor: '#D32F2F' },
  dotChipDisabled: { opacity: 0.6 },
  dotChipText: { fontSize: 11, fontWeight: '600', color: '#666' },
  dotChipTextOn: { color: '#FFF' },
  dotChipAutoAwarded: { backgroundColor: '#E8F5E9', borderColor: '#66BB6A', borderStyle: 'solid' },
  dotChipTextAutoAwarded: { color: '#2E7D32' },
  dotNoQualifyLabel: { fontSize: 11, color: '#999', fontStyle: 'italic', marginTop: 2 },
  dotPlayerNamePending: { color: '#999' },
  dotPlayerPtsPending: { fontSize: 16, fontWeight: 'bold', color: '#CCC' },
  dotSummaryRow: { flexDirection: 'row', flexWrap: 'wrap', flexShrink: 1, gap: 3, marginRight: 8 },
  dotSummaryChip: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
    backgroundColor: '#FFF3E0',
  },
  dotSummaryChipText: { fontSize: 10, fontWeight: '600', color: '#E65100' },
  greenieCarryLabel: { fontSize: 11, fontWeight: '600', color: '#2E7D32', marginTop: 2, marginLeft: 18 },
  // Wolf styles
  wolfBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#6A1B9A', paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 10, marginLeft: 'auto',
  },
  wolfBadgeText: { fontSize: 11, fontWeight: '700', color: '#FFF' },
  wolfPlayerCard: {
    backgroundColor: '#F3E5F5', borderWidth: 1, borderColor: '#CE93D8',
  },
  wolfPartnerCard: {
    backgroundColor: '#E3F2FD', borderWidth: 1, borderColor: '#90CAF9',
  },
  wolfPlayerName: { fontWeight: '700', color: '#6A1B9A' },
  wolfPartnerName: { fontWeight: '600', color: '#1565C0' },
  wolfPointValues: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wolfChoicePrompt: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, backgroundColor: '#F3E5F5', borderRadius: 8,
    marginBottom: 8, borderWidth: 1.5, borderColor: '#CE93D8',
  },
  wolfChoicePromptText: { fontSize: 14, fontWeight: '600', color: '#6A1B9A' },
  wolfChoiceDisplay: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 10, backgroundColor: '#F3E5F5', borderRadius: 8,
    marginBottom: 8, borderWidth: 1, borderColor: '#CE93D8',
  },
  wolfChoiceLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wolfChoiceLabel: { fontSize: 13, fontWeight: '600', color: '#6A1B9A' },
  // Wolf modal styles
  wolfModalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
  },
  wolfModalContent: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 20,
    width: '85%', maxWidth: 380,
  },
  wolfModalTitle: { fontSize: 20, fontWeight: '800', color: '#1A1A2E', marginBottom: 2 },
  wolfModalSubtitle: { fontSize: 13, color: '#666', marginBottom: 16 },
  wolfModalSectionLabel: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 8 },
  wolfModalPartnerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, backgroundColor: '#E3F2FD', borderRadius: 10,
    marginBottom: 8, borderWidth: 1, borderColor: '#90CAF9',
  },
  wolfModalPartnerText: { fontSize: 15, fontWeight: '600', color: '#1565C0', flex: 1 },
  wolfModalPtsHint: { fontSize: 11, color: '#999' },
  wolfModalLoneBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, backgroundColor: '#F3E5F5', borderRadius: 10,
    marginTop: 4, marginBottom: 8, borderWidth: 1, borderColor: '#CE93D8',
  },
  wolfModalLoneText: { fontSize: 15, fontWeight: '600', color: '#6A1B9A', flex: 1 },
  wolfModalCancelBtn: { padding: 12, alignItems: 'center', marginTop: 4 },
  wolfModalCancelText: { fontSize: 15, color: '#999' },
  gamePointPlayerRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },

  // Team styles
  teamBanner: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 10, marginHorizontal: 10,
    marginBottom: 6, borderWidth: 1, borderColor: '#E0E0E0',
  },
  teamRotationNotice: {
    fontSize: 12, fontWeight: '700', color: '#E65100', textAlign: 'center',
    marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  teamBannerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  teamBannerSide: { flex: 1, alignItems: 'center' },
  teamBannerLabelA: { fontSize: 10, fontWeight: '700', color: '#1565C0', textTransform: 'uppercase' },
  teamBannerNamesA: { fontSize: 13, fontWeight: '600', color: '#1565C0' },
  teamBannerLabelB: { fontSize: 10, fontWeight: '700', color: '#E65100', textTransform: 'uppercase' },
  teamBannerNamesB: { fontSize: 13, fontWeight: '600', color: '#E65100' },
  teamBannerVs: { fontSize: 11, fontWeight: '700', color: '#999' },
  teamAPlayerCard: {
    backgroundColor: '#E3F2FD', borderWidth: 1, borderColor: '#90CAF9',
  },
  teamBPlayerCard: {
    backgroundColor: '#FFF3E0', borderWidth: 1, borderColor: '#FFCC80',
  },

  // ── GHIN Posting Styles ──
  ghinButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#1565C0', paddingVertical: 14, borderRadius: 10, marginTop: 16,
  },
  ghinButtonText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  ghinModalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20,
  },
  ghinModalContent: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 20, maxHeight: '85%',
  },
  ghinModalTitle: { fontSize: 20, fontWeight: 'bold', color: '#1A1A2E', marginBottom: 4 },
  ghinModalSubtitle: { fontSize: 13, color: '#666', marginBottom: 16 },
  ghinSearchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  ghinSearchInput: {
    flex: 1, borderWidth: 1, borderColor: '#DDD', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, backgroundColor: '#F9F9F9',
  },
  ghinSearchButton: {
    width: 44, height: 44, borderRadius: 8, backgroundColor: '#1565C0',
    alignItems: 'center', justifyContent: 'center',
  },
  ghinCourseList: { maxHeight: 180, marginBottom: 12 },
  ghinCourseItem: {
    padding: 12, borderRadius: 8, backgroundColor: '#F5F5F5', marginBottom: 6,
  },
  ghinCourseItemSelected: {
    backgroundColor: '#E8F5E9', borderWidth: 1, borderColor: '#2E7D32',
  },
  ghinCourseName: { fontSize: 14, fontWeight: '600', color: '#1A1A2E' },
  ghinCourseNameSelected: { color: '#2E7D32' },
  ghinCourseLocation: { fontSize: 12, color: '#999', marginTop: 2 },
  ghinPlayersSection: { marginTop: 8, marginBottom: 12 },
  ghinPlayersSectionTitle: { fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 8 },
  ghinPlayerRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
    paddingHorizontal: 12, backgroundColor: '#F9F9F9', borderRadius: 8, marginBottom: 4,
  },
  ghinPlayerName: { flex: 1, fontSize: 14, fontWeight: '500', color: '#1A1A2E' },
  ghinPlayerScore: { fontSize: 16, fontWeight: 'bold', color: '#1A1A2E', marginRight: 12 },
  ghinPlayerPending: {
    backgroundColor: '#FFF3E0', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
  },
  ghinPlayerPendingText: { fontSize: 11, fontWeight: '600', color: '#E65100' },
  ghinPlayerGhin: { fontSize: 11, color: '#999', marginTop: 1 },
  ghinWarningBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFF3E0',
    borderWidth: 1, borderColor: '#FFE0B2', borderRadius: 8, padding: 12, marginBottom: 16,
  },
  ghinWarningText: { flex: 1, fontSize: 13, color: '#E65100', fontWeight: '500', lineHeight: 18 },
  ghinPreviewSection: {
    backgroundColor: '#F5F5F5', borderRadius: 8, padding: 12, marginBottom: 12,
  },
  ghinPreviewLabel: { fontSize: 11, fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 },
  ghinPreviewValue: { fontSize: 15, fontWeight: '600', color: '#1A1A2E', marginTop: 2 },
  ghinPreviewNote: { fontSize: 12, color: '#999', fontStyle: 'italic', marginTop: 8 },
  ghinPostButtonConfirm: { backgroundColor: '#C62828' },
  ghinErrorText: { fontSize: 13, color: '#D32F2F', textAlign: 'center', marginBottom: 8 },
  ghinModalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  ghinCancelButton: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: '#DDD',
  },
  ghinCancelButtonText: { fontSize: 15, fontWeight: '600', color: '#666' },
  ghinPostButton: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#1565C0',
  },
  ghinPostButtonDisabled: { opacity: 0.5 },
  ghinPostButtonText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  // ─── iPad-specific styles ───────────────────────────────────────────
  voiceInputAreaTablet: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, paddingVertical: 8, backgroundColor: '#FFF',
    borderBottomWidth: 1, borderBottomColor: '#E0E0E0',
  },
  scorecardBackButton: {
    position: 'absolute', left: 8,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  scorecardBackText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  scorecardEndRoundButton: {
    position: 'absolute', right: 16,
    backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
  },
  scorecardEndRoundText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  // ─── Hands-free voice styles ────────────────────────────────────────
  handsFreeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#E8F5E9',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  handsFreeLabel: {
    fontSize: 13,
    color: '#2E7D32',
    fontWeight: '500',
  },
});
