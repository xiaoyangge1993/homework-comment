import "server-only";

import { getDb } from "./db";
import { AppError } from "./errors";
import type { AttemptView, RhythmLabel, StudentAssignmentView, SubmissionStatus } from "./types";

type StudentRow = { id: number; class_id: number; display_name: string };

export async function joinStudent(
  code: string,
  name: string,
  confirm: boolean,
): Promise<{ needConfirm: true; displayName: string } | { studentId: number; classId: number; displayName: string }> {
  const joinCode = code.trim().toUpperCase();
  const displayName = name.trim();
  if (!joinCode) throw new AppError("请填写班级码");
  if (!displayName) throw new AppError("请填写姓名");
  if (displayName.length > 20) throw new AppError("姓名请控制在 20 个字以内");
  const db = await getDb();
  const cls = (await db.prepare("SELECT id FROM class WHERE join_code = ?").get(joinCode)) as { id: number } | undefined;
  if (!cls) throw new AppError("班级码不对");
  const existing = (await db
    .prepare(
      `SELECT id, class_id, display_name FROM student
       WHERE class_id = ? AND display_name = ?
       ORDER BY COALESCE((SELECT MAX(updated_at) FROM submission WHERE student_id = student.id), '') DESC, id DESC
       LIMIT 1`,
    )
    .get(cls.id, displayName)) as StudentRow | undefined;
  if (existing && !confirm) return { needConfirm: true, displayName };
  if (existing && confirm) return { studentId: existing.id, classId: existing.class_id, displayName };
  const info = await db.prepare("INSERT INTO student (class_id, display_name) VALUES (?, ?)").run(cls.id, displayName);
  return { studentId: Number(info.lastInsertRowid), classId: cls.id, displayName };
}

export async function listOpenAssignments(classId: number) {
  const db = await getDb();
  return (await db
    .prepare(
      `SELECT id, title, status, created_at FROM assignment
       WHERE class_id = ? AND status = 'published' ORDER BY id DESC`,
    )
    .all(classId)) as { id: number; title: string; status: string; created_at: string }[];
}

function parseReturned(value: string | null): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(Number).filter((id) => Number.isInteger(id));
  } catch {
    return [];
  }
}

export async function getStudentAssignment(
  assignmentId: number,
  studentId: number,
  classId: number,
): Promise<StudentAssignmentView> {
  const db = await getDb();
  const assignment = (await db
    .prepare("SELECT id, title, status, class_id, demo_video_path FROM assignment WHERE id = ?")
    .get(assignmentId)) as
    | { id: number; title: string; status: string; class_id: number; demo_video_path: string | null }
    | undefined;
  if (!assignment || assignment.class_id !== classId) throw new AppError("找不到作业", 404);
  if (assignment.status === "draft") throw new AppError("作业还没发布", 404);
  const sentences = (await db
    .prepare("SELECT id, idx, text_en, text_zh, reference_audio_path FROM sentence WHERE assignment_id = ? ORDER BY idx, id")
    .all(assignmentId)) as {
    id: number;
    idx: number;
    text_en: string;
    text_zh: string | null;
    reference_audio_path: string | null;
  }[];
  const submission = (await db
    .prepare("SELECT id, status FROM submission WHERE assignment_id = ? AND student_id = ?")
    .get(assignmentId, studentId)) as { id: number; status: SubmissionStatus } | undefined;
  const review = submission
    ? ((await db
        .prepare("SELECT draft_text, final_text, decision, tts_audio_path, sentence_ids_returned FROM review WHERE submission_id = ?")
        .get(submission.id)) as
        | {
            draft_text: string | null;
            final_text: string | null;
            decision: "accepted" | "returned" | null;
            tts_audio_path: string | null;
            sentence_ids_returned: string | null;
          }
        | undefined)
    : undefined;
  const attempts = new Map<number, AttemptView>();
  if (submission) {
    const rows = (await db
      .prepare(
        `SELECT id, sentence_id, audio_path, video_path, accuracy, fluency, completion, rhythm, raw_json, created_at
         FROM sentence_attempt WHERE submission_id = ? ORDER BY id DESC`,
      )
      .all(submission.id)) as {
      id: number;
      sentence_id: number;
      audio_path: string | null;
      video_path: string | null;
      accuracy: number | null;
      fluency: number | null;
      completion: number | null;
      rhythm: RhythmLabel | null;
      raw_json: string | null;
      created_at: string;
    }[];
    for (const row of rows) {
      if (attempts.has(row.sentence_id)) continue;
      attempts.set(row.sentence_id, {
        id: row.id,
        sentenceId: row.sentence_id,
        audioUrl: row.audio_path ? `/api/audio/attempt/${row.id}` : null,
        videoUrl: row.video_path ? `/api/video/attempt/${row.id}` : null,
        accuracy: row.accuracy,
        fluency: row.fluency,
        completion: row.completion,
        rhythm: row.rhythm,
        rawJson: row.raw_json,
        createdAt: row.created_at,
      });
    }
  }
  return {
    id: assignment.id,
    title: assignment.title,
    status: assignment.status as "published" | "closed",
    classId: assignment.class_id,
    demoVideoUrl: assignment.demo_video_path ? `/api/video/demo/${assignment.id}` : null,
    sentences: sentences.map((sentence) => ({
      id: sentence.id,
      idx: sentence.idx,
      textEn: sentence.text_en,
      textZh: sentence.text_zh ?? "",
      referenceUrl: sentence.reference_audio_path ? `/api/audio/reference/${sentence.id}` : null,
      attempt: attempts.get(sentence.id) ?? null,
    })),
    submission: submission
      ? {
          id: submission.id,
          status: submission.status,
          returnedSentenceIds: parseReturned(review?.sentence_ids_returned ?? null),
        }
      : null,
    review: review
      ? {
          draftText: review.draft_text,
          finalText: review.final_text,
          decision: review.decision,
          ttsUrl: review.tts_audio_path ? `/api/audio/review/${submission!.id}` : null,
        }
      : null,
  };
}

