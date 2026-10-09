import "server-only";

import fs from "fs";
import os from "os";
import path from "path";
import { resolveAudio } from "./audio";
import { openReferenceFile } from "./reference-file";
import { commandWorks, transcodeWav } from "./media";
import { failed, skippedIntonation, type StoredIntonation } from "./intonation";
import { compareIntonation, INTONATION_BUDGET_MS } from "./intonation-pitch";
import { decodePcmWav } from "./wav";

const TRANSCODE_MS = 15_000;

export async function measureIntonation(
  studentRelative: string,
  referenceRelative: string | null,
): Promise<StoredIntonation> {
  if (!referenceRelative) return skippedIntonation();
  const studentFile = resolveAudio(studentRelative);
  const teacher = await openReferenceFile(referenceRelative);
  if (!studentFile || !teacher.absolute) {
    teacher.close();
    return failed("missing_file");
  }

  let temp: string | null = null;
  try {
    const teacherWav = await ensureTeacherWav(teacher.absolute);
    temp = teacherWav.temp;
    const student = read16k(studentFile);
    const reference = read16k(teacherWav.path);
    if (!student || !reference) return failed("bad_wav");
    return compareIntonation(student, reference, Date.now() + INTONATION_BUDGET_MS);
  } catch {
    return failed("failed");
  } finally {
    removeTemp(temp);
    teacher.close();
  }
}

async function ensureTeacherWav(file: string): Promise<{ path: string; temp: string | null }> {
  if (isPcm16kMono(file)) return { path: file, temp: null };
  if (!(await commandWorks("ffmpeg"))) throw new Error("ffmpeg");
  const temp = path.join(
    os.tmpdir(),
    `homework-intonation-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`,
  );
  await transcodeWav(file, temp, TRANSCODE_MS);
  return { path: temp, temp };
}

function read16k(file: string): Int16Array | null {
  try {
    const decoded = decodePcmWav(fs.readFileSync(file));
    if (!decoded || decoded.sampleRate !== 16000 || decoded.channels !== 1) return null;
    return decoded.samples;
  } catch {
    return null;
  }
}

function isPcm16kMono(file: string): boolean {
  return read16k(file) != null;
}

function removeTemp(file: string | null) {
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch {
    /* The temp wav is already gone. */
  }
}
