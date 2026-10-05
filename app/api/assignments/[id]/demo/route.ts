import { saveDemoVideo } from "@/lib/assignments";
import { requireTeacher } from "@/lib/auth";
import { limits } from "@/lib/config";
import { AppError, errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireTeacher();
    const { id } = await context.params;
    const assignmentId = Number(id);
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
