import "server-only";

import fs from "fs";
import os from "os";
import path from "path";
import { audioRoot, resolveAudio } from "./audio";
import { openReferenceFile } from "./reference-file";
import { isRemoteVideoPath } from "./blob-path";
import { readBlobToFile } from "./blob-store";
import { recognizeEnglish } from "./asr";
import { INAUDIBLE_ERROR, limits } from "./config";
import { getDb } from "./db";
import { buildDraft, type DraftSentence } from "./draft";
import { AppError } from "./errors";
import { failed, isFinalDirection, isIntonationStatus, type StoredIntonation } from "./intonation";
import { measureIntonation } from "./intonation-run";
import { commandWorks, detectInternalPause, durationSeconds, transcodeWav } from "./media";
import { extractWav, resolveVideo } from "./video";
import { decodePcmWav, encodePcm16Wav, isInaudible, trimEdgeSilence } from "./wav";
import { classifyRhythm } from "./rhythm";
import {
  applyRecheck,
  completionPercent,
  contentRecheckIndexes,
  isFunctionWord,
  reconcileFunctionMisses,
} from "./soe-judge";
import { storedError, wordsOf, type ParsedWord } from "./soe-parse";
import { englishTokens } from "./sentences";
import { EVALUATION_NOT_CONFIGURED, evaluateWav, soeConfigured } from "./soe";
import type { RhythmLabel, SubmissionStatus } from "./types";

type AttemptRow = {
  id: number;
  audio_path: string | null;
  video_path: string | null;
  submission_id: number;
  sentence_id: number;
  text_en: string;
  reference_audio_path: string | null;
};

type Prepared =
  | { ok: true; bytes: Buffer }
  | { ok: false; inaudible: true }
  | { ok: false; error: string };

type Evaluation = Awaited<ReturnType<typeof evaluateWav>>;

function wordModeWords(checked: Evaluation): ParsedWord[] | null {
  const error = checked.raw && typeof checked.raw === "object" ? (checked.raw as { error?: unknown }).error : null;
  if (typeof error === "string" && error !== "评测结果无效") return null;
  return checked.scores.words.length > 0 ? checked.scores.words : null;
}

export async function gradeAttempt(attemptId: number): Promise<void> {
  const db = await getDb();
  const row = (await db
    .prepare(
      `SELECT a.id, a.audio_path, a.video_path, a.submission_id, a.sentence_id, s.text_en, s.reference_audio_path
       FROM sentence_attempt a JOIN sentence s ON s.id = a.sentence_id WHERE a.id = ?`,
    )
    .get(attemptId)) as AttemptRow | undefined;
  if (!row) return;

  let audioRelative = row.audio_path;
  if (row.video_path && !isPcm16k(audioRelative)) {
    const extracted = await extractAttemptAudio(attemptId, row.video_path);
    if (!extracted.ok) {
      await writeGrade(attemptId, row.submission_id, null, { error: extracted.error }, null, null, null, null);
      return;
    }
    audioRelative = extracted.path;
    await db.prepare("UPDATE sentence_attempt SET audio_path = ? WHERE id = ?").run(audioRelative, attemptId);
  }

  const studentFile = audioRelative ? resolveAudio(audioRelative) : null;
  if (!studentFile) {
    await writeGrade(
      attemptId,
      row.submission_id,
      null,
      { error: row.video_path ? "音频转换失败" : "找不到录音" },
      null,
      null,
      null,
      null,
    );
    return;
  }

  const prepared = await prepareScoringWav(attemptId, studentFile);
  if (!prepared.ok) {
    const raw = "error" in prepared ? { error: prepared.error } : { error: INAUDIBLE_ERROR };
    const intonation =
      "inaudible" in prepared && prepared.inaudible
        ? await attachIntonation(`wav/${attemptId}.wav`, row.reference_audio_path)
        : null;
    await writeGrade(attemptId, row.submission_id, null, raw, null, null, null, intonation);
    return;
  }

  const rhythm = await measureRhythm(`wav/${attemptId}.wav`, row.reference_audio_path);
  const intonation = await attachIntonation(`wav/${attemptId}.wav`, row.reference_audio_path);
  if (!soeConfigured()) {
    await writeGrade(attemptId, row.submission_id, rhythm, { error: EVALUATION_NOT_CONFIGURED }, null, null, null, intonation);
    return;
  }

  const started = Date.now();
  const remaining = () => Math.max(0, limits.gradeBudgetMs - (Date.now() - started));
  const evaluated = await evaluateWav(row.text_en, prepared.bytes, { timeoutMs: Math.min(20_000, remaining()) });
  const judged = await judgeSentence(row.text_en, prepared.bytes, evaluated, remaining);
  await writeGrade(
    attemptId,
    row.submission_id,
    rhythm,
    judged.raw,
    judged.accuracy,
    judged.fluency,
    judged.completion,
    intonation,
  );
}

