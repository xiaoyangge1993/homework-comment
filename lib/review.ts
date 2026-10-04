import "server-only";

import { getDb } from "./db";
import { AppError } from "./errors";
import { syncDraft } from "./grading";
import { attachSpeech } from "./tts";
import { boardGroup, compareBoard, displayAverage, groupLabel, rhythmSummary, sentenceNeedsListen, type BoardGroup } from "./listen";
import { wordsOf } from "./soe-parse";
import type { AttemptView, ReviewSentence, RhythmLabel, SubmissionStatus } from "./types";

export type BoardRow = {
  submissionId: number;
  name: string;
  status: SubmissionStatus;
  group: BoardGroup;
  advice: string;
  accuracy: number | null;
  accuracyText: string;
  fluencyText: string;
  completionText: string;
  rhythmText: string;
};

type AttemptRow = {
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
};

function latestAttempts(submissionId: number): Map<number, AttemptRow> {
  const rows = getDb()
    .prepare(
      `SELECT id, sentence_id, audio_path, video_path, accuracy, fluency, completion, rhythm, raw_json, created_at
       FROM sentence_attempt WHERE submission_id = ? ORDER BY id DESC`,
    )
    .all(submissionId) as AttemptRow[];
  const map = new Map<number, AttemptRow>();
  for (const row of rows) {
    if (!map.has(row.sentence_id)) map.set(row.sentence_id, row);
  }
  return map;
}

function toAttempt(row: AttemptRow | undefined): AttemptView | null {
  if (!row) return null;
  return {
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
  };
}

export function loadBoard(assignmentId: number): { rows: BoardRow[]; submittedCount: number; listenCount: number; passCount: number } {
  const db = getDb();
  const submissions = db
    .prepare(
      `SELECT s.id, s.status, st.display_name AS name
       FROM submission s JOIN student st ON st.id = s.student_id
       WHERE s.assignment_id = ?`,
    )
    .all(assignmentId) as { id: number; status: SubmissionStatus; name: string }[];
  const sentences = db.prepare("SELECT id FROM sentence WHERE assignment_id = ? ORDER BY idx, id").all(assignmentId) as { id: number }[];
  const rows = submissions.map((submission) => {
    if (submission.status === "submitted") syncDraft(submission.id);
    const attempts = latestAttempts(submission.id);
    const listened = sentences.map((sentence) => {
      const attempt = attempts.get(sentence.id);
      return {
        accuracy: attempt?.accuracy ?? null,
        fluency: attempt?.fluency ?? null,
        completion: attempt?.completion ?? null,
        rhythm: attempt?.rhythm ?? null,
        matchTags: wordsOf(attempt?.raw_json ?? null).map((word) => word.matchTag),
      };
    });
    const group = boardGroup(submission.status, listened);
    const accuracyValues = listened.map((sentence) => sentence.accuracy);
    const numeric = accuracyValues.filter((value): value is number => value != null);
    return {
      submissionId: submission.id,
      name: submission.name,
      status: submission.status,
      group,
      advice: groupLabel[group],
      accuracy: numeric.length === accuracyValues.length && numeric.length > 0 ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length : null,
      accuracyText: displayAverage(accuracyValues),
      fluencyText: displayAverage(listened.map((sentence) => sentence.fluency)),
      completionText: displayAverage(listened.map((sentence) => sentence.completion)),
      rhythmText: rhythmSummary(listened.map((sentence) => sentence.rhythm)),
    };
  });
  rows.sort(compareBoard);
  return {
    rows,
    submittedCount: rows.filter((row) => row.status !== "partial").length,
    listenCount: rows.filter((row) => row.group === "listen").length,
    passCount: rows.filter((row) => row.group === "pass").length,
  };
}

