import { demoVideoPath } from "@/lib/assignments";
import { getStudentSession, getTeacherSession } from "@/lib/auth";
import { isRemoteVideoPath } from "@/lib/blob-path";
import { signedVideoRedirect } from "@/lib/blob-store";
import { videoFileResponse } from "@/lib/video";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await context.params;
  const video = await demoVideoPath(Number(assignmentId));
  if (!video) return new Response("找不到视频", { status: 404 });
  const teacher = await getTeacherSession();
  const student = await getStudentSession();
  const allowed = Boolean(teacher) || student?.classId === video.classId;
  if (!allowed) return new Response("找不到视频", { status: 404 });
  if (isRemoteVideoPath(video.path)) return signedVideoRedirect(video.path);
  return videoFileResponse(video.path, request);
}
