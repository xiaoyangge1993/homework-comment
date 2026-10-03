import { saveAudio } from "@/lib/audio";
import { getStudentSession } from "@/lib/auth";
import { limits } from "@/lib/config";
import { AppError, errorResponse } from "@/lib/errors";
import { gradeAttempt } from "@/lib/grading";
import { createAttempt } from "@/lib/submissions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const student = await getStudentSession();
    if (!student) throw new AppError("请先输入班级码和姓名", 401);
    const form = await request.formData();
    const assignmentId = Number(form.get("assignmentId"));
    const sentenceId = Number(form.get("sentenceId"));
    const file = form.get("file");
    if (!assignmentId || !sentenceId) throw new AppError("缺少句子");
    if (!(file instanceof File) || file.size === 0) throw new AppError("没有录音");
    if (file.size > limits.maxAudioBytes) throw new AppError("录音太长了");
    const relative = saveAudio(
      `attempt/${assignmentId}`,
      file.name || "audio.webm",
      Buffer.from(await file.arrayBuffer()),
    );
    const saved = createAttempt({
      studentId: student.studentId,
      classId: student.classId,
      assignmentId,
      sentenceId,
      audioPath: relative,
    });
    await gradeAttempt(saved.attemptId);
    return Response.json({ ok: true, ...saved });
  } catch (error) {
    return errorResponse(error);
  }
}
