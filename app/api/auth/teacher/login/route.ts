import { cookies } from "next/headers";
import { cookieOptions, loginTeacher, TEACHER_COOKIE } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { password?: string };
    const token = await loginTeacher(body.password ?? "");
    const jar = await cookies();
    jar.set(TEACHER_COOKIE, token, cookieOptions);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
