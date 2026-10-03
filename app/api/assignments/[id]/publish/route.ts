import { publishAssignment } from "@/lib/assignments";
import { requireTeacher } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireTeacher();
    const { id } = await context.params;
    const result = publishAssignment(Number(id));
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
