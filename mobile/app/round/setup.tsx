import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useApp } from '@/src/context/AppContext';
import { usePlayers } from '@/src/context/PlayerContext';
import {
  useRound, getCourseHandicap,
  getGameTypeDisplayName, getGameTypeDescription, getGameTypeIcon,
  getDefaultConfig, AVAILABLE_DOTS,
} from '@/src/context/RoundContext';
import { Player, getPlayerDisplayName } from '@/src/models/Player';
import { Course, TeeBox } from '@/src/models/Course';
import { RoundType, HandicapMode } from '@/src/models/Round';
import { BettingGameType, DotsConfig, SkinsConfig, NassauConfig, WolfConfig, TeamMatchConfig } from '@/src/models/BettingGame';
import { TeamRotation, TeamScoringFormat, TeamPairing } from '@/src/models/Team';
import { buildTeamConfig, generateThirdsPairings } from '@/src/services/teamService';
import { useCourses } from '@/src/context/CourseContext';

type SetupStep = 'course' | 'players' | 'tees' | 'game';

const GAME_TYPES: BettingGameType[] = [
  'nassau', 'skins', 'team_match', 'baseball_3man', 'baseball_4man', 'wolf', 'stableford', 'dots', 'custom',
];

function getTeesForPlayer(teeBoxes: TeeBox[], gender: 'M' | 'F'): TeeBox[] {
  const filtered = teeBoxes.filter((t) => t.gender === gender);
  return filtered.length > 0 ? filtered : teeBoxes;
}

