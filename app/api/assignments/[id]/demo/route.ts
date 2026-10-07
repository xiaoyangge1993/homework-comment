import { saveDemoFromBlob, saveDemoVideo } from "@/lib/assignments";
import { requireTeacher } from "@/lib/auth";
import { limits } from "@/lib/config";
import { AppError, errorResponse } from "@/lib/errors";
import { BLOB_NOT_CONFIGURED } from "@/lib/response-error";

export const runtime = "nodejs";
export const maxDuration = 300;

async function readObject(request: Request): Promise<{ blobUrl?: unknown; pathname?: unknown }> {
  try {
    return (await request.json()) as { blobUrl?: unknown; pathname?: unknown };
  } catch {
    throw new AppError("没有视频");
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireTeacher();
    const { id } = await context.params;
    const assignmentId = Number(id);
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = await readObject(request);
      if (typeof body.blobUrl !== "string" || typeof body.pathname !== "string") throw new AppError("没有视频");
      await saveDemoFromBlob(assignmentId, { blobUrl: body.blobUrl, pathname: body.pathname });
      return Response.json({ ok: true, url: `/api/video/demo/${assignmentId}` });
    }
    if (process.env.VERCEL) throw new AppError(BLOB_NOT_CONFIGURED);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("没有视频");
    if (file.size > limits.maxDemoVideoBytes) throw new AppError("布置视频不能超过 200MB");
    await saveDemoVideo(assignmentId, {
      name: file.name || "demo.webm",
      type: file.type || "",
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return Response.json({ ok: true, url: `/api/video/demo/${assignmentId}` });
  } catch (error) {
    return errorResponse(error);
  }
}
