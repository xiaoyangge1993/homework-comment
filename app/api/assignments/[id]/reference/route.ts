import fs from "fs";
import { setReferenceAudio } from "@/lib/assignments";
import { audioSuffix, contentTypeFor, resolveAudio, saveAudio } from "@/lib/audio";
import { requireTeacher } from "@/lib/auth";
import { blobConfigured, putPrivateBytes, removeBlob } from "@/lib/blob-store";
import { limits } from "@/lib/config";
import { AppError, errorResponse } from "@/lib/errors";
import { referenceStorageAction } from "@/lib/reference-store";
import { BLOB_NOT_CONFIGURED } from "@/lib/response-error";

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
    const action = referenceStorageAction({ blobEnabled: blobConfigured(), vercel: Boolean(process.env.VERCEL) });
    if (action === "refuse") throw new AppError(BLOB_NOT_CONFIGURED);
    const bytes = Buffer.from(await file.arrayBuffer());
    const suffix = audioSuffix(file.name || "audio.webm");
    const filename = file.name || "audio.webm";
    if (action === "blob") {
      const blob = await putPrivateBytes(
        `reference/${assignmentId}/sentence-${sentenceId}${suffix}`,
        bytes,
        contentTypeFor(`audio${suffix}`),
      );
      try {
        await setReferenceAudio(assignmentId, sentenceId, blob.url);
      } catch (error) {
        await removeBlob(blob.url);
        throw error;
      }
    } else {
      const relative = saveAudio(`reference/${assignmentId}`, filename, bytes);
      try {
        await setReferenceAudio(assignmentId, sentenceId, relative);
      } catch (error) {
        const full = resolveAudio(relative);
        if (full) fs.unlinkSync(full);
        throw error;
      }
    }
    return Response.json({ ok: true, url: `/api/audio/reference/${sentenceId}` });
  } catch (error) {
    return errorResponse(error);
  }
}
