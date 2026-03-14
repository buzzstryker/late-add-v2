import React, { createContext, useContext, useReducer, useCallback, useEffect, ReactNode } from 'react';
import { Course, CourseCreateInput } from '../models/Course';
import * as courseRepo from '../db/courseRepository';
import { courseApiService } from '../services/courseApiService';
import { useSync } from './SyncContext';

interface CourseState {
  courses: Course[];
  isLoading: boolean;
  error: string | null;
}

type CourseAction =
  | { type: 'SET_COURSES'; payload: Course[] }
  | { type: 'ADD_COURSE'; payload: Course }
  | { type: 'REMOVE_COURSE'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null };

const initialState: CourseState = {
  courses: [],
  isLoading: false,
  error: null,
};

function courseReducer(state: CourseState, action: CourseAction): CourseState {
  switch (action.type) {
    case 'SET_COURSES':
      return { ...state, courses: action.payload, isLoading: false };
    case 'ADD_COURSE':
      return { ...state, courses: [...state.courses, action.payload] };
    case 'REMOVE_COURSE':
      return { ...state, courses: state.courses.filter((c) => c.id !== action.payload) };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };
    default:
      return state;
  }
}

interface CourseContextType {
  state: CourseState;
  loadCourses: () => Promise<void>;
  saveCourse: (input: CourseCreateInput) => Promise<Course>;
  deleteCourse: (id: string) => Promise<void>;
  searchCourses: (query: string) => Promise<any[]>;
  getCourseDetail: (courseId: string | number) => Promise<CourseCreateInput>;
  getCourseByApiId: (apiId: string) => Promise<Course | null>;
}

const CourseContext = createContext<CourseContextType | undefined>(undefined);

export function CourseProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(courseReducer, initialState);
  const { state: syncState } = useSync();

  // Reload courses when sync pulls new data
  useEffect(() => {
    if (syncState.lastPullCompletedAt > 0) {
      loadCourses();
    }
  }, [syncState.lastPullCompletedAt]);

  const loadCourses = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const courses = await courseRepo.getAllCourses();
      dispatch({ type: 'SET_COURSES', payload: courses });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load courses' });
    }
  }, []);

  const saveCourse = useCallback(async (input: CourseCreateInput) => {
    const course = await courseRepo.createCourse(input);
    dispatch({ type: 'ADD_COURSE', payload: course });
    return course;
  }, []);

  const deleteCourse = useCallback(async (id: string) => {
    await courseRepo.deleteCourse(id);
    dispatch({ type: 'REMOVE_COURSE', payload: id });
  }, []);

  const searchCourses = useCallback(async (query: string) => {
    return courseApiService.searchCourses(query);
  }, []);

  const getCourseDetail = useCallback(async (courseId: string | number) => {
    return courseApiService.getCourseDetail(courseId);
  }, []);

  const getCourseByApiId = useCallback(async (apiId: string) => {
    return courseRepo.getCourseByApiId(apiId);
  }, []);

  return (
    <CourseContext.Provider
      value={{ state, loadCourses, saveCourse, deleteCourse, searchCourses, getCourseDetail, getCourseByApiId }}
    >
      {children}
    </CourseContext.Provider>
  );
}

export function useCourses() {
  const context = useContext(CourseContext);
  if (!context) throw new Error('useCourses must be used within CourseProvider');
  return context;
}
