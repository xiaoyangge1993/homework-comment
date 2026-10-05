import { saveAudio } from "@/lib/audio";
import { getStudentSession } from "@/lib/auth";
import { limits } from "@/lib/config";
import { AppError, errorResponse } from "@/lib/errors";
import { gradeAttempt } from "@/lib/grading";
import { createAttempt } from "@/lib/submissions";
import { acceptVideoUpload } from "@/lib/video";
import { isVideoUpload } from "@/lib/video-kind";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const student = await getStudentSession();
    if (!student) throw new AppError("请先输入班级码和姓名", 401);
    const form = await request.formData();
    const assignmentId = Number(form.get("assignmentId"));
    const sentenceId = Number(form.get("sentenceId"));
    const file = form.get("file");
    if (!assignmentId || !sentenceId) throw new AppError("缺少句子");
    if (!(file instanceof File) || file.size === 0) throw new AppError("没有录音");
    const video = isVideoUpload(String(form.get("kind") || ""), file.name || "", file.type || "");
    if (video) {
      if (file.size > limits.maxSentenceVideoBytes) throw new AppError("这句视频不能超过 80MB");
      const stored = await acceptVideoUpload({
        subdir: `attempt/${assignmentId}`,
        filename: file.name || "clip.webm",
        mime: file.type || "",
        bytes: Buffer.from(await file.arrayBuffer()),
        maxBytes: limits.maxSentenceVideoBytes,
        maxSeconds: limits.maxSentenceVideoSeconds,
        badType: "这句视频只接受 mp4、webm、mov",
        tooBig: "这句视频不能超过 80MB",
        tooLong: "这句视频不能超过 60 秒",
        unreadable: "读不出视频时长",
        missingFfmpeg: "需要安装 ffmpeg 才能提交视频",
      });
      const saved = await createAttempt({
        studentId: student.studentId,
        classId: student.classId,
        assignmentId,
        sentenceId,
        audioPath: null,
        videoPath: stored.relative,
      });
      await gradeAttempt(saved.attemptId);
      return Response.json({ ok: true, ...saved });
    }
    if (file.size > limits.maxAudioBytes) throw new AppError("录音太长了");
    const relative = saveAudio(
      `attempt/${assignmentId}`,
      file.name || "audio.webm",
      Buffer.from(await file.arrayBuffer()),
    );
    const saved = await createAttempt({
      studentId: student.studentId,
      classId: student.classId,
      assignmentId,
      sentenceId,
      audioPath: relative,
    });
    await gradeAttempt(saved.attemptId);
    return Response.json({ ok: true, ...saved });
  } catch (error) {
    return errorResponse(error);
  }
}
