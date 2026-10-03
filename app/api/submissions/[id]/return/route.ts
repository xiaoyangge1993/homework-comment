import { requireTeacher } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { returnSubmission } from "@/lib/review";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireTeacher();
    const { id } = await context.params;
    const body = (await request.json()) as { sentenceIds?: number[]; text?: string };
    const speechError = await returnSubmission(Number(id), body.sentenceIds ?? [], body.text);
    return Response.json({ ok: true, speechError });
  } catch (error) {
    return errorResponse(error);
  }
}
