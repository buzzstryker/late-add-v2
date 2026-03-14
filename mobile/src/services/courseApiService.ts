import { CourseCreateInput } from '../models/Course';

const API_BASE = 'https://api.golfcourseapi.com';

/**
 * Service for fetching golf course data from GolfCourseAPI.com.
 * Falls back to manual entry if no API key is configured.
 */
class CourseApiService {
  private apiKey: string | null = null;

  setApiKey(key: string) {
    this.apiKey = key;
  }

  async searchCourses(query: string): Promise<any[]> {
    if (!this.apiKey) {
      return this.searchFree(query);
    }

    try {
      const response = await fetch(`${API_BASE}/v1/courses?course_name=${encodeURIComponent(query)}`, {
        headers: {
          'Authorization': `Key ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      return data.courses || data || [];
    } catch (err) {
      console.error('Course API search error:', err);
      throw new Error('Course search failed. You can add a course manually instead.');
    }
  }

  async getCourseDetail(courseId: string | number): Promise<CourseCreateInput> {
    if (!this.apiKey) {
      throw new Error('API key not configured. Please add a course manually.');
    }

    try {
      const response = await fetch(`${API_BASE}/v1/courses/${courseId}`, {
        headers: {
          'Authorization': `Key ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      return this.mapApiCourseToInput(data);
    } catch (err) {
      console.error('Course API detail error:', err);
      throw new Error('Failed to fetch course details. Please add the course manually.');
    }
  }

  private async searchFree(query: string): Promise<any[]> {
    console.log('No API key configured. Course search unavailable. Please add courses manually.');
    throw new Error(
      'Course search requires an API key.\n\n' +
      'To enable course search, add your API key to the .env file.\n\n' +
      'You can also add courses manually using the button below.'
    );
  }

  private mapApiCourseToInput(data: any): CourseCreateInput {
    const courseData = data.course || data;
    const tees = courseData.tees || {};
    const teeBoxes: any[] = [];
    let firstTeeHoles: any[] = [];

    // Tees are organized by gender (male/female), each containing an array of tee options
    for (const gender of ['male', 'female']) {
      const genderTees = tees[gender] || [];
      const genderCode = gender === 'female' ? 'F' : 'M';
      for (const tee of genderTees) {
        teeBoxes.push({
          name: tee.tee_name || 'Default',
          gender: genderCode as 'M' | 'F',
          courseRating: parseFloat(tee.course_rating) || 72,
          slopeRating: parseInt(tee.slope_rating) || 113,
          par: parseInt(tee.par_total) || 72,
          yardage: parseInt(tee.total_yards) || undefined,
        });

        // Use holes from the first tee that has them
        if (firstTeeHoles.length === 0 && tee.holes && tee.holes.length > 0) {
          firstTeeHoles = tee.holes;
        }
      }
    }

    if (teeBoxes.length === 0) {
      teeBoxes.push({
        name: 'Default',
        gender: 'M' as 'M' | 'F',
        courseRating: 72,
        slopeRating: 113,
        par: 72,
      });
    }

    const holes = firstTeeHoles.map((hole: any, index: number) => ({
      holeNumber: index + 1,
      par: parseInt(hole.par) || 4,
      strokeIndex: parseInt(hole.handicap) || (index + 1),
    }));

    if (holes.length === 0) {
      for (let i = 1; i <= 18; i++) {
        holes.push({
          holeNumber: i,
          par: 4,
          strokeIndex: i,
        });
      }
    }

    return {
      name: courseData.course_name || courseData.club_name || 'Unknown Course',
      city: courseData.location?.city,
      state: courseData.location?.state,
      country: courseData.location?.country,
      numberOfHoles: holes.length || 18,
      teeBoxes,
      holes,
      apiId: String(courseData.id),
    };
  }
}

export const courseApiService = new CourseApiService();
