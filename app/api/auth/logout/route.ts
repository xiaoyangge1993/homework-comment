import { cookies } from "next/headers";
import { STUDENT_COOKIE, TEACHER_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  jar.delete(TEACHER_COOKIE);
  jar.delete(STUDENT_COOKIE);
  return Response.json({ ok: true });
}
