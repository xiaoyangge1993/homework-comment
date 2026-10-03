import "server-only";

import { randomBytes } from "crypto";
import { limits } from "./config";
import { getDb } from "./db";
import { AppError } from "./errors";
import { countWords, mergeText, pairSentences, splitChineseOnce, splitOnce, tooLong } from "./sentences";
import type { AssignmentStatus, SentenceDTO } from "./types";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type AssignmentDetail = {
  id: number;
  classId: number;
  title: string;
  status: AssignmentStatus;
  createdAt: string;
  joinCode: string | null;
  missingReference: boolean;
  sentences: SentenceDTO[];
};

type SentenceRow = {
  id: number;
  assignment_id: number;
  idx: number;
  text_en: string;
  text_zh: string | null;
  reference_audio_path: string | null;
};

type AssignmentRow = {
  id: number;
  class_id: number;
  title: string;
  status: "draft" | "published" | "closed";
  created_at: string;
  join_code: string | null;
};

function toSentence(row: SentenceRow): SentenceDTO {
  return {
    id: row.id,
    idx: row.idx,
    textEn: row.text_en,
    textZh: row.text_zh ?? "",
    wordCount: countWords(row.text_en),
    tooLong: tooLong(row.text_en),
    referenceUrl: row.reference_audio_path ? `/api/audio/reference/${row.id}` : null,
  };
}

export function listAssignments() {
  const db = getDb();
  return db
    .prepare(
      `SELECT a.id, a.title, a.status, a.created_at, c.join_code,
        (SELECT COUNT(*) FROM sentence s WHERE s.assignment_id = a.id) AS sentence_count,
        (SELECT COUNT(*) FROM sentence s WHERE s.assignment_id = a.id AND (s.reference_audio_path IS NULL OR s.reference_audio_path = '')) AS missing_reference
      FROM assignment a
      JOIN class c ON c.id = a.class_id
      ORDER BY a.id DESC`,
    )
    .all() as {
    id: number;
    title: string;
    status: "draft" | "published" | "closed";
    created_at: string;
    join_code: string | null;
    sentence_count: number;
    missing_reference: number;
  }[];
}

function classId(): number {
  const row = getDb().prepare("SELECT id FROM class ORDER BY id LIMIT 1").get() as { id: number } | undefined;
  if (!row) throw new AppError("请先在 .env.local 设置 TEACHER_PASSWORD 并重启");
  return row.id;
}

export function createAssignment(input: { title: string; textEn: string; textZh: string }): number {
  const title = input.title.trim();
  if (!title) throw new AppError("请填写标题");
  const pairs = pairSentences(input.textEn, input.textZh || "");
  if (pairs.length === 0) throw new AppError("没有拆出英文句子。请用句号、问号或感叹号断句。");
  const db = getDb();
  const owner = classId();
  const now = new Date().toISOString();
  const insert = db.transaction(() => {
    const info = db
      .prepare("INSERT INTO assignment (class_id, title, status, created_at) VALUES (?, ?, 'draft', ?)")
      .run(owner, title, now);
    const id = Number(info.lastInsertRowid);
    const sentence = db.prepare(
      "INSERT INTO sentence (assignment_id, idx, text_en, text_zh, reference_audio_path) VALUES (?, ?, ?, ?, NULL)",
    );
    pairs.forEach((pair, idx) => sentence.run(id, idx, pair.textEn, pair.textZh || null));
    return id;
  });
  return insert();
}