async function attachIntonation(studentRelative: string, referencePath: string | null): Promise<StoredIntonation> {
  try {
    return await measureIntonation(studentRelative, referencePath);
  } catch {
    return failed("failed");
  }
}

async function judgeSentence(text: string, wav: Buffer, evaluated: Evaluation, remaining: () => number) {
  const scores = evaluated.scores;
  if (!scores.ok) {
    return {
      raw: { sentence: evaluated.raw, error: scores.error ?? "评测失败" },
      accuracy: null as number | null,
      fluency: null as number | null,
      completion: null as number | null,
    };
  }
  const reference = scores.words.filter((word) => word.kind !== "extra");
  const tokens = englishTokens(text);
  const base = { sentence: evaluated.raw, asr: null as unknown, wordChecks: [] as { word: string; raw: unknown }[] };
  if (reference.length !== tokens.length || tokens.length === 0) {
    return { raw: base, accuracy: scores.accuracy, fluency: scores.fluency, completion: null };
  }

  let kinds = reference.map((word) => word.kind);
  const aligned = () => reference.map((word, index) => ({ text: tokens[index] ?? word.word, kind: kinds[index] }));
  if (aligned().some((token) => token.kind === "miss" && isFunctionWord(token.text)) && remaining() > 2000) {
    const heard = await recognizeEnglish(wav, Math.min(8000, remaining()));
    base.asr = heard.raw;
    kinds = reconcileFunctionMisses(aligned(), { ran: true, text: heard.text });
  }

  for (const index of contentRecheckIndexes(aligned(), limits.wordRecheckLimit)) {
    if (remaining() < 2000) break;
    const word = tokens[index] ?? "";
    if (!word) continue;
    const checked = await evaluateWav(word, wav, { evalMode: 4, timeoutMs: Math.min(6000, remaining()) });
    base.wordChecks.push({ word, raw: checked.raw });
    kinds[index] = applyRecheck(kinds[index], wordModeWords(checked));
  }

  const missed = kinds.filter((kind) => kind === "miss").length;
  return {
    raw: {
      ...base,
      judgment: {
        words: reference.map((word, index) => ({
          word: tokens[index] ?? word.word,
          kind: kinds[index],
          beginMs: word.beginMs,
          endMs: word.endMs,
          phone: word.phones[0]?.phone,
        })),
        extras: scores.words.filter((word) => word.kind === "extra").map((word) => word.word),
      },
    },
    accuracy: scores.accuracy,
    fluency: scores.fluency,
    completion: completionPercent(tokens.length, missed),
  };
}

async function prepareScoringWav(attemptId: number, sourceFile: string): Promise<Prepared> {
  const wavPath = path.join(audioRoot(), "wav", `${attemptId}.wav`);
  fs.mkdirSync(path.dirname(wavPath), { recursive: true });
  const decoded = await pcmOrTranscode(sourceFile, wavPath);
  if (!decoded.ok) return decoded;
  const trimmed = trimEdgeSilence(decoded.samples, decoded.sampleRate);
  const bytes = Buffer.from(encodePcm16Wav(trimmed, 16000));
  fs.writeFileSync(wavPath, bytes);
  if (isInaudible(trimmed, 16000)) return { ok: false, inaudible: true };
  return { ok: true, bytes };
}