export function canRecordSentence(view: StudentAssignmentView, sentenceId: number): boolean {
  if (view.status !== "published") return false;
  const submission = view.submission;
  if (!submission || submission.status === "partial") return true;
  if (submission.status === "returned") return submission.returnedSentenceIds.includes(sentenceId);
  return false;
}

export async function createAttempt(input: {
  studentId: number;
  classId: number;
  assignmentId: number;
  sentenceId: number;
  audioPath: string | null;
  videoPath?: string | null;
}): Promise<{ attemptId: number; submissionId: number }> {
  const view = await getStudentAssignment(input.assignmentId, input.studentId, input.classId);
  if (!canRecordSentence(view, input.sentenceId)) throw new AppError("这句现在不能重录");
  const sentence = view.sentences.find((item) => item.id === input.sentenceId);
  if (!sentence) throw new AppError("找不到句子", 404);
  const db = await getDb();
  const now = new Date().toISOString();
  return db.transaction(async () => {
    let submissionId = view.submission?.id;
    if (!submissionId) {
      const info = await db
        .prepare("INSERT INTO submission (assignment_id, student_id, status, updated_at) VALUES (?, ?, 'partial', ?)")
        .run(input.assignmentId, input.studentId, now);
      submissionId = Number(info.lastInsertRowid);
    }
    const info = await db
      .prepare(
        `INSERT INTO sentence_attempt
          (submission_id, sentence_id, audio_path, video_path, accuracy, fluency, completion, rhythm, raw_json, created_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)`,
      )
      .run(submissionId, input.sentenceId, input.audioPath, input.videoPath ?? null, now);
    if (view.submission?.status === "returned") {
      const remaining = view.submission.returnedSentenceIds.filter((id) => id !== input.sentenceId);
      await db.prepare("UPDATE review SET sentence_ids_returned = ?, decision = ? WHERE submission_id = ?").run(
        JSON.stringify(remaining),
        remaining.length === 0 ? null : "returned",
        submissionId,
      );
    }
    await refreshSubmission(submissionId, view.sentences.length);
    return { attemptId: Number(info.lastInsertRowid), submissionId };
  });
}

