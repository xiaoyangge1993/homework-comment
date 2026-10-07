import { getStudentSession } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { assertRetry, gradeAttempt } from "@/lib/grading";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const student = await getStudentSession();
    if (!student) throw new AppError("请先输入班级码和姓名", 401);
    const { id } = await context.params;
    const attemptId = Number(id);
    await assertRetry(attemptId, student.studentId);
    await gradeAttempt(attemptId);
    return Response.json({ ok: true, attemptId });
  } catch (error) {
    return errorResponse(error);
  }
}
