import { requireTeacher } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { acceptSubmission } from "@/lib/review";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireTeacher();
    const { id } = await context.params;
    const body = (await request.json()) as { mode?: "draft" | "edited"; text?: string };
    const mode = body.mode === "edited" ? "edited" : "draft";
    const result = await acceptSubmission(Number(id), mode, body.text);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
