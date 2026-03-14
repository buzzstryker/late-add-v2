/**
 * GHIN (Golf Handicap Information Network) API Service
 *
 * Framework-agnostic service for fetching handicap data from GHIN.
 * Uses the unofficial api2.ghin.com REST API (same endpoints the GHIN app uses).
 * Requires a valid GHIN account (number + password) for authentication.
 *
 * Login flow:
 * 1. Obtain a Firebase Installation session token
 * 2. POST to golfer_login.json with session token + credentials
 * 3. Use returned JWT bearer token for subsequent API calls
 */

// ─── Types ───────────────────────────────────────────────────────────────

export interface GhinCredentials {
  username: string; // GHIN number or email
  password: string;
}

export interface GhinHandicapResult {
  handicapIndex: number;
  firstName: string;
  lastName: string;
  club?: string;
  lastRevised?: string; // ISO date of last handicap revision
  ghinNumber: string;
  status: string; // "Active", "Inactive", etc.
}

export interface GhinCourseResult {
  facilityId: number;
  courseId: number;
  facilityName: string;
  city?: string;
  state?: string;
}

export interface GhinPostScoreInput {
  ghinNumber: string;
  facilityId: number;
  /** 9 or 18 */
  holesPlayed: number;
  /** Adjusted gross score (total) */
  adjustedGrossScore: number;
  /** e.g. "Home" */
  scoreType?: string;
  /** ISO date string, e.g. "2026-02-23" */
  playedAt: string;
}

export interface GhinPostScoreResult {
  success: boolean;
  scoreId?: string;
  message?: string;
}

interface CachedToken {
  token: string;
  expiresAt: number; // unix timestamp in ms
}

// ─── Constants ───────────────────────────────────────────────────────────

const GHIN_API_BASE = 'https://api2.ghin.com/api/v1';
const TOKEN_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

// Firebase Installation API (required to obtain session token for GHIN login)
const FIREBASE_INSTALLATIONS_URL =
  'https://firebaseinstallations.googleapis.com/v1/projects/ghin-mobile-app/installations';
