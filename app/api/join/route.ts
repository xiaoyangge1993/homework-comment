import { cookies } from "next/headers";
import { cookieOptions, signStudent, STUDENT_COOKIE } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { joinStudent } from "@/lib/submissions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { code?: string; name?: string; confirm?: boolean };
    const result = joinStudent(body.code ?? "", body.name ?? "", Boolean(body.confirm));
    if ("needConfirm" in result) return Response.json(result);
    const jar = await cookies();
    jar.set(STUDENT_COOKIE, signStudent(result.studentId, result.classId), cookieOptions);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
