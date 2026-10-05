import { audioResponse } from "@/lib/audio";
import { getStudentSession, getTeacherSession } from "@/lib/auth";
import { attemptAudio } from "@/lib/submissions";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await context.params;
  const audio = await attemptAudio(Number(attemptId));
  if (!audio) return new Response("找不到音频", { status: 404 });
  const teacher = await getTeacherSession();
  const student = await getStudentSession();
  if (!teacher && student?.studentId !== audio.studentId) return new Response("找不到音频", { status: 404 });
  return audioResponse(audio.path);
}