const FIREBASE_API_KEY = 'AIzaSyBxgTOAWxiud0HuaE5tN-5NTlzFnrtyz-I';
const FIREBASE_APP_ID = '1:884417644529:web:47fb315bc6c70242f72650';

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Generate a random Firebase Installation ID (22 char base64url). */
function generateFid(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let fid = '';
  for (let i = 0; i < 22; i++) {
    fid += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return fid;
}

// ─── Service ─────────────────────────────────────────────────────────────

class GhinService {
  private cachedToken: CachedToken | null = null;
  private cachedFirebaseToken: string | null = null;

  /**
   * Obtain a Firebase Installation session token.
   * Required by the GHIN golfer_login endpoint.
   */
  private async getFirebaseToken(): Promise<string> {
    if (this.cachedFirebaseToken) return this.cachedFirebaseToken;

    try {
      const response = await fetch(FIREBASE_INSTALLATIONS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': FIREBASE_API_KEY,
        },
        body: JSON.stringify({
          appId: FIREBASE_APP_ID,
          authVersion: 'FIS_v2',
          fid: generateFid(),
          sdkVersion: 'w:0.5.7',
        }),
      });

      if (!response.ok) {
        throw new GhinNetworkError(`Firebase token request failed (HTTP ${response.status})`);
      }

      const data = await response.json();
      const token = data?.authToken?.token;
      if (!token) {
        throw new GhinNetworkError('No Firebase session token returned');
      }

      this.cachedFirebaseToken = token;
      return token;
    } catch (err) {
      if (err instanceof GhinNetworkError) throw err;
      throw new GhinNetworkError('Failed to obtain Firebase session token');
    }
  }

  /**
   * Authenticate with GHIN and return a bearer token.
   * Throws on invalid credentials or network error.
   */
  async login(credentials: GhinCredentials): Promise<string> {
    // Return cached token if still valid
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - TOKEN_BUFFER_MS) {
      return this.cachedToken.token;
    }

    // Step 1: get Firebase session token
    const firebaseToken = await this.getFirebaseToken();

    // Step 2: login to GHIN
    const response = await fetch(`${GHIN_API_BASE}/golfer_login.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        user: {
          email_or_ghin: credentials.username,
          password: credentials.password,
        },
        token: firebaseToken,
      }),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 422) {
        throw new GhinAuthError('Invalid GHIN credentials. Check your GHIN number and password.');
      }
      throw new GhinNetworkError(`GHIN login failed (HTTP ${response.status})`);
    }

    const data = await response.json();
    // Token is nested: { golfer_user: { golfer_user_token: "..." } }
    const token = data?.golfer_user?.golfer_user_token;

    if (!token) {
      throw new GhinAuthError('No token returned from GHIN. Check your credentials.');
    }

    // Cache token for 24 hours (GHIN tokens are long-lived)
    this.cachedToken = {
      token,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };

    return token;
  }

  /**
   * Validate credentials by attempting login.
   * Returns true if successful, false otherwise.
   */
  async validateCredentials(credentials: GhinCredentials): Promise<boolean> {
    try {
      await this.login(credentials);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetch a golfer's handicap index by GHIN number.
   * Requires a valid authentication token.
   */
  async fetchHandicapIndex(
    ghinNumber: string,
    credentials: GhinCredentials,
  ): Promise<GhinHandicapResult> {
    const token = await this.login(credentials);

    const params = new URLSearchParams({
      per_page: '1',
      page: '1',
      golfer_id: ghinNumber,
      status: 'Active',
      source: 'GHINcom',
    });

    const response = await fetch(`${GHIN_API_BASE}/golfers/search.json?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'source': 'GHINcom',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token expired, clear cache and retry once
        this.cachedToken = null;
        return this.fetchHandicapIndex(ghinNumber, credentials);
      }
      throw new GhinNetworkError(`GHIN lookup failed (HTTP ${response.status})`);
    }

    const data = await response.json();
    const golfers = data.golfers || [];

    if (golfers.length === 0) {
      throw new GhinLookupError(`No golfer found with GHIN number ${ghinNumber}`);
    }

    const golfer = golfers[0];
    const hi = parseFloat(golfer.handicap_index);

    return {
      handicapIndex: isNaN(hi) ? 0 : hi,
      firstName: golfer.first_name || '',
      lastName: golfer.last_name || '',
      club: golfer.club_name || undefined,
      lastRevised: golfer.rev_date || undefined,
      ghinNumber: golfer.ghin || ghinNumber,
      status: golfer.status || 'Unknown',
    };
  }

  /**
   * Search for golf courses/facilities in GHIN by name.
   * Tries multiple endpoint patterns since the unofficial API varies.
   */
  async searchCourses(
    query: string,
    credentials: GhinCredentials,
  ): Promise<GhinCourseResult[]> {
    const token = await this.login(credentials);

    // Try multiple endpoint patterns — the GHIN API isn't publicly documented
    const endpoints = [
      `${GHIN_API_BASE}/courses/search.json?name=${encodeURIComponent(query)}&per_page=10&page=1`,
      `${GHIN_API_BASE}/facilities.json?facility_name=${encodeURIComponent(query)}&per_page=10&page=1&status=Active`,
      `${GHIN_API_BASE}/courses.json?course_name=${encodeURIComponent(query)}&per_page=10&page=1`,
    ];

    for (const url of endpoints) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'source': 'GHINcom',
          },
        });

        if (response.status === 401) {
          this.cachedToken = null;
          return this.searchCourses(query, credentials);
        }

        if (!response.ok) continue; // try next endpoint

        // Guard against empty/non-JSON bodies
        const text = await response.text();
        if (!text || !text.trim().startsWith('{') && !text.trim().startsWith('[')) continue;

        const data = JSON.parse(text);

        // Find the array of results — check common wrapper keys and top-level array
        let items: any[] = [];
        if (Array.isArray(data)) {
          items = data;
        } else {
          for (const key of Object.keys(data)) {
            if (Array.isArray(data[key]) && data[key].length > 0) {
              items = data[key];
              break;
            }
          }
        }

        if (items.length === 0) continue;

        return items.map((f: any) => {
          // Actual GHIN API uses PascalCase: FacilityName, FacilityID, CourseID, CourseName, City, State
          const name = f.FacilityName ?? f.facility_name ?? f.CourseName ?? f.course_name
            ?? f.FullName ?? f.club_name ?? f.name ?? 'Unknown';
          const facilityId = f.FacilityID ?? f.facility_id ?? f.id ?? 0;
          const courseId = f.CourseID ?? f.course_id ?? facilityId;
          const city = f.City ?? f.city;
          // GHIN returns state as "US-CA" format — strip the "US-" prefix
          const rawState = f.State ?? f.state ?? '';
          const state = typeof rawState === 'string' ? rawState.replace(/^US-/, '') : rawState;
          return { facilityId, courseId, facilityName: name, city, state };
        });
      } catch {
        continue; // try next endpoint on any error
      }
    }

    // All endpoints failed — return empty (let the UI show "no results")
    return [];
  }

  /**
   * Post a score to GHIN on behalf of the authenticated golfer.
   * Uses the golfer's own credentials (they are posting their own score).
   */
  async postScore(
    input: GhinPostScoreInput,
    credentials: GhinCredentials,
  ): Promise<GhinPostScoreResult> {
    const token = await this.login(credentials);

    const response = await fetch(`${GHIN_API_BASE}/scores.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'source': 'GHINcom',
      },
      body: JSON.stringify({
        score: {
          ghin_number: input.ghinNumber,
          facility_id: input.facilityId,
          holes_played: input.holesPlayed,
          adjusted_gross_score: input.adjustedGrossScore,
          score_type: input.scoreType || 'Home',
          played_at: input.playedAt,
        },
      }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        this.cachedToken = null;
        return this.postScore(input, credentials);
      }
      // Try to extract error message from response body
      let errorMsg = `GHIN score post failed (HTTP ${response.status})`;
      try {
        const errData = await response.json();
        if (errData?.errors?.[0]) errorMsg = errData.errors[0];
        else if (errData?.error) errorMsg = errData.error;
        else if (errData?.message) errorMsg = errData.message;
      } catch { /* ignore parse errors */ }
      throw new GhinNetworkError(errorMsg);
    }

    const data = await response.json();
    return {
      success: true,
      scoreId: data?.score?.id?.toString() || data?.score_id?.toString(),
      message: 'Score posted to GHIN successfully',
    };
  }

  /** Clear the cached token (e.g., on logout). */
  clearToken(): void {
    this.cachedToken = null;
    this.cachedFirebaseToken = null;
  }
}

// ─── Error Classes ───────────────────────────────────────────────────────

export class GhinAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GhinAuthError';
  }
}

export class GhinNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GhinNetworkError';
  }
}

export class GhinLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GhinLookupError';
  }
}

// ─── Singleton Export ────────────────────────────────────────────────────

export const ghinService = new GhinService();
