export interface TeeBox {
  id: string;
  courseId: string;
  name: string; // e.g., "Blue", "White", "Red"
  gender: 'M' | 'F'; // Male or Female tee ratings
  color?: string;
  courseRating: number; // e.g., 70.9
  slopeRating: number; // e.g., 131
  par: number; // Total par for 18 holes (or 9)
  yardage?: number;
}

export interface HoleInfo {
  courseId: string;
  holeNumber: number; // 1-18
  par: number; // 3, 4, or 5
  strokeIndex: number; // 1-18, used for handicap stroke allocation
  yardage?: Record<string, number>; // teeBox name -> yardage
}

export interface Course {
  id: string;
  name: string;
  city?: string;
  state?: string;
  country?: string;
  address?: string;
  phone?: string;
  website?: string;
  numberOfHoles: number; // 9 or 18
  teeBoxes: TeeBox[];
  holes: HoleInfo[];
  apiId?: string; // External API identifier
  createdAt: string;
  updatedAt: string;
}

export interface CourseCreateInput {
  name: string;
  city?: string;
  state?: string;
  country?: string;
  numberOfHoles: number;
  teeBoxes: Omit<TeeBox, 'id' | 'courseId'>[];
  holes: Omit<HoleInfo, 'courseId'>[];
  apiId?: string;
}