export function getAssignment(id: number): AssignmentDetail {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT a.id, a.class_id, a.title, a.status, a.created_at, c.join_code
       FROM assignment a JOIN class c ON c.id = a.class_id WHERE a.id = ?`,
    )
    .get(id) as AssignmentRow | undefined;
  if (!row) throw new AppError("找不到作业", 404);
  const sentences = db
    .prepare("SELECT * FROM sentence WHERE assignment_id = ? ORDER BY idx, id")
    .all(id) as SentenceRow[];
  return {
    id: row.id,
    classId: row.class_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    joinCode: row.join_code,
    missingReference: sentences.some((sentence) => !sentence.reference_audio_path),
    sentences: sentences.map(toSentence),
  };
}

function draftSentence(sentenceId: number): SentenceRow {
  const db = getDb();
  const row = db.prepare("SELECT * FROM sentence WHERE id = ?").get(sentenceId) as SentenceRow | undefined;
  if (!row) throw new AppError("找不到句子", 404);
  const assignment = db.prepare("SELECT status FROM assignment WHERE id = ?").get(row.assignment_id) as
    | { status: string }
    | undefined;
  if (!assignment) throw new AppError("找不到作业", 404);
  if (assignment.status !== "draft") throw new AppError("发布后不能再改句子");
  return row;
}

function sentenceList(assignmentId: number): SentenceDTO[] {
  const rows = getDb()
    .prepare("SELECT * FROM sentence WHERE assignment_id = ? ORDER BY idx, id")
    .all(assignmentId) as SentenceRow[];
  return rows.map(toSentence);
}

export function updateSentence(sentenceId: number, textEn: string, textZh: string): SentenceDTO[] {
  const row = draftSentence(sentenceId);
  const english = textEn.trim();
  if (!english) throw new AppError("英文不能为空");
  if (countWords(english) === 0) throw new AppError("这句里没有英文单词");
  getDb()
    .prepare("UPDATE sentence SET text_en = ?, text_zh = ? WHERE id = ?")
    .run(english, textZh.trim() || null, sentenceId);
  return sentenceList(row.assignment_id);
}

export function mergeWithNext(sentenceId: number): SentenceDTO[] {
  const row = draftSentence(sentenceId);
  const db = getDb();
  const next = db
    .prepare("SELECT * FROM sentence WHERE assignment_id = ? AND idx = ?")
    .get(row.assignment_id, row.idx + 1) as SentenceRow | undefined;
  if (!next) throw new AppError("没有下一句可以合并");
  const run = db.transaction(() => {
    db.prepare("UPDATE sentence SET text_en = ?, text_zh = ? WHERE id = ?").run(
      mergeText(row.text_en, next.text_en),
      mergeText(row.text_zh ?? "", next.text_zh ?? "") || null,
      row.id,
    );
    db.prepare("DELETE FROM sentence WHERE id = ?").run(next.id);
    reindex(row.assignment_id);
  });
  run();
  return sentenceList(row.assignment_id);
}

export function splitSentence(sentenceId: number): SentenceDTO[] {
  const row = draftSentence(sentenceId);
  const parts = splitOnce(row.text_en);
  if (!parts) throw new AppError("这句太短，没法拆开");
  const gloss = splitChineseOnce(row.text_zh ?? "");
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare("UPDATE sentence SET idx = idx + 1000 WHERE assignment_id = ? AND idx > ?").run(
      row.assignment_id,
      row.idx,
    );
    db.prepare("UPDATE sentence SET text_en = ?, text_zh = ? WHERE id = ?").run(parts[0], gloss[0] || null, row.id);
    db.prepare(
      "INSERT INTO sentence (assignment_id, idx, text_en, text_zh, reference_audio_path) VALUES (?, ?, ?, ?, NULL)",
    ).run(row.assignment_id, row.idx + 1, parts[1], gloss[1] || null);
    reindex(row.assignment_id);
  });
  run();
  return sentenceList(row.assignment_id);
}

function reindex(assignmentId: number) {
  const db = getDb();
  const rows = db
    .prepare("SELECT id FROM sentence WHERE assignment_id = ? ORDER BY idx, id")
    .all(assignmentId) as { id: number }[];
  const update = db.prepare("UPDATE sentence SET idx = ? WHERE id = ?");
  rows.forEach((row, index) => update.run(index, row.id));
}

export function setReferenceAudio(assignmentId: number, sentenceId: number, relativePath: string) {
  const row = draftSentence(sentenceId);
  if (row.assignment_id !== assignmentId) throw new AppError("句子不属于这份作业");
  getDb().prepare("UPDATE sentence SET reference_audio_path = ? WHERE id = ?").run(relativePath, sentenceId);
}

function makeJoinCode(): string {
  const db = getDb();
  for (let attempt = 0; attempt < 20; attempt++) {
    const bytes = randomBytes(6);
    const code = Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
    const taken = db.prepare("SELECT id FROM class WHERE join_code = ?").get(code);
    if (!taken) return code;
  }
  throw new AppError("班级码暂时生成不了，请再试一次");
}

export function publishAssignment(id: number): { joinCode: string } {
  const detail = getAssignment(id);
  if (detail.status !== "draft") throw new AppError("只有草稿可以发布");
  if (detail.sentences.length === 0) throw new AppError("还没有句子");
  for (const sentence of detail.sentences) {
    if (sentence.wordCount === 0) throw new AppError(`第 ${sentence.idx + 1} 句没有英文`);
    if (sentence.tooLong) {
      throw new AppError(`第 ${sentence.idx + 1} 句超过 ${limits.maxWordsPerSentence} 个词，请先拆开`);
    }
  }
  const db = getDb();
  let joinCode = detail.joinCode;
  if (!joinCode) {
    joinCode = makeJoinCode();
    db.prepare("UPDATE class SET join_code = ? WHERE id = ?").run(joinCode, detail.classId);
  }
  db.prepare("UPDATE assignment SET status = 'published' WHERE id = ?").run(id);
  return { joinCode };
}

export function closeAssignment(id: number) {
  const detail = getAssignment(id);
  if (detail.status !== "published") throw new AppError("只有已发布的作业可以结束");
  getDb().prepare("UPDATE assignment SET status = 'closed' WHERE id = ?").run(id);
}

export function referenceAudioPath(sentenceId: number): { path: string; classId: number } | null {
  const row = getDb()
    .prepare(
      `SELECT s.reference_audio_path AS path, a.class_id AS classId
       FROM sentence s JOIN assignment a ON a.id = s.assignment_id WHERE s.id = ?`,
    )
    .get(sentenceId) as { path: string | null; classId: number } | undefined;
  if (!row?.path) return null;
  return { path: row.path, classId: row.classId };
}
