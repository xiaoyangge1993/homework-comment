import { referenceAudioPath } from "@/lib/assignments";
import { audioResponse } from "@/lib/audio";
import { getStudentSession, getTeacherSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ sentenceId: string }> }) {
  const { sentenceId } = await context.params;
  const audio = await referenceAudioPath(Number(sentenceId));
  if (!audio) return new Response("找不到音频", { status: 404 });
  const teacher = await getTeacherSession();
  const student = await getStudentSession();
  const allowed = Boolean(teacher) || student?.classId === audio.classId;
  if (!allowed) return new Response("找不到音频", { status: 404 });
  return audioResponse(audio.path, request);
}