async function pcmOrTranscode(
  sourceFile: string,
  wavPath: string,
): Promise<{ ok: true; samples: Int16Array; sampleRate: number } | { ok: false; error: string }> {
  const direct = pcm16kWav(sourceFile);
  if (direct) {
    const decoded = decodePcmWav(direct);
    if (!decoded || decoded.sampleRate !== 16000) return { ok: false, error: "音频转换失败" };
    return { ok: true, samples: decoded.samples, sampleRate: decoded.sampleRate };
  }
  if (!(await commandWorks("ffmpeg"))) return { ok: false, error: "需要安装 ffmpeg 才能评测" };
  try {
    await transcodeWav(sourceFile, wavPath);
    const decoded = decodePcmWav(fs.readFileSync(wavPath));
    if (!decoded || decoded.sampleRate !== 16000) return { ok: false, error: "音频转换失败" };
    return { ok: true, samples: decoded.samples, sampleRate: decoded.sampleRate };
  } catch {
    return { ok: false, error: "音频转换失败" };
  }
}

async function writeGrade(
  attemptId: number,
  submissionId: number,
  rhythm: RhythmLabel | null,
  raw: unknown,
  accuracy: number | null,
  fluency: number | null,
  completion: number | null,
  intonation: StoredIntonation | null,
) {
  const db = await getDb();
  await db
    .prepare(
      `UPDATE sentence_attempt
       SET accuracy = ?, fluency = ?, completion = ?, rhythm = ?, raw_json = ?,
           intonation_status = ?, teacher_final = ?, student_final = ?, contour_agreement = ?, intonation_json = ?
       WHERE id = ?`,
    )
    .run(
      accuracy,
      fluency,
      completion,
      rhythm,
      JSON.stringify(raw),
      intonation?.status ?? null,
      intonation?.teacherFinal ?? null,
      intonation?.studentFinal ?? null,
      intonation?.agreement ?? null,
      intonation?.json ?? null,
      attemptId,
    );
  await syncDraft(submissionId);
}

function isPcm16k(relative: string | null): boolean {
  if (!relative) return false;
  const file = resolveAudio(relative);
  return Boolean(file && pcm16kWav(file));
}

