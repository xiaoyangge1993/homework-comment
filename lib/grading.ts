import "server-only";

import fs from "fs";
import path from "path";
import { audioRoot, resolveAudio } from "./audio";
import { getDb } from "./db";
import { buildDraft, type DraftSentence } from "./draft";
import { AppError } from "./errors";
import { commandWorks, detectInternalPause, durationSeconds, transcodeWav } from "./media";
import { classifyRhythm } from "./rhythm";
import { wordsOf } from "./soe-parse";
import { EVALUATION_NOT_CONFIGURED, evaluateWav, soeConfigured } from "./soe";
import type { RhythmLabel, SubmissionStatus } from "./types";

type AttemptRow = {
  id: number;
  audio_path: string;
  submission_id: number;
  sentence_id: number;
  text_en: string;
  reference_audio_path: string | null;
};

export async function gradeAttempt(attemptId: number): Promise<void> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT a.id, a.audio_path, a.submission_id, a.sentence_id, s.text_en, s.reference_audio_path
       FROM sentence_attempt a JOIN sentence s ON s.id = a.sentence_id WHERE a.id = ?`,
    )
    .get(attemptId) as AttemptRow | undefined;
  if (!row) return;

  const rhythm = await measureRhythm(row.audio_path, row.reference_audio_path);
  let raw: unknown = { error: EVALUATION_NOT_CONFIGURED };
  let accuracy: number | null = null;
  let fluency: number | null = null;
  let completion: number | null = null;

  const studentFile = resolveAudio(row.audio_path);
  if (!soeConfigured()) {
    raw = { error: EVALUATION_NOT_CONFIGURED };
  } else if (!studentFile) {
    raw = { error: "找不到录音" };
  } else if (!(await commandWorks("ffmpeg"))) {
    raw = { error: "需要安装 ffmpeg 才能评测" };
  } else {
    const wavPath = path.join(audioRoot(), "wav", `${attemptId}.wav`);
    fs.mkdirSync(path.dirname(wavPath), { recursive: true });
    try {
      await transcodeWav(studentFile, wavPath);
      const evaluated = await evaluateWav(row.text_en, fs.readFileSync(wavPath));
      raw = evaluated.raw;
      if (evaluated.scores.ok) {
        accuracy = evaluated.scores.accuracy;
        fluency = evaluated.scores.fluency;
        completion = evaluated.scores.completion;
      }
    } catch {
      raw = { error: "音频转换失败" };
    }
  }

  db.prepare(
    "UPDATE sentence_attempt SET accuracy = ?, fluency = ?, completion = ?, rhythm = ?, raw_json = ? WHERE id = ?",
  ).run(accuracy, fluency, completion, rhythm, JSON.stringify(raw), attemptId);
  syncDraft(row.submission_id);
}

async function measureRhythm(studentPath: string, referencePath: string | null): Promise<RhythmLabel | null> {
  if (!referencePath) return null;
  const studentFile = resolveAudio(studentPath);
  const teacherFile = resolveAudio(referencePath);
  if (!studentFile || !teacherFile) return null;
  const studentDuration = await durationSeconds(studentFile);
  const teacherDuration = await durationSeconds(teacherFile);
  if (!studentDuration || !teacherDuration) return null;
  const pause = await detectInternalPause(studentFile, studentDuration);
  return classifyRhythm(studentDuration, teacherDuration, pause);
}

export function syncDraft(submissionId: number) {
  const db = getDb();
  const submission = db.prepare("SELECT assignment_id, status FROM submission WHERE id = ?").get(submissionId) as
    | { assignment_id: number; status: SubmissionStatus }
    | undefined;
  if (!submission || submission.status !== "submitted") return;
  const existing = db.prepare("SELECT decision FROM review WHERE submission_id = ?").get(submissionId) as
    | { decision: string | null }
    | undefined;
  if (existing?.decision) return;
  const sentences = db
    .prepare("SELECT id, idx FROM sentence WHERE assignment_id = ? ORDER BY idx, id")
    .all(submission.assignment_id) as { id: number; idx: number }[];
  const draftSentences: DraftSentence[] = sentences.map((sentence) => {
    const attempt = db
      .prepare(
        `SELECT accuracy, rhythm, raw_json FROM sentence_attempt
         WHERE submission_id = ? AND sentence_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(submissionId, sentence.id) as { accuracy: number | null; rhythm: RhythmLabel | null; raw_json: string | null } | undefined;
    const words = wordsOf(attempt?.raw_json ?? null);
    return {
      index: sentence.idx + 1,
      accuracy: attempt?.accuracy ?? null,
      evaluated: attempt?.accuracy != null,
      missed: words.filter((word) => word.matchTag === 2).map((word) => word.word),
      wrong: words.filter((word) => word.matchTag === 3).map((word) => ({ word: word.word, phone: word.phones[0]?.phone })),
      unlisted: words.filter((word) => word.matchTag === 4).map((word) => word.word),
      rhythm: attempt?.rhythm ?? null,
    };
  });
  const draft = buildDraft(draftSentences);
  if (!existing) {
    db.prepare(
      "INSERT INTO review (submission_id, draft_text, final_text, tts_audio_path, decision, sentence_ids_returned) VALUES (?, ?, NULL, NULL, NULL, NULL)",
    ).run(submissionId, draft);
  } else {
    db.prepare("UPDATE review SET draft_text = ? WHERE submission_id = ?").run(draft, submissionId);
  }
}

export function assertRetry(attemptId: number, studentId: number) {
  const row = getDb()
    .prepare(
      `SELECT s.student_id AS studentId, s.status AS status
       FROM sentence_attempt a JOIN submission s ON s.id = a.submission_id WHERE a.id = ?`,
    )
    .get(attemptId) as { studentId: number; status: SubmissionStatus } | undefined;
  if (!row || row.studentId !== studentId) throw new AppError("找不到这句录音", 404);
  if (row.status === "accepted") throw new AppError("老师已经通过，不能再评测");
}