export default function RoundSetupScreen() {
  const router = useRouter();
  const { state: appState } = useApp();
  const { state: playerState, loadPlayers } = usePlayers();
  const { createRound, createBettingGame, startRound, getLastTeeSelections } = useRound();
  const { state: courseState, loadCourses } = useCourses();

  const [step, setStep] = useState<SetupStep>('course');
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [playerTees, setPlayerTees] = useState<Record<string, string>>({});
  const [roundType, setRoundType] = useState<RoundType>('full_18');
  const [handicapMode, setHandicapMode] = useState<HandicapMode>('full');
  const [isCreating, setIsCreating] = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);

  // Game selection state
  const [selectedGames, setSelectedGames] = useState<BettingGameType[]>([]);
  const [gameConfigs, setGameConfigs] = useState<Record<string, Record<string, unknown>>>({});
  const [useNetScores, setUseNetScores] = useState(true);

  // Team Match configuration state
  const [teamRotation, setTeamRotation] = useState<TeamRotation>('thirds');
  const [teamScoringFormat, setTeamScoringFormat] = useState<TeamScoringFormat>('two_net_low_combined');
  const [sharedJunk, setSharedJunk] = useState(false);
  const [customPairingFull, setCustomPairingFull] = useState<TeamPairing>({ teamA: [], teamB: [] });
  const [customPairingFront, setCustomPairingFront] = useState<TeamPairing>({ teamA: [], teamB: [] });
  const [customPairingBack, setCustomPairingBack] = useState<TeamPairing>({ teamA: [], teamB: [] });

  useEffect(() => {
    if (appState.isDbReady) {
      loadPlayers();
      loadCourses();
    }
  }, [appState.isDbReady]);

  function togglePlayer(playerId: string) {
    setSelectedPlayers((prev) =>
      prev.includes(playerId)
        ? prev.filter((id) => id !== playerId)
        : [...prev, playerId]
    );
  }

  function handleSelectCourse(course: Course) {
    setSelectedCourse(course);
    if (course.teeBoxes.length > 0) {
      const defaultTee = course.teeBoxes[0].id;
      const newTees: Record<string, string> = {};
      selectedPlayers.forEach((pid) => { newTees[pid] = defaultTee; });
      setPlayerTees(newTees);
    }
    setStep('players');
  }

  async function handlePlayersConfirmed() {
    if (selectedPlayers.length === 0) {
      Alert.alert('Select Players', 'Please select at least one player.');
      return;
    }

    let lastTees: Record<string, string> = {};
    if (selectedCourse) {
      try { lastTees = await getLastTeeSelections(selectedCourse.id, selectedPlayers); } catch { }
    }

    if (selectedCourse && selectedCourse.teeBoxes.length > 0) {
      const newTees: Record<string, string> = {};
      selectedPlayers.forEach((pid) => {
        if (playerTees[pid]) {
          newTees[pid] = playerTees[pid];
        } else if (lastTees[pid]) {
          const teeExists = selectedCourse.teeBoxes.some((t) => t.id === lastTees[pid]);
          if (teeExists) {
            newTees[pid] = lastTees[pid];
          } else {
            const player = playerState.players.find((p) => p.id === pid);
            const genderTees = getTeesForPlayer(selectedCourse.teeBoxes, player?.gender ?? 'M');
            newTees[pid] = genderTees[0].id;
          }
        } else {
          const player = playerState.players.find((p) => p.id === pid);
          const genderTees = getTeesForPlayer(selectedCourse.teeBoxes, player?.gender ?? 'M');
          newTees[pid] = genderTees[0].id;
        }
      });
      setPlayerTees(newTees);
    }
    setStep('tees');
  }

  // ── Game selection helpers ──

  function toggleGameType(type: BettingGameType) {
    setSelectedGames((prev) => {
      if (prev.includes(type)) {
        return prev.filter((t) => t !== type);
      }
      // Validate player count for baseball
      if (type === 'baseball_3man' && selectedPlayers.length !== 3) {
        Alert.alert('3 Players Required', '3-Man Baseball requires exactly 3 players.');
        return prev;
      }
      if (type === 'baseball_4man' && selectedPlayers.length !== 4) {
        Alert.alert('4 Players Required', '4-Man Baseball requires exactly 4 players.');
        return prev;
      }
      if (type === 'team_match' && selectedPlayers.length !== 4) {
        Alert.alert('4 Players Required', 'Team Match requires exactly 4 players (2v2).');
        return prev;
      }
      // Add and initialize default config if needed
      if (!gameConfigs[type]) {
        setGameConfigs((configs) => ({ ...configs, [type]: getDefaultConfig(type) }));
      }
      return [...prev, type];
    });
  }

  function updateGameConfig(type: string, key: string, value: unknown) {
    setGameConfigs((prev) => ({
      ...prev,
      [type]: { ...(prev[type] || {}), [key]: value },
    }));
  }

  function toggleDot(dotId: string) {
    const current = (gameConfigs['dots'] as unknown as DotsConfig)?.activeDots || [];
    const updated = current.includes(dotId)
      ? current.filter((d: string) => d !== dotId)
      : [...current, dotId];
    updateGameConfig('dots', 'activeDots', updated);
  }

  // ── Team Match helpers ──

  const showTeamConfig = selectedPlayers.length === 4 && selectedGames.includes('team_match');
  const showSharedJunkToggle = showTeamConfig && selectedGames.includes('dots');

  // Initialize custom pairings when players change
  useEffect(() => {
    if (selectedPlayers.length === 4) {
      const [a, b, c, d] = selectedPlayers;
      setCustomPairingFull({ teamA: [a, b], teamB: [c, d] });
      setCustomPairingFront({ teamA: [a, b], teamB: [c, d] });
      setCustomPairingBack({ teamA: [a, c], teamB: [b, d] });
    }
  }, [selectedPlayers.join(',')]);

  function swapPlayerTeam(
    pairing: TeamPairing,
    setPairing: (p: TeamPairing) => void,
    playerId: string,
  ) {
    if (pairing.teamA.includes(playerId)) {
      setPairing({
        teamA: pairing.teamA.filter((id) => id !== playerId),
        teamB: [...pairing.teamB, playerId],
      });
    } else {
      setPairing({
        teamA: [...pairing.teamA, playerId],
        teamB: pairing.teamB.filter((id) => id !== playerId),
      });
    }
  }

  function buildCurrentTeamConfig() {
    if (!showTeamConfig) return undefined;
    try {
      switch (teamRotation) {
        case 'thirds':
          return buildTeamConfig(teamRotation, teamScoringFormat, selectedPlayers, sharedJunk);
        case 'full_18':
          return buildTeamConfig(teamRotation, teamScoringFormat, selectedPlayers, sharedJunk, [customPairingFull]);
        case 'halves':
          return buildTeamConfig(teamRotation, teamScoringFormat, selectedPlayers, sharedJunk, [customPairingFront, customPairingBack]);
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }

  // ── Round creation ──

  async function handleCreateRound() {
    if (!selectedCourse) return;
    setIsCreating(true);
    try {
      const players = selectedPlayers.map((pid) => ({
        playerId: pid,
        teeBoxId: playerTees[pid],
      }));

      const teamConfig = buildCurrentTeamConfig();
      const round = await createRound(
        { courseId: selectedCourse.id, roundType, handicapMode, players, teamConfig },
        playerState.players,
      );

      // Create betting games
      for (const gameType of selectedGames) {
        let config = gameConfigs[gameType] || getDefaultConfig(gameType);
        // Inject player order and derive loneWolfPoints into wolf config
        if (gameType === 'wolf') {
          const teamPts = (config as unknown as WolfConfig).teamPoints ?? 2;
          config = { ...config, playerOrder: selectedPlayers, loneWolfPoints: teamPts * 2, sharedJunk };
        }
        await createBettingGame({
          roundId: round.id,
          type: gameType,
          name: getGameTypeDisplayName(gameType),
          useNetScores,
          config,
        });
      }

      await startRound();
      router.replace(`/round/${round.id}`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create round');
    } finally {
      setIsCreating(false);
    }
  }

  // ═══════════════════════════════════════════════════
  // STEP 1: Select Course
  // ═══════════════════════════════════════════════════
  if (step === 'course') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.stepTitle}>1. Select Course</Text>

        <TouchableOpacity
          style={styles.searchButton}
          onPress={() => router.push('/course/search')}
        >
          <FontAwesome name="search" size={16} color="#2E7D32" />
          <Text style={styles.searchButtonText}>Search for a Course</Text>
        </TouchableOpacity>

        {courseState.courses.length > 0 && (
          <>
            <Text style={styles.orText}>or select a saved course:</Text>
            {courseState.courses.map((course) => (
              <TouchableOpacity
                key={course.id}
                style={styles.courseCard}
                onPress={() => handleSelectCourse(course)}
              >
                <Text style={styles.courseName}>{course.name}</Text>
                <Text style={styles.courseLocation}>
                  {[course.city, course.state].filter(Boolean).join(', ')}
                </Text>
                <Text style={styles.courseInfo}>
                  {course.numberOfHoles} holes - {course.teeBoxes.length} tee{course.teeBoxes.length !== 1 ? 's' : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        {courseState.courses.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No saved courses</Text>
            <Text style={styles.emptySubtext}>Search for a course to get started</Text>
          </View>
        )}
      </ScrollView>
    );
  }

  // ═══════════════════════════════════════════════════
  // STEP 2: Select Players
  // ═══════════════════════════════════════════════════
  if (step === 'players') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.stepTitle}>2. Select Players</Text>
        <Text style={styles.courseSelected}>{selectedCourse?.name}</Text>

        {playerState.players.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No players yet</Text>
            <TouchableOpacity
              style={styles.addPlayerButton}
              onPress={() => router.push('/player/add')}
            >
              <Text style={styles.addPlayerText}>Add a Player First</Text>
            </TouchableOpacity>
          </View>
        ) : (
          playerState.players.map((player) => {
            const isSelected = selectedPlayers.includes(player.id);
            return (
              <TouchableOpacity
                key={player.id}
                style={[styles.playerRow, isSelected && styles.playerRowSelected]}
                onPress={() => togglePlayer(player.id)}
              >
                <FontAwesome
                  name={isSelected ? 'check-square-o' : 'square-o'}
                  size={22}
                  color={isSelected ? '#2E7D32' : '#999'}
                />
                <View style={styles.playerRowInfo}>
                  <Text style={styles.playerRowName}>{getPlayerDisplayName(player)}</Text>
                  <Text style={styles.playerRowHdcp}>Index: {player.handicapIndex.toFixed(1)}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}

        <Text style={[styles.label, { marginTop: 20 }]}>Round Type</Text>
        <View style={styles.roundTypeRow}>
          {(['full_18', 'front_9', 'back_9'] as RoundType[]).map((type) => (
            <TouchableOpacity
              key={type}
              style={[styles.roundTypeButton, roundType === type && styles.roundTypeSelected]}
              onPress={() => setRoundType(type)}
            >
              <Text style={[styles.roundTypeText, roundType === type && styles.roundTypeTextSelected]}>
                {type === 'full_18' ? '18 Holes' : type === 'front_9' ? 'Front 9' : 'Back 9'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.label, { marginTop: 20 }]}>Handicap Strokes</Text>
        <View style={styles.roundTypeRow}>
          {([
            { value: 'full' as HandicapMode, label: 'Full Handicap' },
            { value: 'spin_off_low' as HandicapMode, label: 'Spin Off Low' },
          ]).map(({ value, label }) => (
            <TouchableOpacity
              key={value}
              style={[styles.roundTypeButton, handicapMode === value && styles.roundTypeSelected]}
              onPress={() => setHandicapMode(value)}
            >
              <Text style={[styles.roundTypeText, handicapMode === value && styles.roundTypeTextSelected]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.handicapModeHint}>
          {handicapMode === 'full'
            ? 'Each player receives strokes based on their full course handicap.'
            : 'Strokes are relative to the lowest handicap player in the group.'}
        </Text>

        <View style={styles.navRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => setStep('course')}>
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.nextButton} onPress={handlePlayersConfirmed}>
            <Text style={styles.nextButtonText}>Next</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // ═══════════════════════════════════════════════════
  // STEP 3: Select Tees
  // ═══════════════════════════════════════════════════
  if (step === 'tees') {
    const roundTypeLabel = roundType === 'full_18' ? '18 Holes' : roundType === 'front_9' ? 'Front 9' : 'Back 9';
    const handicapLabel = handicapMode === 'full' ? 'Full Handicap' : 'Spin Off Low';

    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.stepTitle}>3. Select Tees</Text>

        <View style={styles.roundSummary}>
          <Text style={styles.roundSummaryName}>{selectedCourse?.name}</Text>
          <Text style={styles.roundSummaryDetail}>
            {roundTypeLabel}  ·  {handicapLabel}
          </Text>
        </View>

        {selectedPlayers.map((pid) => {
          const player = playerState.players.find((p) => p.id === pid);
          if (!player) return null;
          const availableTees = selectedCourse
            ? getTeesForPlayer(selectedCourse.teeBoxes, player.gender)
            : [];
          const selectedTee = availableTees.find((t) => t.id === playerTees[pid]);
          const isExpanded = expandedPlayer === pid;
          const currentCH = selectedTee ? getCourseHandicap(player.handicapIndex, selectedTee) : '-';

          return (
            <View key={pid} style={styles.teeSection}>
              <TouchableOpacity
                style={styles.teePickerRow}
                onPress={() => setExpandedPlayer(isExpanded ? null : pid)}
              >
                <View style={styles.teePickerLeft}>
                  <Text style={styles.teePlayerName}>{getPlayerDisplayName(player)}</Text>
                  <Text style={styles.teePickerCurrent}>
                    {selectedTee ? selectedTee.name : 'Select tee...'}
                    {selectedTee ? `  ·  Index ${player.handicapIndex.toFixed(1)}  ·  CH ${currentCH}` : ''}
                  </Text>
                </View>
                <FontAwesome
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color="#666"
                />
              </TouchableOpacity>

              {isExpanded && (
                <View style={styles.teeDropdown}>
                  {availableTees.map((tee) => {
                    const isSelected = playerTees[pid] === tee.id;
                    const ch = getCourseHandicap(player.handicapIndex, tee);
                    return (
                      <TouchableOpacity
                        key={tee.id}
                        style={[styles.teeOption, isSelected && styles.teeOptionSelected]}
                        onPress={() => {
                          setPlayerTees((prev) => ({ ...prev, [pid]: tee.id }));
                          setExpandedPlayer(null);
                        }}
                      >
                        <View style={styles.teeOptionLeft}>
                          <View style={styles.teeOptionHeader}>
                            <Text style={[styles.teeOptionName, isSelected && styles.teeOptionNameSelected]}>
                              {tee.name}
                            </Text>
                            <Text style={[styles.teeOptionCH, isSelected && styles.teeOptionCHSelected]}>
                              CH {ch}
                            </Text>
                          </View>
                          <Text style={styles.teeOptionDetail}>
                            Rating {tee.courseRating} / Slope {tee.slopeRating}
                            {tee.yardage ? ` / ${tee.yardage} yds` : ''}
                            {'  ·  Index '}
                            {player.handicapIndex.toFixed(1)}
                          </Text>
                        </View>
                        {isSelected && (
                          <FontAwesome name="check" size={16} color="#2E7D32" />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}

        <View style={styles.navRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => setStep('players')}>
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.nextButton} onPress={() => setStep('game')}>
            <Text style={styles.nextButtonText}>Next</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // ═══════════════════════════════════════════════════
  // STEP 4: Select Game(s)
  // ═══════════════════════════════════════════════════
  const roundTypeLabel = roundType === 'full_18' ? '18 Holes' : roundType === 'front_9' ? 'Front 9' : 'Back 9';
  const handicapLabel = handicapMode === 'full' ? 'Full Handicap' : 'Spin Off Low';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.stepTitle}>4. Select Game(s)</Text>

      <View style={styles.roundSummary}>
        <Text style={styles.roundSummaryName}>{selectedCourse?.name}</Text>
        <Text style={styles.roundSummaryDetail}>
          {roundTypeLabel}  ·  {handicapLabel}  ·  {selectedPlayers.length} players
        </Text>
      </View>

      {/* Game type cards */}
      <View style={styles.gameGrid}>
        {GAME_TYPES.map((type) => {
          const isSelected = selectedGames.includes(type);
          return (
            <TouchableOpacity
              key={type}
              style={[styles.gameCard, isSelected && styles.gameCardSelected]}
              onPress={() => toggleGameType(type)}
            >
              <View style={styles.gameCardHeader}>
                <FontAwesome
                  name={getGameTypeIcon(type) as any}
                  size={16}
                  color={isSelected ? '#2E7D32' : '#999'}
                />
                {isSelected && (
                  <FontAwesome name="check-circle" size={14} color="#2E7D32" />
                )}
              </View>
              <Text style={[styles.gameCardName, isSelected && styles.gameCardNameSelected]}>
                {getGameTypeDisplayName(type)}
              </Text>
              <Text style={styles.gameCardDesc} numberOfLines={2}>
                {getGameTypeDescription(type)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Game configurations for selected games */}
      {selectedGames.length > 0 && (
        <>
          {/* Shared: Net vs Gross */}
          {(() => {
            const baseballSelected = selectedGames.includes('baseball_3man') || selectedGames.includes('baseball_4man');
            return (
              <View style={styles.configSection}>
                <View style={styles.configRow}>
                  <Text style={styles.configLabel}>Use Net Scores</Text>
                  <Switch
                    value={useNetScores || baseballSelected}
                    onValueChange={baseballSelected ? undefined : setUseNetScores}
                    disabled={baseballSelected}
                    trackColor={{ true: '#2E7D32' }}
                  />
                </View>
                <Text style={styles.configHint}>
                  {baseballSelected
                    ? 'Baseball games always use net scores.'
                    : useNetScores
                      ? 'Points calculated from net scores (with handicap strokes).'
                      : 'Points calculated from gross scores.'}
                </Text>
              </View>
            );
          })()}

          {/* Nassau config */}
          {selectedGames.includes('nassau') && (
            <View style={styles.configSection}>
              <Text style={styles.configTitle}>Nassau Settings</Text>
              <Text style={styles.configHint}>
                Three separate bets: Front 9, Back 9, and Overall 18.
                1 point per hole to the low net score. Ties = no points.
              </Text>
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Auto-Press</Text>
                <Switch
                  value={(gameConfigs['nassau'] as unknown as NassauConfig)?.autoPresses ?? false}
                  onValueChange={(v) => updateGameConfig('nassau', 'autoPresses', v)}
                  trackColor={{ true: '#2E7D32' }}
                />
              </View>
            </View>
          )}

          {/* Team Match config */}
          {showTeamConfig && (
            <View style={styles.configSection}>
              <Text style={[styles.configTitle, { color: '#1565C0' }]}>Team Match</Text>
              <Text style={styles.configHint}>
                2v2 — winning team earns points each hole. Ties = 0.
              </Text>

              {/* Points per hole won — single picker for most formats, low/high for dual */}
              {teamScoringFormat !== 'low_vs_low_high_vs_high' ? (
                <>
                  <Text style={[styles.configLabel, { marginTop: 6 }]}>Points Per Hole Won</Text>
                  <View style={styles.roundTypeRow}>
                    {[1, 2, 3, 5].map((val) => {
                      const current = (gameConfigs['team_match'] as unknown as TeamMatchConfig)?.pointsPerHoleWon ?? 1;
                      return (
                        <TouchableOpacity
                          key={val}
                          style={[styles.roundTypeButton, current === val && styles.teamOptionSelected]}
                          onPress={() => updateGameConfig('team_match', 'pointsPerHoleWon', val)}
                        >
                          <Text style={[styles.roundTypeText, current === val && styles.teamOptionTextSelected]}>
                            {val}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              ) : (
                <>
                  <Text style={[styles.configLabel, { marginTop: 6 }]}>Low Net Match Points</Text>
                  <View style={styles.roundTypeRow}>
                    {[1, 2, 3, 5].map((val) => {
                      const current = (gameConfigs['team_match'] as unknown as TeamMatchConfig)?.lowMatchPoints ?? 1;
                      return (
                        <TouchableOpacity
                          key={val}
                          style={[styles.roundTypeButton, current === val && styles.teamOptionSelected]}
                          onPress={() => updateGameConfig('team_match', 'lowMatchPoints', val)}
                        >
                          <Text style={[styles.roundTypeText, current === val && styles.teamOptionTextSelected]}>
                            {val}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={[styles.configLabel, { marginTop: 8 }]}>High Net Match Points</Text>
                  <View style={styles.roundTypeRow}>
                    {[1, 2, 3, 5].map((val) => {
                      const current = (gameConfigs['team_match'] as unknown as TeamMatchConfig)?.highMatchPoints ?? 1;
                      return (
                        <TouchableOpacity
                          key={val}
                          style={[styles.roundTypeButton, current === val && styles.teamOptionSelected]}
                          onPress={() => updateGameConfig('team_match', 'highMatchPoints', val)}
                        >
                          <Text style={[styles.roundTypeText, current === val && styles.teamOptionTextSelected]}>
                            {val}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {/* Rotation picker */}
              <Text style={[styles.configLabel, { marginTop: 10 }]}>Rotation</Text>
              <View style={styles.roundTypeRow}>
                {([
                  { value: 'thirds' as TeamRotation, label: 'Thirds' },
                  { value: 'halves' as TeamRotation, label: 'Halves' },
                  { value: 'full_18' as TeamRotation, label: 'Full 18' },
                ]).map(({ value, label }) => (
                  <TouchableOpacity
                    key={value}
                    style={[styles.roundTypeButton, teamRotation === value && styles.teamOptionSelected]}
                    onPress={() => setTeamRotation(value)}
                  >
                    <Text style={[styles.roundTypeText, teamRotation === value && styles.teamOptionTextSelected]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.configHint}>
                {teamRotation === 'thirds'
                  ? 'Teams rotate every 6 holes — every player partners with each other exactly once.'
                  : teamRotation === 'halves'
                    ? 'Different teams for front 9 and back 9.'
                    : 'Same teams for all 18 holes.'}
              </Text>

              {/* Scoring format picker */}
              <Text style={[styles.configLabel, { marginTop: 10 }]}>Scoring Format</Text>
              {([
                { value: 'two_net_low_combined' as TeamScoringFormat, label: 'Two Net Low Combined', desc: 'Sum both nets; lower total wins' },
                { value: 'one_net_low_tiebreaker' as TeamScoringFormat, label: 'One Net Low + Tiebreaker', desc: 'Best net counts; 2nd net breaks ties' },
                { value: 'net_high_and_low' as TeamScoringFormat, label: 'Net High & Low', desc: 'Best net + worst net; lower total wins' },
                { value: 'low_vs_low_high_vs_high' as TeamScoringFormat, label: 'Low vs Low / High vs High', desc: 'Two sub-bets: best nets compete, worst nets compete' },
              ]).map(({ value, label, desc }) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.teamFormatOption, teamScoringFormat === value && styles.teamFormatSelected]}
                  onPress={() => setTeamScoringFormat(value)}
                >
                  <View style={styles.teamFormatLeft}>
                    <FontAwesome
                      name={teamScoringFormat === value ? 'dot-circle-o' : 'circle-o'}
                      size={16}
                      color={teamScoringFormat === value ? '#1565C0' : '#999'}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.teamFormatLabel, teamScoringFormat === value && { color: '#1565C0' }]}>
                        {label}
                      </Text>
                      <Text style={styles.teamFormatDesc}>{desc}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}

              {/* Shared junk toggle */}
              {showSharedJunkToggle && (
                <>
                  <View style={[styles.configRow, { marginTop: 10 }]}>
                    <Text style={styles.configLabel}>Shared Junk</Text>
                    <Switch
                      value={sharedJunk}
                      onValueChange={setSharedJunk}
                      trackColor={{ true: '#1565C0' }}
                    />
                  </View>
                  <Text style={styles.configHint}>
                    {sharedJunk
                      ? 'Teammates share dots — if your partner earns a sandy, you both benefit.'
                      : 'Dots are earned individually, regardless of teams.'}
                  </Text>
                </>
              )}

              {/* Team assignment / preview */}
              {teamRotation === 'thirds' && (
                <View style={styles.teamPreviewSection}>
                  <Text style={[styles.configLabel, { marginTop: 10 }]}>Pairings Preview</Text>
                  {selectedPlayers.length === 4 && generateThirdsPairings(selectedPlayers).map((p, idx) => {
                    const periodLabels = ['Holes 1–6', 'Holes 7–12', 'Holes 13–18'];
                    const getNames = (ids: string[]) =>
                      ids.map((id) => {
                        const pl = playerState.players.find((x) => x.id === id);
                        return pl ? getPlayerDisplayName(pl) : id;
                      }).join(' & ');
                    return (
                      <View key={idx} style={styles.teamPreviewRow}>
                        <Text style={styles.teamPreviewPeriod}>{periodLabels[idx]}</Text>
                        <View style={styles.teamPreviewTeams}>
                          <Text style={styles.teamPreviewTeamA}>{getNames(p.teamA)}</Text>
                          <Text style={styles.teamPreviewVs}>vs</Text>
                          <Text style={styles.teamPreviewTeamB}>{getNames(p.teamB)}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {teamRotation === 'full_18' && (
                <View style={styles.teamPreviewSection}>
                  <Text style={[styles.configLabel, { marginTop: 10 }]}>Team Assignment</Text>
                  <Text style={styles.configHint}>Tap a player to swap teams.</Text>
                  <View style={styles.teamAssignRow}>
                    <View style={styles.teamAssignCol}>
                      <Text style={styles.teamAssignHeader}>Team A</Text>
                      {selectedPlayers.map((pid) => {
                        if (!customPairingFull.teamA.includes(pid)) return null;
                        const pl = playerState.players.find((p) => p.id === pid);
                        return (
                          <TouchableOpacity
                            key={pid}
                            style={styles.teamAssignPlayerA}
                            onPress={() => swapPlayerTeam(customPairingFull, setCustomPairingFull, pid)}
                          >
                            <Text style={styles.teamAssignPlayerText}>
                              {pl ? getPlayerDisplayName(pl) : pid}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={styles.teamAssignCol}>
                      <Text style={styles.teamAssignHeader}>Team B</Text>
                      {selectedPlayers.map((pid) => {
                        if (!customPairingFull.teamB.includes(pid)) return null;
                        const pl = playerState.players.find((p) => p.id === pid);
                        return (
                          <TouchableOpacity
                            key={pid}
                            style={styles.teamAssignPlayerB}
                            onPress={() => swapPlayerTeam(customPairingFull, setCustomPairingFull, pid)}
                          >
                            <Text style={styles.teamAssignPlayerText}>
                              {pl ? getPlayerDisplayName(pl) : pid}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                </View>
              )}

              {teamRotation === 'halves' && (
                <View style={styles.teamPreviewSection}>
                  <Text style={[styles.configLabel, { marginTop: 10 }]}>Front 9 Teams</Text>
                  <Text style={styles.configHint}>Tap a player to swap teams.</Text>
                  <View style={styles.teamAssignRow}>
                    <View style={styles.teamAssignCol}>
                      <Text style={styles.teamAssignHeader}>Team A</Text>
                      {selectedPlayers.map((pid) => {
                        if (!customPairingFront.teamA.includes(pid)) return null;
                        const pl = playerState.players.find((p) => p.id === pid);
                        return (
                          <TouchableOpacity
                            key={pid}
                            style={styles.teamAssignPlayerA}
                            onPress={() => swapPlayerTeam(customPairingFront, setCustomPairingFront, pid)}
                          >
                            <Text style={styles.teamAssignPlayerText}>
                              {pl ? getPlayerDisplayName(pl) : pid}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={styles.teamAssignCol}>
                      <Text style={styles.teamAssignHeader}>Team B</Text>
                      {selectedPlayers.map((pid) => {
                        if (!customPairingFront.teamB.includes(pid)) return null;
                        const pl = playerState.players.find((p) => p.id === pid);
                        return (
                          <TouchableOpacity
                            key={pid}
                            style={styles.teamAssignPlayerB}
                            onPress={() => swapPlayerTeam(customPairingFront, setCustomPairingFront, pid)}
                          >
                            <Text style={styles.teamAssignPlayerText}>
                              {pl ? getPlayerDisplayName(pl) : pid}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>

                  <Text style={[styles.configLabel, { marginTop: 14 }]}>Back 9 Teams</Text>
                  <View style={styles.teamAssignRow}>
                    <View style={styles.teamAssignCol}>
                      <Text style={styles.teamAssignHeader}>Team A</Text>
                      {selectedPlayers.map((pid) => {
                        if (!customPairingBack.teamA.includes(pid)) return null;
                        const pl = playerState.players.find((p) => p.id === pid);
                        return (
                          <TouchableOpacity
                            key={pid}
                            style={styles.teamAssignPlayerA}
                            onPress={() => swapPlayerTeam(customPairingBack, setCustomPairingBack, pid)}
                          >
                            <Text style={styles.teamAssignPlayerText}>
                              {pl ? getPlayerDisplayName(pl) : pid}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={styles.teamAssignCol}>
                      <Text style={styles.teamAssignHeader}>Team B</Text>
                      {selectedPlayers.map((pid) => {
                        if (!customPairingBack.teamB.includes(pid)) return null;
                        const pl = playerState.players.find((p) => p.id === pid);
                        return (
                          <TouchableOpacity
                            key={pid}
                            style={styles.teamAssignPlayerB}
                            onPress={() => swapPlayerTeam(customPairingBack, setCustomPairingBack, pid)}
                          >
                            <Text style={styles.teamAssignPlayerText}>
                              {pl ? getPlayerDisplayName(pl) : pid}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Skins config */}
          {selectedGames.includes('skins') && (
            <View style={styles.configSection}>
              <Text style={styles.configTitle}>Skins Settings</Text>
              <Text style={styles.configHint}>
                Each hole is a skin. Lowest net wins outright; ties carry over.
              </Text>
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Carry Over Ties</Text>
                <Switch
                  value={(gameConfigs['skins'] as unknown as SkinsConfig)?.carryOver ?? true}
                  onValueChange={(v) => updateGameConfig('skins', 'carryOver', v)}
                  trackColor={{ true: '#2E7D32' }}
                />
              </View>
            </View>
          )}

          {/* 3-Man Baseball info */}
          {selectedGames.includes('baseball_3man') && (
            <View style={styles.configSection}>
              <Text style={styles.configTitle}>3-Man Baseball</Text>
              <Text style={styles.configHint}>
                9 points distributed each hole by net score ranking. All-tie carries to next hole.
              </Text>
              <View style={styles.stablefordScale}>
                {[
                  ['All unique (1st / 2nd / 3rd)', '5 / 3 / 1'],
                  ['Two-way tie for 1st', '4 / 4 / 1'],
                  ['Two-way tie for 2nd', '5 / 2 / 2'],
                  ['Three-way tie', 'Carry 9'],
                ].map(([label, pts]) => (
                  <View key={label} style={styles.stablefordRow}>
                    <Text style={styles.stablefordLabel}>{label}</Text>
                    <Text style={styles.stablefordPts}>{pts}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* 4-Man Baseball info */}
          {selectedGames.includes('baseball_4man') && (
            <View style={styles.configSection}>
              <Text style={styles.configTitle}>4-Man Baseball</Text>
              <Text style={styles.configHint}>
                12 points distributed each hole by net score ranking. All-tie carries to next hole.
              </Text>
              <View style={styles.stablefordScale}>
                {[
                  ['All unique (1st / 2nd / 3rd / 4th)', '6 / 4 / 2 / 0'],
                  ['Two-way tie for 1st', '5 / 5 / 1 / 1'],
                  ['Two-way tie for 2nd', '6 / 3 / 3 / 0'],
                  ['Two-way tie for 3rd', '6 / 4 / 1 / 1'],
                  ['Three-way tie for 1st', '4 / 4 / 4 / 0'],
                  ['Three-way tie for 2nd', '6 / 2 / 2 / 2'],
                  ['Two pairs tied', '5 / 5 / 1 / 1'],
                  ['Four-way tie', 'Carry 12'],
                ].map(([label, pts]) => (
                  <View key={label} style={styles.stablefordRow}>
                    <Text style={styles.stablefordLabel}>{label}</Text>
                    <Text style={styles.stablefordPts}>{pts}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Wolf config */}
          {selectedGames.includes('wolf') && (() => {
            const wolfTeamPts = (gameConfigs['wolf'] as unknown as WolfConfig)?.teamPoints ?? 2;
            const wolfHitsFirst = (gameConfigs['wolf'] as unknown as WolfConfig)?.wolfHitsFirst ?? false;
            const loneWolfJunk3x = (gameConfigs['wolf'] as unknown as WolfConfig)?.loneWolfJunk3x ?? false;
            return (
              <View style={styles.configSection}>
                <Text style={styles.configTitle}>Wolf Settings</Text>
                <Text style={styles.configHint}>
                  Rotating wolf picks partner (2v2) or goes alone (1v3).
                </Text>

                <Text style={[styles.configLabel, { marginTop: 6 }]}>Points Per Hole</Text>
                <View style={styles.roundTypeRow}>
                  {[1, 2, 3, 4, 5].map((val) => (
                    <TouchableOpacity
                      key={val}
                      style={[styles.roundTypeButton, wolfTeamPts === val && styles.wolfOptionSelected]}
                      onPress={() => updateGameConfig('wolf', 'teamPoints', val)}
                    >
                      <Text style={[styles.roundTypeText, wolfTeamPts === val && styles.wolfOptionTextSelected]}>
                        {val}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.configHint}>
                  Team: {wolfTeamPts} pts/player  |  Lone Wolf: {wolfTeamPts * 2} pts/opponent
                </Text>

                <View style={styles.wolfHitsRow}>
                  <Text style={styles.configLabel}>Wolf Hits First</Text>
                  <Switch
                    value={wolfHitsFirst}
                    onValueChange={(v) => updateGameConfig('wolf', 'wolfHitsFirst', v)}
                    trackColor={{ false: '#CCC', true: '#CE93D8' }}
                    thumbColor={wolfHitsFirst ? '#6A1B9A' : '#FFF'}
                  />
                </View>
                <Text style={styles.configHint}>
                  {wolfHitsFirst
                    ? 'Wolf tees off first, then picks a partner after seeing drives.'
                    : 'Wolf tees off last, seeing all drives before choosing.'}
                </Text>

                <View style={styles.wolfHitsRow}>
                  <Text style={styles.configLabel}>Lone Wolf 3x Junk</Text>
                  <Switch
                    value={loneWolfJunk3x}
                    onValueChange={(v) => updateGameConfig('wolf', 'loneWolfJunk3x', v)}
                    trackColor={{ false: '#CCC', true: '#CE93D8' }}
                    thumbColor={loneWolfJunk3x ? '#6A1B9A' : '#FFF'}
                  />
                </View>
                <Text style={styles.configHint}>
                  {loneWolfJunk3x
                    ? 'Lone wolf earns 3x junk points on holes they go alone.'
                    : 'Lone wolf earns standard junk points.'}
                </Text>

                {selectedGames.includes('dots') && (
                  <>
                    <View style={styles.wolfHitsRow}>
                      <Text style={styles.configLabel}>Shared Junk</Text>
                      <Switch
                        value={sharedJunk}
                        onValueChange={setSharedJunk}
                        trackColor={{ false: '#CCC', true: '#CE93D8' }}
                        thumbColor={sharedJunk ? '#6A1B9A' : '#FFF'}
                      />
                    </View>
                    <Text style={styles.configHint}>
                      {sharedJunk
                        ? 'Teammates share dots — if your partner earns a sandy, you both benefit.'
                        : 'Dots are earned individually, regardless of wolf teams.'}
                    </Text>
                  </>
                )}

                <Text style={[styles.configLabel, { marginTop: 10 }]}>Wolf Rotation</Text>
                {selectedPlayers.map((pid, idx) => {
                  const player = playerState.players.find((p) => p.id === pid);
                  if (!player) return null;
                  return (
                    <View key={pid} style={styles.wolfOrderRow}>
                      <Text style={styles.wolfOrderNum}>{idx + 1}.</Text>
                      <Text style={styles.wolfOrderName}>{getPlayerDisplayName(player)}</Text>
                    </View>
                  );
                })}
              </View>
            );
          })()}

          {/* Stableford config */}
          {selectedGames.includes('stableford') && (
            <View style={styles.configSection}>
              <Text style={styles.configTitle}>Stableford Scoring</Text>
              <Text style={styles.configHint}>
                Points based on net score vs par. Manual entry for now.
              </Text>
              <View style={styles.stablefordScale}>
                {[
                  ['Albatross (3 under)', '5 pts'],
                  ['Eagle (2 under)', '4 pts'],
                  ['Birdie (1 under)', '3 pts'],
                  ['Par', '2 pts'],
                  ['Bogey (1 over)', '1 pt'],
                  ['Double bogey+', '0 pts'],
                ].map(([label, pts]) => (
                  <View key={label} style={styles.stablefordRow}>
                    <Text style={styles.stablefordLabel}>{label}</Text>
                    <Text style={styles.stablefordPts}>{pts}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Dots config */}
          {selectedGames.includes('dots') && (
            <View style={styles.configSection}>
              <Text style={styles.configTitle}>Junk / Dots</Text>

              {/* Junk multiplier picker */}
              <Text style={styles.configLabel}>Relative Value to Main Game</Text>
              <View style={styles.multiplierRow}>
                {([
                  { value: 0.5, label: '50%' },
                  { value: 1, label: '100%' },
                  { value: 2, label: '200%' },
                ] as const).map(({ value, label }) => {
                  const currentMult = (gameConfigs['dots'] as unknown as DotsConfig)?.junkMultiplier ?? 1;
                  const isActive = currentMult === value;
                  return (
                    <TouchableOpacity
                      key={value}
                      style={[styles.multiplierButton, isActive && styles.multiplierButtonActive]}
                      onPress={() => updateGameConfig('dots', 'junkMultiplier', value)}
                    >
                      <Text style={[styles.multiplierButtonText, isActive && styles.multiplierButtonTextActive]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.configHint}>
                Each junk dot is worth {((gameConfigs['dots'] as unknown as DotsConfig)?.junkMultiplier ?? 1) === 1
                  ? '1 point (same as main game).'
                  : `${(gameConfigs['dots'] as unknown as DotsConfig)?.junkMultiplier ?? 1} points relative to main game.`}
              </Text>

              <Text style={[styles.configLabel, { marginTop: 10 }]}>Active Dots</Text>
              {AVAILABLE_DOTS.map((dot) => {
                const activeDots = (gameConfigs['dots'] as unknown as DotsConfig)?.activeDots || [];
                const isActive = activeDots.includes(dot.id);
                return (
                  <TouchableOpacity
                    key={dot.id}
                    style={styles.dotRow}
                    onPress={() => toggleDot(dot.id)}
                  >
                    <FontAwesome
                      name={isActive ? 'check-square-o' : 'square-o'}
                      size={18}
                      color={isActive ? '#2E7D32' : '#999'}
                    />
                    <View style={styles.dotInfo}>
                      <Text style={styles.dotName}>
                        {dot.name}
                        {dot.autoCalculated ? (
                          <Text style={styles.dotPtsAuto}>{' '}Auto</Text>
                        ) : (
                          <Text style={[styles.dotPts, dot.points < 0 && styles.dotPtsNegative]}>
                            {' '}{dot.points > 0 ? `+${dot.points}` : dot.points}{Math.abs(dot.points) === 1 ? 'pt' : 'pts'}
                          </Text>
                        )}
                      </Text>
                      <Text style={styles.dotDesc}>{dot.description}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Custom info */}
          {selectedGames.includes('custom') && (
            <View style={styles.configSection}>
              <Text style={styles.configTitle}>Custom Game</Text>
              <Text style={styles.configHint}>
                Manually track points per hole for each player during the round.
              </Text>
            </View>
          )}
        </>
      )}

      <View style={styles.navRow}>
        <TouchableOpacity style={styles.backButton} onPress={() => setStep('tees')}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.startButton, isCreating && { opacity: 0.6 }]}
          onPress={handleCreateRound}
          disabled={isCreating}
        >
          <Text style={styles.startButtonText}>
            {isCreating ? 'Creating...' : 'Start Round'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  content: { padding: 16, paddingBottom: 40 },
  stepTitle: { fontSize: 22, fontWeight: 'bold', color: '#1A1A2E', marginBottom: 16 },
  courseSelected: { fontSize: 15, color: '#2E7D32', fontWeight: '500', marginBottom: 12 },
  searchButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FFF', padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#2E7D32',
    marginBottom: 16,
  },
  searchButtonText: { color: '#2E7D32', fontSize: 16, fontWeight: '600' },
  orText: { fontSize: 14, color: '#999', marginBottom: 12 },
  courseCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  courseName: { fontSize: 16, fontWeight: '600', color: '#1A1A2E' },
  courseLocation: { fontSize: 13, color: '#666', marginTop: 2 },
  courseInfo: { fontSize: 12, color: '#999', marginTop: 2 },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 16, color: '#999' },
  emptySubtext: { fontSize: 14, color: '#BBB', marginTop: 4 },
  addPlayerButton: { marginTop: 12, padding: 12, backgroundColor: '#2E7D32', borderRadius: 8 },
  addPlayerText: { color: '#FFF', fontWeight: '600' },
  playerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFF', borderRadius: 10, padding: 14, marginBottom: 8,
  },
  playerRowSelected: { borderWidth: 1, borderColor: '#2E7D32' },
  playerRowInfo: { flex: 1 },
  playerRowName: { fontSize: 16, fontWeight: '600', color: '#1A1A2E' },
  playerRowHdcp: { fontSize: 13, color: '#666', marginTop: 2 },
  label: { fontSize: 14, fontWeight: '600', color: '#1A1A2E', marginBottom: 8 },
  roundTypeRow: { flexDirection: 'row', gap: 8 },
  roundTypeButton: {
    flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#E0E0E0',
    backgroundColor: '#FFF', alignItems: 'center',
  },
  roundTypeSelected: { borderColor: '#2E7D32', backgroundColor: '#E8F5E9' },
  roundTypeText: { fontSize: 14, color: '#666' },
  roundTypeTextSelected: { color: '#2E7D32', fontWeight: '600' },
  handicapModeHint: { fontSize: 12, color: '#999', marginTop: 6 },

  // Round summary header
  roundSummary: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 14, marginBottom: 14,
    borderLeftWidth: 4, borderLeftColor: '#2E7D32',
  },
  roundSummaryName: { fontSize: 16, fontWeight: '600', color: '#1A1A2E' },
  roundSummaryDetail: { fontSize: 13, color: '#666', marginTop: 3 },

  // Tee picker
  teeSection: { marginBottom: 10 },
  teePickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFF', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#E0E0E0',
  },
  teePickerLeft: { flex: 1 },
  teePlayerName: { fontSize: 15, fontWeight: '600', color: '#1A1A2E' },
  teePickerCurrent: { fontSize: 13, color: '#2E7D32', marginTop: 2 },
  teeDropdown: {
    backgroundColor: '#FFF', borderRadius: 0, borderBottomLeftRadius: 10, borderBottomRightRadius: 10,
    borderWidth: 1, borderTopWidth: 0, borderColor: '#E0E0E0', marginTop: -1,
  },
  teeOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 16,
    borderTopWidth: 1, borderTopColor: '#F0F0F0',
  },
  teeOptionSelected: { backgroundColor: '#E8F5E9' },
  teeOptionLeft: { flex: 1 },
  teeOptionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  teeOptionName: { fontSize: 14, fontWeight: '500', color: '#1A1A2E' },
  teeOptionNameSelected: { color: '#2E7D32', fontWeight: '600' },
  teeOptionCH: { fontSize: 13, fontWeight: '600', color: '#1A1A2E' },
  teeOptionCHSelected: { color: '#2E7D32' },
  teeOptionDetail: { fontSize: 12, color: '#666', marginTop: 1 },

  // Game selection (step 4)
  gameGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16,
  },
  gameCard: {
    width: '48%' as any,
    backgroundColor: '#FFF', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#E0E0E0',
  },
  gameCardSelected: { borderColor: '#2E7D32', backgroundColor: '#E8F5E9' },
  gameCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4,
  },
  gameCardName: { fontSize: 14, fontWeight: '600', color: '#1A1A2E', marginBottom: 2 },
  gameCardNameSelected: { color: '#2E7D32' },
  gameCardDesc: { fontSize: 11, color: '#999', lineHeight: 14 },

  // Game config sections
  configSection: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 14, marginBottom: 10,
    borderLeftWidth: 3, borderLeftColor: '#6A1B9A',
  },
  configTitle: { fontSize: 14, fontWeight: '700', color: '#6A1B9A', marginBottom: 4 },
  configRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 6,
  },
  configLabel: { fontSize: 14, color: '#1A1A2E' },
  configHint: { fontSize: 12, color: '#999', marginBottom: 6 },

  // Wolf config
  wolfHitsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  wolfOptionSelected: { borderColor: '#6A1B9A', backgroundColor: '#F3E5F5' },
  wolfOptionTextSelected: { color: '#6A1B9A', fontWeight: '600' },
  wolfOrderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  wolfOrderNum: { fontSize: 14, fontWeight: '700', color: '#6A1B9A', width: 20 },
  wolfOrderName: { fontSize: 14, color: '#1A1A2E' },

  // Stableford scale
  stablefordScale: { marginTop: 4 },
  stablefordRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2,
  },
  stablefordLabel: { fontSize: 13, color: '#1A1A2E' },
  stablefordPts: { fontSize: 13, fontWeight: '600', color: '#6A1B9A' },

  // Junk multiplier picker
  multiplierRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  multiplierButton: {
    flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#E0E0E0',
    backgroundColor: '#FFF', alignItems: 'center',
  },
  multiplierButtonActive: { borderColor: '#E65100', backgroundColor: '#FFF3E0' },
  multiplierButtonText: { fontSize: 14, color: '#666', fontWeight: '500' },
  multiplierButtonTextActive: { color: '#E65100', fontWeight: '700' },

  // Dots checkboxes
  dotRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6,
  },
  dotInfo: { flex: 1 },
  dotName: { fontSize: 13, fontWeight: '600', color: '#1A1A2E' },
  dotPts: { fontSize: 11, fontWeight: '400', color: '#6A1B9A' },
  dotPtsNegative: { color: '#D32F2F' },
  dotPtsAuto: { fontSize: 10, fontWeight: '500', color: '#2E7D32', fontStyle: 'italic' },
  dotDesc: { fontSize: 11, color: '#999' },

  // Team Match config styles
  teamOptionSelected: { borderColor: '#1565C0', backgroundColor: '#E3F2FD' },
  teamOptionTextSelected: { color: '#1565C0', fontWeight: '600' },
  teamFormatOption: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
    paddingHorizontal: 4, borderRadius: 8, marginBottom: 4,
  },
  teamFormatSelected: { backgroundColor: '#E3F2FD' },
  teamFormatLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  teamFormatLabel: { fontSize: 13, fontWeight: '600', color: '#1A1A2E' },
  teamFormatDesc: { fontSize: 11, color: '#999' },
  teamPreviewSection: { marginTop: 4 },
  teamPreviewRow: { marginBottom: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  teamPreviewPeriod: { fontSize: 12, fontWeight: '600', color: '#1565C0', marginBottom: 3 },
  teamPreviewTeams: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamPreviewTeamA: { fontSize: 13, color: '#1565C0', fontWeight: '500', flex: 1 },
  teamPreviewVs: { fontSize: 11, color: '#999', fontWeight: '600' },
  teamPreviewTeamB: { fontSize: 13, color: '#E65100', fontWeight: '500', flex: 1, textAlign: 'right' },
  teamAssignRow: { flexDirection: 'row', gap: 12, marginTop: 6 },
  teamAssignCol: { flex: 1 },
  teamAssignHeader: { fontSize: 12, fontWeight: '700', color: '#666', marginBottom: 6, textAlign: 'center' },
  teamAssignPlayerA: {
    backgroundColor: '#E3F2FD', borderRadius: 8, padding: 10, marginBottom: 4,
    alignItems: 'center', borderWidth: 1, borderColor: '#90CAF9',
  },
  teamAssignPlayerB: {
    backgroundColor: '#FFF3E0', borderRadius: 8, padding: 10, marginBottom: 4,
    alignItems: 'center', borderWidth: 1, borderColor: '#FFCC80',
  },
  teamAssignPlayerText: { fontSize: 13, fontWeight: '600', color: '#1A1A2E' },

  // Navigation
  navRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  backButton: {
    flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#E0E0E0',
    alignItems: 'center', backgroundColor: '#FFF',
  },
  backButtonText: { fontSize: 16, color: '#666' },
  nextButton: {
    flex: 2, padding: 14, borderRadius: 10, backgroundColor: '#2E7D32', alignItems: 'center',
  },
  nextButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  startButton: {
    flex: 2, padding: 14, borderRadius: 10, backgroundColor: '#2E7D32', alignItems: 'center',
  },
  startButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
