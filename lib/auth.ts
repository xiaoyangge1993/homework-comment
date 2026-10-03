import "server-only";

import { cookies } from "next/headers";
import { getDb } from "./db";
import { verifyPassword } from "./password";
import { readSession, signSession } from "./session";
import { AppError } from "./errors";

const TEACHER_COOKIE = "teacher_session";
const STUDENT_COOKIE = "student_session";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: MAX_AGE_MS / 1000,
};

type TeacherPayload = { teacherId: number; exp: number };
type StudentPayload = { studentId: number; classId: number; exp: number };

export function setupMessage(): string | null {
  if (!process.env.TEACHER_PASSWORD) return "请在 .env.local 设置 TEACHER_PASSWORD";
  if (!process.env.SESSION_SECRET) return "请在 .env.local 设置 SESSION_SECRET";
  return null;
}

export async function loginTeacher(password: string): Promise<string> {
  const problem = setupMessage();
  if (problem) throw new AppError(problem);
  const db = getDb();
  const teacher = db.prepare("SELECT id, password_hash FROM teacher LIMIT 1").get() as
    | { id: number; password_hash: string }
    | undefined;
  if (!teacher || !verifyPassword(password, teacher.password_hash)) {
    throw new AppError("密码不对");
  }
  return signSession({ teacherId: teacher.id, exp: Date.now() + MAX_AGE_MS } satisfies TeacherPayload);
}

export async function getTeacherSession(): Promise<{ teacherId: number } | null> {
  if (!process.env.SESSION_SECRET) return null;
  const jar = await cookies();
  const payload = readSession<TeacherPayload>(jar.get(TEACHER_COOKIE)?.value);
  if (!payload || payload.exp < Date.now() || !payload.teacherId) return null;
  return { teacherId: payload.teacherId };
}

export async function requireTeacher(): Promise<{ teacherId: number }> {
  const session = await getTeacherSession();
  if (!session) throw new AppError("请先登录", 401);
  return session;
}

export function signStudent(studentId: number, classId: number): string {
  return signSession({ studentId, classId, exp: Date.now() + MAX_AGE_MS } satisfies StudentPayload);
}

export async function getStudentSession(): Promise<{ studentId: number; classId: number } | null> {
  if (!process.env.SESSION_SECRET) return null;
  const jar = await cookies();
  const payload = readSession<StudentPayload>(jar.get(STUDENT_COOKIE)?.value);
  if (!payload || payload.exp < Date.now() || !payload.studentId) return null;
  return { studentId: payload.studentId, classId: payload.classId };
}

export { TEACHER_COOKIE, STUDENT_COOKIE };
