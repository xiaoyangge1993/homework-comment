import "server-only";

import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { audioRoot } from "./audio";
import { limits } from "./config";
import { getDb } from "./db";
import { AppError } from "./errors";
import { missingEnvMessage, readEnv } from "./env";
import { countWords, mergeText, pairSentences, splitChineseOnce, splitOnce, tooLong } from "./sentences";
import type { AssignmentStatus, SentenceDTO } from "./types";
import { blobUploadMatches } from "./blob-path";
import { removeBlob } from "./blob-store";
import { stageRemoteVideo } from "./remote-video";
import { acceptVideoUpload, extractWav } from "./video";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type AssignmentDetail = {
  id: number;
  classId: number;
  title: string;
  status: AssignmentStatus;
  createdAt: string;
  joinCode: string | null;
  missingReference: boolean;
  hasDemoVideo: boolean;
  demoVideoUrl: string | null;
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
  demo_video_path: string | null;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function toSentence(row: SentenceRow): SentenceDTO {
  const textEn = asText(row.text_en);
  const id = Number(row.id);
  return {
    id,
    idx: Number(row.idx),
    textEn,
    textZh: asText(row.text_zh),
    wordCount: countWords(textEn),
    tooLong: tooLong(textEn),
    referenceUrl: row.reference_audio_path ? `/api/audio/reference/${id}` : null,
  };
}

export async function listAssignments() {
  const db = await getDb();
  return (await db
    .prepare(
      `SELECT a.id, a.title, a.status, a.created_at, c.join_code,
        (SELECT COUNT(*) FROM sentence s WHERE s.assignment_id = a.id) AS sentence_count,
        (SELECT COUNT(*) FROM sentence s WHERE s.assignment_id = a.id AND (s.reference_audio_path IS NULL OR s.reference_audio_path = '')) AS missing_reference,
        CASE WHEN a.demo_video_path IS NOT NULL AND a.demo_video_path != '' THEN 1 ELSE 0 END AS has_demo
      FROM assignment a
      JOIN class c ON c.id = a.class_id
      ORDER BY a.id DESC`,
    )
    .all()) as {
    id: number;
    title: string;
    status: "draft" | "published" | "closed";
    created_at: string;
    join_code: string | null;
    sentence_count: number;
    missing_reference: number;
    has_demo: number;
  }[];
}

async function classId(): Promise<number> {
  const db = await getDb();
  const row = (await db.prepare("SELECT id FROM class ORDER BY id LIMIT 1").get()) as { id: number } | undefined;
  if (!row) {
    throw new AppError(readEnv("TEACHER_PASSWORD") ? "班级数据还没有写好，请重新打开页面" : missingEnvMessage("TEACHER_PASSWORD"));
  }
  return Number(row.id);
}

export async function createAssignment(input: { title: string; textEn: string; textZh: string }): Promise<number> {
  const title = input.title.trim();
  if (!title) throw new AppError("请填写标题");
  const pairs = pairSentences(input.textEn, input.textZh || "");
  if (pairs.length === 0) throw new AppError("没有拆出英文句子。请用句号、问号或感叹号断句。");
  const db = await getDb();
  const owner = await classId();
  const now = new Date().toISOString();
  return db.transaction(async () => {
    const info = await db
      .prepare("INSERT INTO assignment (class_id, title, status, created_at) VALUES (?, ?, 'draft', ?)")
      .run(owner, title, now);
    const id = Number(info.lastInsertRowid);
    const sentence = db.prepare(
      "INSERT INTO sentence (assignment_id, idx, text_en, text_zh, reference_audio_path) VALUES (?, ?, ?, ?, NULL)",
    );
    for (const [idx, pair] of pairs.entries()) {
      await sentence.run(id, idx, pair.textEn, pair.textZh || null);
    }
    return id;
  });
}

export async function getAssignment(id: number): Promise<AssignmentDetail> {
  const db = await getDb();
  const row = (await db
    .prepare(
      `SELECT a.id, a.class_id, a.title, a.status, a.created_at, a.demo_video_path, c.join_code
       FROM assignment a JOIN class c ON c.id = a.class_id WHERE a.id = ?`,
    )
    .get(id)) as AssignmentRow | undefined;
  if (!row) throw new AppError("找不到作业", 404);
  const sentences = (await db
    .prepare("SELECT * FROM sentence WHERE assignment_id = ? ORDER BY idx, id")
    .all(id)) as SentenceRow[];
  const rawStatus = typeof row.status === "string" ? row.status.trim() : row.status;
  const status = rawStatus === "draft" || rawStatus === "published" || rawStatus === "closed" ? rawStatus : row.status;
  return {
    id: Number(row.id),
    classId: Number(row.class_id),
    title: asText(row.title),
    status,
    createdAt: row.created_at,
    joinCode: row.join_code,
    missingReference: sentences.some((sentence) => !sentence.reference_audio_path),
    hasDemoVideo: Boolean(row.demo_video_path),
    demoVideoUrl: row.demo_video_path ? `/api/video/demo/${row.id}` : null,
    sentences: sentences.map(toSentence),
  };
}

async function draftSentence(sentenceId: number): Promise<SentenceRow> {
  const db = await getDb();
  const row = (await db.prepare("SELECT * FROM sentence WHERE id = ?").get(sentenceId)) as SentenceRow | undefined;
  if (!row) throw new AppError("找不到句子", 404);
  const assignment = (await db.prepare("SELECT status FROM assignment WHERE id = ?").get(row.assignment_id)) as
    | { status: string }
    | undefined;
  if (!assignment) throw new AppError("找不到作业", 404);
  if (assignment.status !== "draft") throw new AppError("发布后不能再改句子");
  return row;
}

async function sentenceList(assignmentId: number): Promise<SentenceDTO[]> {
  const db = await getDb();
  const rows = (await db
    .prepare("SELECT * FROM sentence WHERE assignment_id = ? ORDER BY idx, id")
    .all(assignmentId)) as SentenceRow[];
  return rows.map(toSentence);
}

export async function updateSentence(sentenceId: number, textEn: string, textZh: string): Promise<SentenceDTO[]> {
  const row = await draftSentence(sentenceId);
  const english = textEn.trim();
  if (!english) throw new AppError("英文不能为空");
  if (countWords(english) === 0) throw new AppError("这句里没有英文单词");
  const db = await getDb();
  await db.prepare("UPDATE sentence SET text_en = ?, text_zh = ? WHERE id = ?").run(english, textZh.trim() || null, sentenceId);
  return sentenceList(row.assignment_id);
}

export async function mergeWithNext(sentenceId: number): Promise<SentenceDTO[]> {
  const row = await draftSentence(sentenceId);
  const db = await getDb();
  const next = (await db
    .prepare("SELECT * FROM sentence WHERE assignment_id = ? AND idx = ?")
    .get(row.assignment_id, row.idx + 1)) as SentenceRow | undefined;
  if (!next) throw new AppError("没有下一句可以合并");
  await db.transaction(async () => {
    await db.prepare("UPDATE sentence SET text_en = ?, text_zh = ? WHERE id = ?").run(
      mergeText(row.text_en, next.text_en),
      mergeText(row.text_zh ?? "", next.text_zh ?? "") || null,
      row.id,
    );
    await db.prepare("DELETE FROM sentence WHERE id = ?").run(next.id);
    await reindex(row.assignment_id);
  });
  return sentenceList(row.assignment_id);
}

export async function splitSentence(sentenceId: number): Promise<SentenceDTO[]> {
  const row = await draftSentence(sentenceId);
  const parts = splitOnce(row.text_en);
  if (!parts) throw new AppError("这句太短，没法拆开");
  const gloss = splitChineseOnce(row.text_zh ?? "");
  const db = await getDb();
  await db.transaction(async () => {
    await db.prepare("UPDATE sentence SET idx = idx + 1000 WHERE assignment_id = ? AND idx > ?").run(
      row.assignment_id,
      row.idx,
    );
    await db.prepare("UPDATE sentence SET text_en = ?, text_zh = ? WHERE id = ?").run(parts[0], gloss[0] || null, row.id);
    await db
      .prepare(
        "INSERT INTO sentence (assignment_id, idx, text_en, text_zh, reference_audio_path) VALUES (?, ?, ?, ?, NULL)",
      )
      .run(row.assignment_id, row.idx + 1, parts[1], gloss[1] || null);
    await reindex(row.assignment_id);
  });
  return sentenceList(row.assignment_id);
}

async function reindex(assignmentId: number) {
  const db = await getDb();
  const rows = (await db
    .prepare("SELECT id FROM sentence WHERE assignment_id = ? ORDER BY idx, id")
    .all(assignmentId)) as { id: number }[];
  const update = db.prepare("UPDATE sentence SET idx = ? WHERE id = ?");
  for (const [index, row] of rows.entries()) {
    await update.run(index, row.id);
  }
}

export async function saveDemoVideo(
  assignmentId: number,
  file: { name: string; type: string; bytes: Buffer },
): Promise<void> {
  const detail = await getAssignment(assignmentId);
  if (detail.status !== "draft") throw new AppError("发布后不能再换布置视频");
  const stored = await acceptVideoUpload({
    subdir: `demo/${assignmentId}`,
    filename: file.name || "demo.webm",
    mime: file.type,
    bytes: file.bytes,
    maxBytes: limits.maxDemoVideoBytes,
    maxSeconds: limits.maxDemoVideoSeconds,
    badType: "布置视频只接受 mp4、webm、mov",
    tooBig: "布置视频不能超过 200MB",
    tooLong: "布置视频不能超过 5 分钟",
    unreadable: "读不出视频时长",
    missingFfmpeg: "需要安装 ffmpeg 才能处理布置视频",
  });
  const wavAbsolute = path.join(audioRoot(), "demo", String(assignmentId), `${Date.now()}.wav`);
  let audioRelative: string;
  try {
    audioRelative = await extractWav(stored.absolute, wavAbsolute, 120_000);
  } catch {
    fsUnlink(stored.absolute);
    throw new AppError("抽不出布置视频的音轨");
  }
  const db = await getDb();
  await db
    .prepare("UPDATE assignment SET demo_video_path = ?, demo_audio_path = ? WHERE id = ?")
    .run(stored.relative, audioRelative, assignmentId);
}

export async function saveDemoFromBlob(
  assignmentId: number,
  source: { blobUrl: string; pathname: string },
): Promise<void> {
  const detail = await getAssignment(assignmentId);
  const prefix = `demo/${assignmentId}`;
  if (detail.status !== "draft") {
    if (blobUploadMatches({ blobUrl: source.blobUrl, pathname: source.pathname, prefix })) await removeBlob(source.blobUrl);
    throw new AppError("发布后不能再换布置视频");
  }
  const existing = await demoVideoPath(assignmentId);
  const staged = await stageRemoteVideo({
    blobUrl: source.blobUrl,
    pathname: source.pathname,
    prefix,
    maxBytes: limits.maxDemoVideoBytes,
    maxSeconds: limits.maxDemoVideoSeconds,
    playbackTimeout: 240_000,
    badType: "布置视频只接受 mp4、webm、mov",
    tooBig: "布置视频不能超过 200MB",
    tooLong: "布置视频不能超过 5 分钟",
    unreadable: "读不出视频时长",
    missingFfmpeg: "需要安装 ffmpeg 才能处理布置视频",
  });
  const wavAbsolute = path.join(audioRoot(), "demo", String(assignmentId), `${Date.now()}.wav`);
  let audioRelative: string | null = null;
  let saved = false;
  try {
    try {
      audioRelative = await extractWav(staged.localPath, wavAbsolute, 120_000);
    } catch {
      throw new AppError("抽不出布置视频的音轨");
    }
    const db = await getDb();
    await db
      .prepare("UPDATE assignment SET demo_video_path = ?, demo_audio_path = ? WHERE id = ?")
      .run(staged.playbackUrl, audioRelative, assignmentId);
    saved = true;
    await staged.finish("keep", existing?.path ?? null);
  } catch (error) {
    if (!saved) {
      await staged.finish("discard");
      if (audioRelative) fsUnlink(path.join(audioRoot(), audioRelative));
    }
    throw error;
  }
}

function fsUnlink(file: string) {
  try {
    fs.unlinkSync(file);
  } catch {
    /* rejected demo file is already gone */
  }
}

export async function setReferenceAudio(assignmentId: number, sentenceId: number, relativePath: string) {
  const row = await draftSentence(sentenceId);
  if (row.assignment_id !== assignmentId) throw new AppError("句子不属于这份作业");
  const db = await getDb();
  await db.prepare("UPDATE sentence SET reference_audio_path = ? WHERE id = ?").run(relativePath, sentenceId);
}

async function makeJoinCode(): Promise<string> {
  const db = await getDb();
  for (let attempt = 0; attempt < 20; attempt++) {
    const bytes = randomBytes(6);
    const code = Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
    const taken = await db.prepare("SELECT id FROM class WHERE join_code = ?").get(code);
    if (!taken) return code;
  }
  throw new AppError("班级码暂时生成不了，请再试一次");
}

export async function publishAssignment(id: number): Promise<{ joinCode: string }> {
  const detail = await getAssignment(id);
  if (detail.status !== "draft") throw new AppError("只有草稿可以发布");
  if (detail.sentences.length === 0) throw new AppError("还没有句子");
  if (!detail.hasDemoVideo) throw new AppError("请先上传或录制布置视频");
  for (const sentence of detail.sentences) {
    if (sentence.wordCount === 0) throw new AppError(`第 ${sentence.idx + 1} 句没有英文`);
    if (sentence.tooLong) {
      throw new AppError(`第 ${sentence.idx + 1} 句超过 ${limits.maxWordsPerSentence} 个词，请先拆开`);
    }
  }
  const db = await getDb();
  let joinCode = detail.joinCode;
  if (!joinCode) {
    joinCode = await makeJoinCode();
    await db.prepare("UPDATE class SET join_code = ? WHERE id = ?").run(joinCode, detail.classId);
  }
  await db.prepare("UPDATE assignment SET status = 'published' WHERE id = ?").run(id);
  return { joinCode };
}

export async function closeAssignment(id: number) {
  const detail = await getAssignment(id);
  if (detail.status !== "published") throw new AppError("只有已发布的作业可以结束");
  const db = await getDb();
  await db.prepare("UPDATE assignment SET status = 'closed' WHERE id = ?").run(id);
}

export async function demoVideoPath(assignmentId: number): Promise<{ path: string; classId: number } | null> {
  const db = await getDb();
  const row = (await db
    .prepare("SELECT demo_video_path AS path, class_id AS classId FROM assignment WHERE id = ?")
    .get(assignmentId)) as { path: string | null; classId: number } | undefined;
  if (!row?.path) return null;
  return { path: row.path, classId: row.classId };
}

export async function referenceAudioPath(sentenceId: number): Promise<{ path: string; classId: number } | null> {
  const db = await getDb();
  const row = (await db
    .prepare(
      `SELECT s.reference_audio_path AS path, a.class_id AS classId
       FROM sentence s JOIN assignment a ON a.id = s.assignment_id WHERE s.id = ?`,
    )
    .get(sentenceId)) as { path: string | null; classId: number } | undefined;
  if (!row?.path) return null;
  return { path: row.path, classId: row.classId };
}