export function loadReview(assignmentId: number, submissionId: number) {
  const db = getDb();
  const submission = db
    .prepare(
      `SELECT s.id, s.assignment_id, s.status, st.display_name AS name
       FROM submission s JOIN student st ON st.id = s.student_id WHERE s.id = ?`,
    )
    .get(submissionId) as { id: number; assignment_id: number; status: SubmissionStatus; name: string } | undefined;
  if (!submission || submission.assignment_id !== assignmentId) throw new AppError("找不到这份作业", 404);
  if (submission.status === "submitted") syncDraft(submissionId);
  const review = db
    .prepare("SELECT draft_text, final_text, decision, tts_audio_path, sentence_ids_returned FROM review WHERE submission_id = ?")
    .get(submissionId) as
    | {
        draft_text: string | null;
        final_text: string | null;
        decision: "accepted" | "returned" | null;
        tts_audio_path: string | null;
        sentence_ids_returned: string | null;
      }
    | undefined;
  const sentences = db
    .prepare("SELECT id, idx, text_en, text_zh, reference_audio_path FROM sentence WHERE assignment_id = ? ORDER BY idx, id")
    .all(assignmentId) as {
    id: number;
    idx: number;
    text_en: string;
    text_zh: string | null;
    reference_audio_path: string | null;
  }[];
  const attempts = latestAttempts(submissionId);
  const reviewSentences: ReviewSentence[] = sentences.map((sentence) => {
    const attempt = toAttempt(attempts.get(sentence.id));
    const tags = wordsOf(attempt?.rawJson ?? null).map((word) => word.matchTag);
    const needsListen = sentenceNeedsListen({
      accuracy: attempt?.accuracy ?? null,
      fluency: attempt?.fluency ?? null,
      completion: attempt?.completion ?? null,
      rhythm: attempt?.rhythm ?? null,
      matchTags: tags,
    });
    return {
      id: sentence.id,
      index: sentence.idx + 1,
      textEn: sentence.text_en,
      textZh: sentence.text_zh ?? "",
      referenceUrl: sentence.reference_audio_path ? `/api/audio/reference/${sentence.id}` : null,
      needsListen,
      attempt,
    };
  });
  return {
    submissionId,
    studentName: submission.name,
    status: submission.status,
    draftText: review?.draft_text ?? "",
    finalText: review?.final_text ?? "",
    decision: review?.decision ?? null,
    ttsUrl: review?.tts_audio_path ? `/api/audio/review/${submissionId}` : null,
    sentences: reviewSentences,
  };
}

function requireReviewable(submissionId: number) {
  const submission = getDb()
    .prepare("SELECT id, assignment_id, status FROM submission WHERE id = ?")
    .get(submissionId) as { id: number; assignment_id: number; status: SubmissionStatus } | undefined;
  if (!submission) throw new AppError("找不到这份作业", 404);
  if (submission.status === "partial") throw new AppError("学生还没交齐");
  return submission;
}

export async function acceptSubmission(submissionId: number, mode: "draft" | "edited", text?: string) {
  const submission = requireReviewable(submissionId);
  if (submission.status === "submitted") syncDraft(submissionId);
  const db = getDb();
  const review = db.prepare("SELECT id, draft_text FROM review WHERE submission_id = ?").get(submissionId) as
    | { id: number; draft_text: string | null }
    | undefined;
  const finalText = (mode === "edited" ? text : review?.draft_text)?.trim() ?? "";
  if (!finalText) throw new AppError("没有可发送的点评");
  if (!review) {
    db.prepare(
      "INSERT INTO review (submission_id, draft_text, final_text, tts_audio_path, decision, sentence_ids_returned) VALUES (?, ?, ?, NULL, 'accepted', NULL)",
    ).run(submissionId, finalText, finalText);
  } else {
    db.prepare(
      "UPDATE review SET final_text = ?, decision = 'accepted', sentence_ids_returned = NULL, tts_audio_path = NULL WHERE submission_id = ?",
    ).run(finalText, submissionId);
  }
  db.prepare("UPDATE submission SET status = 'accepted', updated_at = ? WHERE id = ?").run(new Date().toISOString(), submissionId);
  const speechError = await attachSpeech(submissionId, finalText);
  return { submissionId, finalText, assignmentId: submission.assignment_id, speechError };
}

export async function returnSubmission(submissionId: number, sentenceIds: number[], text?: string) {
  const submission = requireReviewable(submissionId);
  const ids = [...new Set(sentenceIds.map(Number))].filter((id) => Number.isInteger(id));
  if (ids.length === 0) throw new AppError("请选择要打回的句子");
  const db = getDb();
  const owned = db.prepare("SELECT id FROM sentence WHERE assignment_id = ?").all(submission.assignment_id) as { id: number }[];
  const allowed = new Set(owned.map((sentence) => sentence.id));
  if (ids.some((id) => !allowed.has(id))) throw new AppError("句子不属于这份作业");
  if (submission.status === "submitted") syncDraft(submissionId);
  const review = db.prepare("SELECT draft_text FROM review WHERE submission_id = ?").get(submissionId) as
    | { draft_text: string | null }
    | undefined;
  const finalText = (text?.trim() || review?.draft_text || "").trim();
  if (!review) {
    db.prepare(
      "INSERT INTO review (submission_id, draft_text, final_text, tts_audio_path, decision, sentence_ids_returned) VALUES (?, ?, ?, NULL, 'returned', ?)",
    ).run(submissionId, finalText, finalText, JSON.stringify(ids));
  } else {
    db.prepare(
      "UPDATE review SET final_text = ?, decision = 'returned', sentence_ids_returned = ?, tts_audio_path = NULL WHERE submission_id = ?",
    ).run(finalText, JSON.stringify(ids), submissionId);
  }
  db.prepare("UPDATE submission SET status = 'returned', updated_at = ? WHERE id = ?").run(new Date().toISOString(), submissionId);
  return attachSpeech(submissionId, finalText);
}
