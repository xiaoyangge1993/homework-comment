import { getAssignment } from "@/lib/assignments";
import { requireTeacher } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireTeacher();
    const { id } = await context.params;
    const detail = await getAssignment(Number(id));
    return Response.json(detail);
  } catch (error) {
    return errorResponse(error);
  }
}
