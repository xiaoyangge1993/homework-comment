import { mergeWithNext, splitSentence, updateSentence } from "@/lib/assignments";
import { requireTeacher } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireTeacher();
    await context.params;
    const body = (await request.json()) as {
      action?: string;
      sentenceId?: number;
      textEn?: string;
      textZh?: string;
    };
    const sentenceId = Number(body.sentenceId);
    if (!sentenceId) throw new AppError("缺少句子");
    if (body.action === "update") {
      return Response.json({ sentences: await updateSentence(sentenceId, body.textEn ?? "", body.textZh ?? "") });
    }
    if (body.action === "merge") return Response.json({ sentences: await mergeWithNext(sentenceId) });
    if (body.action === "split") return Response.json({ sentences: await splitSentence(sentenceId) });
    throw new AppError("不认识的操作");
  } catch (error) {
    return errorResponse(error);
  }
}
