import { createAssignment } from "@/lib/assignments";
import { requireTeacher } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireTeacher();
    const body = (await request.json()) as { title?: string; textEn?: string; textZh?: string };
    const id = createAssignment({
      title: body.title ?? "",
      textEn: body.textEn ?? "",
      textZh: body.textZh ?? "",
    });
    return Response.json({ id });
  } catch (error) {
    return errorResponse(error);
  }
}
