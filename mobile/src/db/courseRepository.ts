import { getDatabase, generateId } from './database';
import { logChange } from './syncChangeLogger';
import { Course, CourseCreateInput, TeeBox, HoleInfo } from '../models/Course';

export async function getAllCourses(): Promise<Course[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>('SELECT * FROM courses ORDER BY name');
  const courses: Course[] = [];
  for (const row of rows) {
    courses.push(await buildCourse(row));
  }
  return courses;
}

export async function getCourseById(id: string): Promise<Course | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>('SELECT * FROM courses WHERE id = ?', id);
  if (!row) return null;
  return buildCourse(row);
}

export async function getCourseByApiId(apiId: string): Promise<Course | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>('SELECT * FROM courses WHERE api_id = ?', apiId);
  if (!row) return null;
  return buildCourse(row);
}

export async function createCourse(input: CourseCreateInput): Promise<Course> {
  const db = await getDatabase();
  const courseId = generateId();
  const now = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO courses (id, name, city, state, country, number_of_holes, api_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    courseId,
    input.name,
    input.city ?? null,
    input.state ?? null,
    input.country ?? null,
    input.numberOfHoles,
    input.apiId ?? null,
    now,
    now
  );

  logChange('courses', courseId, 'insert').catch(() => {});

  // Insert tee boxes
  for (const tee of input.teeBoxes) {
    const teeId = generateId();
    await db.runAsync(
      `INSERT INTO tee_boxes (id, course_id, name, gender, color, course_rating, slope_rating, par, yardage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      teeId,
      courseId,
      tee.name,
      tee.gender ?? 'M',
      tee.color ?? null,
      tee.courseRating,
      tee.slopeRating,
      tee.par,
      tee.yardage ?? null
    );
    logChange('tee_boxes', teeId, 'insert').catch(() => {});
  }

  // Insert holes
  for (const hole of input.holes) {
    await db.runAsync(
      `INSERT INTO holes (course_id, hole_number, par, stroke_index)
       VALUES (?, ?, ?, ?)`,
      courseId,
      hole.holeNumber,
      hole.par,
      hole.strokeIndex
    );
    logChange('holes', `${courseId}:${hole.holeNumber}`, 'insert').catch(() => {});

    // Insert yardages per tee box
    if (hole.yardage) {
      for (const [teeName, yards] of Object.entries(hole.yardage)) {
        await db.runAsync(
          `INSERT INTO hole_yardages (course_id, hole_number, tee_box_name, yardage)
           VALUES (?, ?, ?, ?)`,
          courseId,
          hole.holeNumber,
          teeName,
          yards
        );
        logChange('hole_yardages', `${courseId}:${hole.holeNumber}:${teeName}`, 'insert').catch(() => {});
      }
    }
  }

  return (await getCourseById(courseId))!;
}

export async function deleteCourse(id: string): Promise<boolean> {
  const db = await getDatabase();
  // Delete rounds referencing this course (and their cascading scores/betting games)
  const rounds = await db.getAllAsync<{ id: string }>('SELECT id FROM rounds WHERE course_id = ?', id);
  for (const round of rounds) {
    await db.runAsync('DELETE FROM rounds WHERE id = ?', round.id);
    logChange('rounds', round.id, 'delete').catch(() => {});
  }
  const result = await db.runAsync('DELETE FROM courses WHERE id = ?', id);
  if (result.changes > 0) logChange('courses', id, 'delete').catch(() => {});
  return result.changes > 0;
}

async function buildCourse(row: any): Promise<Course> {
  const db = await getDatabase();

  const teeRows = await db.getAllAsync<any>(
    'SELECT * FROM tee_boxes WHERE course_id = ? ORDER BY slope_rating DESC',
    row.id
  );
  const teeBoxes: TeeBox[] = teeRows.map((t: any) => ({
    id: t.id,
    courseId: t.course_id,
    name: t.name,
    gender: t.gender || 'M',
    color: t.color,
    courseRating: t.course_rating,
    slopeRating: t.slope_rating,
    par: t.par,
    yardage: t.yardage,
  }));

  const holeRows = await db.getAllAsync<any>(
    'SELECT * FROM holes WHERE course_id = ? ORDER BY hole_number',
    row.id
  );

  const holes: HoleInfo[] = [];
  for (const h of holeRows) {
    const yardageRows = await db.getAllAsync<any>(
      'SELECT tee_box_name, yardage FROM hole_yardages WHERE course_id = ? AND hole_number = ?',
      row.id,
      h.hole_number
    );
    const yardage: Record<string, number> = {};
    for (const yr of yardageRows) {
      yardage[yr.tee_box_name] = yr.yardage;
    }

    holes.push({
      courseId: h.course_id,
      holeNumber: h.hole_number,
      par: h.par,
      strokeIndex: h.stroke_index,
      yardage: Object.keys(yardage).length > 0 ? yardage : undefined,
    });
  }

  return {
    id: row.id,
    name: row.name,
    city: row.city,
    state: row.state,
    country: row.country,
    address: row.address,
    phone: row.phone,
    website: row.website,
    numberOfHoles: row.number_of_holes,
    teeBoxes,
    holes,
    apiId: row.api_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
