import { getStudentSession } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { mySubmissions } from "@/lib/submissions";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const student = await getStudentSession();
    if (!student) throw new AppError("请先输入班级码和姓名", 401);
    const assignmentId = new URL(request.url).searchParams.get("assignmentId");
    const parsed = assignmentId ? Number(assignmentId) : undefined;
    return Response.json({ submissions: mySubmissions(student.studentId, parsed) });
  } catch (error) {
    return errorResponse(error);
  }
}
