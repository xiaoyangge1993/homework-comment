import { setReferenceAudio } from "@/lib/assignments";
import { saveAudio } from "@/lib/audio";
import { requireTeacher } from "@/lib/auth";
import { limits } from "@/lib/config";
import { AppError, errorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireTeacher();
    const { id } = await context.params;
    const assignmentId = Number(id);
    const form = await request.formData();
    const sentenceId = Number(form.get("sentenceId"));
    const file = form.get("file");
    if (!sentenceId) throw new AppError("缺少句子");
    if (!(file instanceof File) || file.size === 0) throw new AppError("没有录音");
    if (file.size > limits.maxAudioBytes) throw new AppError("录音太长了");
    const bytes = Buffer.from(await file.arrayBuffer());
    const relative = saveAudio(`reference/${assignmentId}`, file.name || "audio.webm", bytes);
    setReferenceAudio(assignmentId, sentenceId, relative);
    return Response.json({ ok: true, url: `/api/audio/reference/${sentenceId}` });
  } catch (error) {
    return errorResponse(error);
  }
}
