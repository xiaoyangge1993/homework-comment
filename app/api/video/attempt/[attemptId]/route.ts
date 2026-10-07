import { getStudentSession, getTeacherSession } from "@/lib/auth";
import { isRemoteVideoPath } from "@/lib/blob-path";
import { signedVideoRedirect } from "@/lib/blob-store";
import { attemptVideo } from "@/lib/submissions";
import { videoFileResponse } from "@/lib/video";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await context.params;
  const video = await attemptVideo(Number(attemptId));
  if (!video) return new Response("找不到视频", { status: 404 });
  const teacher = await getTeacherSession();
  const student = await getStudentSession();
  if (!teacher && student?.studentId !== video.studentId) return new Response("找不到视频", { status: 404 });
  if (isRemoteVideoPath(video.path)) return signedVideoRedirect(video.path);
  return videoFileResponse(video.path, request);
}