async function openStoredVideo(stored: string): Promise<{ absolute: string; close: () => void } | null> {
  if (!isRemoteVideoPath(stored)) {
    const local = resolveVideo(stored);
    if (!local) return null;
    return { absolute: local, close: () => undefined };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hw-grade-"));
  const ext = path.extname(new URL(stored).pathname) || ".mp4";
  const absolute = path.join(dir, `source${ext}`);
  try {
    await readBlobToFile(stored, absolute);
  } catch {
    fs.rmSync(dir, { recursive: true, force: true });
    return null;
  }
  return {
    absolute,
    close: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

async function extractAttemptAudio(
  attemptId: number,
  videoStored: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const opened = await openStoredVideo(videoStored);
  if (!opened) return { ok: false, error: "找不到视频" };
  if (!(await commandWorks("ffmpeg"))) {
    opened.close();
    return { ok: false, error: "需要安装 ffmpeg 才能评测" };
  }
  const wavPath = path.join(audioRoot(), "wav", `${attemptId}.wav`);
  try {
    const relative = await extractWav(opened.absolute, wavPath, 60_000);
    return { ok: true, path: relative };
  } catch {
    return { ok: false, error: "音频转换失败" };
  } finally {
    opened.close();
  }
}

function pcm16kWav(file: string): Buffer | null {
  try {
    const bytes = fs.readFileSync(file);
    const decoded = decodePcmWav(bytes);
    if (!decoded || decoded.sampleRate !== 16000) return null;
    if (decoded.channels === 1) return bytes;
    return Buffer.from(encodePcm16Wav(decoded.samples, 16000));
  } catch {
    return null;
  }
}

async function measureRhythm(studentPath: string, referencePath: string | null): Promise<RhythmLabel | null> {
  if (!referencePath) return null;
  const studentFile = resolveAudio(studentPath);
  const teacher = await openReferenceFile(referencePath);
  try {
    if (!studentFile || !teacher.absolute) return null;
    const studentDuration = await durationSeconds(studentFile);
    const teacherDuration = await durationSeconds(teacher.absolute);
    if (!studentDuration || !teacherDuration) return null;
    const pause = await detectInternalPause(studentFile, studentDuration);
    return classifyRhythm(studentDuration, teacherDuration, pause);
  } finally {
    teacher.close();
  }
}

function completionFrom(text: string, words: ParsedWord[], accuracy: number | null): number | null | undefined {
  if (accuracy == null) return undefined;
  const tokens = englishTokens(text);
  const aligned = words.filter((word) => word.kind !== "extra");
  if (tokens.length === 0) return null;
  if (aligned.length !== tokens.length) return undefined;
  return completionPercent(tokens.length, aligned.filter((word) => word.kind === "miss").length);
}

function sameNumber(left: number | null, right: number | null): boolean {
  if (left == null || right == null) return left === right;
  return Math.round(left * 10) === Math.round(Number(right) * 10);
}

export async function syncDraft(submissionId: number) {
  const db = await getDb();
  const submission = (await db.prepare("SELECT assignment_id, status FROM submission WHERE id = ?").get(submissionId)) as
    | { assignment_id: number; status: SubmissionStatus }
    | undefined;
  if (!submission || submission.status !== "submitted") return;
  const existing = (await db.prepare("SELECT decision FROM review WHERE submission_id = ?").get(submissionId)) as
    | { decision: string | null }
    | undefined;
  if (existing?.decision) return;
  const sentences = (await db
    .prepare("SELECT id, idx, text_en FROM sentence WHERE assignment_id = ? ORDER BY idx, id")
    .all(submission.assignment_id)) as { id: number; idx: number; text_en: string }[];
  const draftSentences: DraftSentence[] = [];
  for (const sentence of sentences) {
    const attempt = (await db
      .prepare(
        `SELECT id, accuracy, completion, rhythm, raw_json, intonation_status, teacher_final FROM sentence_attempt
         WHERE submission_id = ? AND sentence_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(submissionId, sentence.id)) as
      | {
          id: number;
          accuracy: number | null;
          completion: number | null;
          rhythm: RhythmLabel | null;
          raw_json: string | null;
          intonation_status: string | null;
          teacher_final: string | null;
        }
      | undefined;
    const words = wordsOf(attempt?.raw_json ?? null);
    const completion = completionFrom(sentence.text_en, words, attempt?.accuracy ?? null);
    if (attempt && completion !== undefined && !sameNumber(completion, attempt.completion)) {
      await db.prepare("UPDATE sentence_attempt SET completion = ? WHERE id = ?").run(completion, attempt.id);
    }
    draftSentences.push({
      index: sentence.idx + 1,
      accuracy: attempt?.accuracy ?? null,
      evaluated: attempt?.accuracy != null,
      inaudible: storedError(attempt?.raw_json ?? null) === INAUDIBLE_ERROR,
      missed: words.filter((word) => word.kind === "miss").map((word) => word.word),
      wrong: words.filter((word) => word.kind === "wrong").map((word) => ({ word: word.word, phone: word.phones[0]?.phone })),
      rhythm: attempt?.rhythm ?? null,
      intonationStatus: isIntonationStatus(attempt?.intonation_status) ? attempt.intonation_status : null,
      teacherFinal: isFinalDirection(attempt?.teacher_final) ? attempt.teacher_final : null,
    });
  }
  const draft = buildDraft(draftSentences);
  if (!existing) {
    await db
      .prepare(
        "INSERT INTO review (submission_id, draft_text, final_text, tts_audio_path, decision, sentence_ids_returned) VALUES (?, ?, NULL, NULL, NULL, NULL)",
      )
      .run(submissionId, draft);
  } else {
    await db.prepare("UPDATE review SET draft_text = ? WHERE submission_id = ?").run(draft, submissionId);
  }
}

export async function assertRetry(attemptId: number, studentId: number) {
  const db = await getDb();
  const row = (await db
    .prepare(
      `SELECT s.student_id AS studentId, s.status AS status
       FROM sentence_attempt a JOIN submission s ON s.id = a.submission_id WHERE a.id = ?`,
    )
    .get(attemptId)) as { studentId: number; status: SubmissionStatus } | undefined;
  if (!row || row.studentId !== studentId) throw new AppError("找不到这句录音", 404);
  if (row.status === "accepted") throw new AppError("老师已经通过，不能再评测");
}
