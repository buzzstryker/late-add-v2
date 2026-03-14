import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useGroups } from '@/src/context/GroupContext';
import { ImportStats } from '@/src/services/glideImportService';
import {
  GLIDE_SECTIONS,
  GLIDE_GROUPS,
  GLIDE_PROFILES,
  GLIDE_SEASONS,
  GLIDE_ROUNDS,
  GLIDE_SCORES,
} from '@/src/data/glideImportData';

export default function GlideImportScreen() {
  const router = useRouter();
  const { importGlideData, clearAndReimportGlideData } = useGroups();
  const [isImporting, setIsImporting] = useState(false);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState('');

  const glideData = {
    sections: GLIDE_SECTIONS,
    groups: GLIDE_GROUPS,
    profiles: GLIDE_PROFILES,
    seasons: GLIDE_SEASONS,
    rounds: GLIDE_ROUNDS,
    scores: GLIDE_SCORES,
  };

  async function handleImport() {
    setIsImporting(true);
    setError(null);
    setCurrentStep('Starting import...');

    try {
      const result = await importGlideData(glideData);
      setStats(result);
      setCurrentStep('');
    } catch (err: any) {
      setError(err?.message || 'Import failed');
      setCurrentStep('');
    } finally {
      setIsImporting(false);
    }
  }

  function handleReimport() {
    Alert.alert(
      'Re-import Glide Data',
      'This will DELETE all existing league data (groups, seasons, rounds, scores) and import fresh from the Glide export.\n\nPlayers will NOT be deleted — they will be re-matched by email.\n\nContinue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear & Re-import',
          style: 'destructive',
          onPress: async () => {
            setIsImporting(true);
            setError(null);
            setStats(null);
            setCurrentStep('Clearing existing data...');
            try {
              const result = await clearAndReimportGlideData(glideData);
              setStats(result);
              setCurrentStep('');
            } catch (err: any) {
              setError(err?.message || 'Re-import failed');
              setCurrentStep('');
            } finally {
              setIsImporting(false);
            }
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <FontAwesome name="download" size={48} color="#2E7D32" />
        <Text style={styles.title}>Import Late Add Golf</Text>
        <Text style={styles.subtitle}>
          Import your groups, seasons, rounds, and scores from the Glide app
        </Text>
      </View>

      <View style={styles.previewCard}>
        <Text style={styles.previewTitle}>Data to Import</Text>
        <StatRow label="Sections" value={GLIDE_SECTIONS.length} />
        <StatRow label="Groups" value={GLIDE_GROUPS.length} />
        <StatRow label="Player Profiles" value={GLIDE_PROFILES.length} />
        <StatRow label="Seasons" value={GLIDE_SEASONS.length} />
        <StatRow label="Rounds" value={GLIDE_ROUNDS.length} />
        <StatRow label="Scores" value={GLIDE_SCORES.length} />
      </View>

      {!stats && !error && (
        <>
          {isImporting ? (
            <View style={[styles.importButton, styles.importButtonDisabled]}>
              <ActivityIndicator color="#FFF" />
              <Text style={styles.importButtonText}>{currentStep || 'Importing...'}</Text>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={styles.reimportButton}
                onPress={handleReimport}
              >
                <FontAwesome name="refresh" size={18} color="#FFF" />
                <Text style={styles.importButtonText}>Clear & Re-import</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.importButton, { marginTop: 10 }]}
                onPress={handleImport}
              >
                <FontAwesome name="plus" size={18} color="#FFF" />
                <Text style={styles.importButtonText}>Import (Additive)</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}

      {error && (
        <View style={styles.errorCard}>
          <FontAwesome name="exclamation-triangle" size={24} color="#D32F2F" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleImport}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {stats && (
        <View style={styles.resultsCard}>
          <View style={styles.successHeader}>
            <FontAwesome name="check-circle" size={24} color="#2E7D32" />
            <Text style={styles.successText}>Import Complete!</Text>
          </View>

          <Text style={styles.resultsTitle}>Results</Text>
          <StatRow label="Sections created" value={stats.sectionsCreated} />
          <StatRow label="Groups created" value={stats.groupsCreated} />
          <StatRow label="Players matched" value={stats.playersMatched} />
          <StatRow label="Players created" value={stats.playersCreated} />
          <StatRow label="Memberships created" value={stats.membershipsCreated} />
          <StatRow label="Seasons created" value={stats.seasonsCreated} />
          <StatRow label="League rounds created" value={stats.leagueRoundsCreated} />
          <StatRow label="League scores created" value={stats.leagueScoresCreated} />

          {stats.warnings.length > 0 && (
            <>
              <Text style={styles.warningsTitle}>Warnings ({stats.warnings.length})</Text>
              {stats.warnings.slice(0, 10).map((w, i) => (
                <Text key={i} style={styles.warningText}>⚠ {w}</Text>
              ))}
              {stats.warnings.length > 10 && (
                <Text style={styles.warningText}>...and {stats.warnings.length - 10} more</Text>
              )}
            </>
          )}

          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => router.back()}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  content: { padding: 16 },
  header: { alignItems: 'center', paddingVertical: 24 },
  title: { fontSize: 22, fontWeight: '700', color: '#1A1A2E', marginTop: 12 },
  subtitle: { fontSize: 14, color: '#666', marginTop: 4, textAlign: 'center', paddingHorizontal: 20 },
  previewCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  previewTitle: { fontSize: 16, fontWeight: '600', color: '#1A1A2E', marginBottom: 12 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  statLabel: { fontSize: 14, color: '#666' },
  statValue: { fontSize: 14, fontWeight: '600', color: '#1A1A2E' },
  importButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#2E7D32', paddingVertical: 14, borderRadius: 10,
  },
  reimportButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#1565C0', paddingVertical: 14, borderRadius: 10,
  },
  importButtonDisabled: { opacity: 0.7 },
  importButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  errorCard: {
    backgroundColor: '#FFEBEE', borderRadius: 10, padding: 16, alignItems: 'center', gap: 8,
  },
  errorText: { fontSize: 14, color: '#D32F2F', textAlign: 'center' },
  retryButton: { paddingVertical: 8, paddingHorizontal: 16 },
  retryText: { color: '#D32F2F', fontWeight: '600' },
  resultsCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  successHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  successText: { fontSize: 18, fontWeight: '700', color: '#2E7D32' },
  resultsTitle: { fontSize: 16, fontWeight: '600', color: '#1A1A2E', marginBottom: 8 },
  warningsTitle: { fontSize: 14, fontWeight: '600', color: '#F57C00', marginTop: 16, marginBottom: 4 },
  warningText: { fontSize: 12, color: '#F57C00', marginBottom: 2 },
  doneButton: {
    backgroundColor: '#2E7D32', paddingVertical: 12, borderRadius: 10,
    alignItems: 'center', marginTop: 16,
  },
  doneButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
