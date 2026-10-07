import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getAssignment } from "@/lib/assignments";
import { getStudentSession, requireTeacher } from "@/lib/auth";
import { pathnameAllowed } from "@/lib/blob-path";
import { blobConfigured, videoStorageMode } from "@/lib/blob-store";
import { limits } from "@/lib/config";
import { AppError, errorResponse } from "@/lib/errors";
import { BLOB_NOT_CONFIGURED } from "@/lib/response-error";
import { canRecordSentence, getStudentAssignment } from "@/lib/submissions";

export const runtime = "nodejs";

type UploadClaim = { kind: "demo" | "attempt"; assignmentId: number; sentenceId?: number };

function readClaim(raw: string | null): UploadClaim {
  if (!raw) throw new AppError("缺少上传说明");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("缺少上传说明");
  }
  if (!parsed || typeof parsed !== "object") throw new AppError("缺少上传说明");
  const kind = (parsed as { kind?: unknown }).kind;
  const assignmentId = Number((parsed as { assignmentId?: unknown }).assignmentId);
  const sentenceValue = (parsed as { sentenceId?: unknown }).sentenceId;
  const sentenceId = sentenceValue == null ? undefined : Number(sentenceValue);
  if ((kind !== "demo" && kind !== "attempt") || !Number.isInteger(assignmentId) || assignmentId <= 0) {
    throw new AppError("缺少上传说明");
  }
  if (sentenceId != null && !Number.isInteger(sentenceId)) throw new AppError("缺少上传说明");
  return { kind, assignmentId, sentenceId };
}

async function authorize(claim: UploadClaim): Promise<{ prefix: string; maxBytes: number }> {
  if (claim.kind === "demo") {
    await requireTeacher();
    const detail = await getAssignment(claim.assignmentId);
    if (detail.status !== "draft") throw new AppError("发布后不能再换布置视频");
    return { prefix: `demo/${claim.assignmentId}`, maxBytes: limits.maxDemoVideoBytes };
  }
  const student = await getStudentSession();
  if (!student) throw new AppError("请先输入班级码和姓名", 401);
  const view = await getStudentAssignment(claim.assignmentId, student.studentId, student.classId);
  if (view.status !== "published") throw new AppError("作业还没发布", 404);
  if (claim.sentenceId != null && !canRecordSentence(view, claim.sentenceId)) throw new AppError("这句现在不能重录");
  return { prefix: `attempt/${claim.assignmentId}`, maxBytes: limits.maxSentenceVideoBytes };
}

export async function GET() {
  return Response.json(videoStorageMode());
}

export async function POST(request: Request) {
  try {
    if (!blobConfigured()) throw new AppError(BLOB_NOT_CONFIGURED);
    const body = (await request.json()) as HandleUploadBody;
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const claim = readClaim(clientPayload);
        const allowed = await authorize(claim);
        if (!pathnameAllowed(pathname, allowed.prefix)) throw new AppError("不能上传到这个位置");
        return {
          allowedContentTypes: ["video/mp4", "video/webm", "video/quicktime", "application/octet-stream"],
          maximumSizeInBytes: allowed.maxBytes,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ kind: claim.kind, assignmentId: claim.assignmentId }),
        };
      },
    });
    return Response.json(json);
  } catch (error) {
    return errorResponse(error);
  }
}
