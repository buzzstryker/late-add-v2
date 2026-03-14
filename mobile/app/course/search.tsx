import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  FlatList, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useCourses } from '@/src/context/CourseContext';

export default function CourseSearchScreen() {
  const router = useRouter();
  const { searchCourses, getCourseDetail, getCourseByApiId, saveCourse } = useCourses();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState<string | null>(null);

  async function handleSearch() {
    if (!query.trim()) return;
    setIsSearching(true);
    try {
      const data = await searchCourses(query.trim());
      setResults(data);
      if (data.length === 0) {
        Alert.alert('No Results', 'No courses found. Try a different search term.');
      }
    } catch (err: any) {
      Alert.alert('Search Error', err.message || 'Failed to search courses. You can add a course manually.');
    } finally {
      setIsSearching(false);
    }
  }

  async function handleSelectCourse(apiCourse: any) {
    setIsSaving(apiCourse.id);
    try {
      const existing = await getCourseByApiId(String(apiCourse.id));
      if (existing) {
        Alert.alert('Already Saved', 'This course is already in your saved courses.');
        setIsSaving(null);
        return;
      }

      const courseDetail = await getCourseDetail(apiCourse.id);
      await saveCourse(courseDetail);
      Alert.alert('Saved', `${courseDetail.name} has been added to your courses.`);
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save course');
    } finally {
      setIsSaving(null);
    }
  }

  async function handleAddManually() {
    Alert.prompt?.(
      'Course Name',
      'Enter the course name:',
      async (name) => {
        if (!name?.trim()) return;
        try {
          const defaultHoles = Array.from({ length: 18 }, (_, i) => ({
            holeNumber: i + 1,
            par: 4,
            strokeIndex: i + 1,
          }));
          await saveCourse({
            name: name.trim(),
            numberOfHoles: 18,
            teeBoxes: [
              { name: 'White', gender: 'M', courseRating: 72, slopeRating: 113, par: 72 },
              { name: 'White', gender: 'F', courseRating: 72, slopeRating: 113, par: 72 },
            ],
            holes: defaultHoles,
          });
          Alert.alert('Saved', `${name.trim()} has been added. You can edit hole details later.`);
          router.back();
        } catch (err) {
          Alert.alert('Error', 'Failed to create course');
        }
      }
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search by course name or city..."
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            autoFocus
          />
          <TouchableOpacity style={styles.searchBtn} onPress={handleSearch}>
            <FontAwesome name="search" size={18} color="#FFF" />
          </TouchableOpacity>
        </View>

        {isSearching && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#2E7D32" />
            <Text style={styles.loadingText}>Searching...</Text>
          </View>
        )}

        <FlatList
          data={results}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.resultCard}
              onPress={() => handleSelectCourse(item)}
              disabled={isSaving === item.id}
            >
              <View style={styles.resultInfo}>
                <Text style={styles.resultName}>{item.course_name || item.club_name}</Text>
                <Text style={styles.resultLocation}>
                  {[item.location?.city, item.location?.state, item.location?.country].filter(Boolean).join(', ')}
                </Text>
              </View>
              {isSaving === item.id ? (
                <ActivityIndicator color="#2E7D32" />
              ) : (
                <FontAwesome name="plus-circle" size={24} color="#2E7D32" />
              )}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            !isSearching ? (
              <View style={styles.emptyState}>
                <FontAwesome name="search" size={48} color="#DDD" />
                <Text style={styles.emptyText}>Search for a golf course</Text>
                <Text style={styles.emptySubtext}>
                  Or add one manually below
                </Text>
              </View>
            ) : null
          }
        />

        <TouchableOpacity style={styles.manualButton} onPress={handleAddManually}>
          <FontAwesome name="pencil" size={16} color="#2E7D32" />
          <Text style={styles.manualButtonText}>Add Course Manually</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5', padding: 16 },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  searchInput: {
    flex: 1, backgroundColor: '#FFF', borderRadius: 8, padding: 12, fontSize: 16,
    borderWidth: 1, borderColor: '#E0E0E0',
  },
  searchBtn: {
    width: 48, backgroundColor: '#2E7D32', borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  loadingText: { color: '#666' },
  resultCard: {
    backgroundColor: '#FFF', borderRadius: 10, padding: 14, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  resultInfo: { flex: 1 },
  resultName: { fontSize: 16, fontWeight: '600', color: '#1A1A2E' },
  resultLocation: { fontSize: 13, color: '#666', marginTop: 2 },
  resultHoles: { fontSize: 12, color: '#999', marginTop: 1 },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 16, color: '#999', marginTop: 12 },
  emptySubtext: { fontSize: 14, color: '#BBB', marginTop: 4 },
  manualButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FFF', padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#2E7D32',
  },
  manualButtonText: { color: '#2E7D32', fontSize: 16, fontWeight: '600' },
});