async function refreshSubmission(submissionId: number, sentenceCount: number) {
  const db = await getDb();
  const submission = (await db.prepare("SELECT status FROM submission WHERE id = ?").get(submissionId)) as
    | { status: SubmissionStatus }
    | undefined;
  if (!submission || submission.status === "accepted") return;
  const review = (await db
    .prepare("SELECT decision, sentence_ids_returned FROM review WHERE submission_id = ?")
    .get(submissionId)) as { decision: string | null; sentence_ids_returned: string | null } | undefined;
  if (submission.status === "returned" && review?.decision === "returned") {
    await db.prepare("UPDATE submission SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), submissionId);
    return;
  }
  const covered = (await db
    .prepare("SELECT COUNT(DISTINCT sentence_id) AS count FROM sentence_attempt WHERE submission_id = ?")
    .get(submissionId)) as { count: number };
  const status: SubmissionStatus = covered.count >= sentenceCount && sentenceCount > 0 ? "submitted" : "partial";
  await db.prepare("UPDATE submission SET status = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), submissionId);
}

export async function attemptVideo(attemptId: number): Promise<{ path: string; studentId: number } | null> {
  const db = await getDb();
  const row = (await db
    .prepare(
      `SELECT a.video_path AS path, s.student_id AS studentId
       FROM sentence_attempt a JOIN submission s ON s.id = a.submission_id WHERE a.id = ?`,
    )
    .get(attemptId)) as { path: string | null; studentId: number } | undefined;
  if (!row?.path) return null;
  return { path: row.path, studentId: row.studentId };
}

export async function attemptAudio(attemptId: number): Promise<{ path: string; studentId: number } | null> {
  const db = await getDb();
  const row = (await db
    .prepare(
      `SELECT a.audio_path AS path, s.student_id AS studentId
       FROM sentence_attempt a JOIN submission s ON s.id = a.submission_id WHERE a.id = ?`,
    )
    .get(attemptId)) as { path: string; studentId: number } | undefined;
  if (!row?.path) return null;
  return row;
}

export async function reviewAudio(submissionId: number): Promise<{ path: string; studentId: number } | null> {
  const db = await getDb();
  const row = (await db
    .prepare(
      `SELECT r.tts_audio_path AS path, s.student_id AS studentId
       FROM review r JOIN submission s ON s.id = r.submission_id WHERE r.submission_id = ?`,
    )
    .get(submissionId)) as { path: string | null; studentId: number } | undefined;
  if (!row?.path) return null;
  return { path: row.path, studentId: row.studentId };
}

export async function mySubmissions(studentId: number, assignmentId?: number) {
  const db = await getDb();
  const rows = (await db
    .prepare(
      `SELECT s.id, s.assignment_id, s.status, s.updated_at, a.title
       FROM submission s JOIN assignment a ON a.id = s.assignment_id
       WHERE s.student_id = ? AND (? IS NULL OR s.assignment_id = ?)
       ORDER BY s.updated_at DESC`,
    )
    .all(studentId, assignmentId ?? null, assignmentId ?? null)) as {
    id: number;
    assignment_id: number;
    status: SubmissionStatus;
    updated_at: string;
    title: string;
  }[];
  const result = [];
  for (const row of rows) {
    const student = (await db.prepare("SELECT class_id FROM student WHERE id = ?").get(studentId)) as { class_id: number };
    const detail = await getStudentAssignment(row.assignment_id, studentId, student.class_id);
    result.push({
      submissionId: row.id,
      assignmentId: row.assignment_id,
      title: row.title,
      status: row.status,
      updatedAt: row.updated_at,
      finalText: detail.review?.decision ? detail.review.finalText : null,
      ttsUrl: detail.review?.decision ? detail.review.ttsUrl : null,
      sentences: detail.sentences.map((sentence) => ({
        id: sentence.id,
        index: sentence.idx + 1,
        textEn: sentence.textEn,
        accuracy: sentence.attempt?.accuracy ?? null,
        fluency: sentence.attempt?.fluency ?? null,
        completion: sentence.attempt?.completion ?? null,
        rhythm: sentence.attempt?.rhythm ?? null,
        rawJson: sentence.attempt?.rawJson ?? null,
        audioUrl: sentence.attempt?.audioUrl ?? null,
        videoUrl: sentence.attempt?.videoUrl ?? null,
      })),
    });
  }
  return result;
}
