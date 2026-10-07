import "server-only";

import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { resolveAudio } from "./audio";
import { commandWorks, transcodeWav } from "./media";
import {
  emptyIntonation,
  failed,
  readIntonationOutput,
  type StoredIntonation,
} from "./intonation";
import { decodePcmWav } from "./wav";

const exec = promisify(execFile);
const TIMEOUT_MS = 15_000;

let probe: Promise<boolean> | null = null;

export function parselmouthAvailable(): Promise<boolean> {
  if (!probe) probe = checkParselmouth();
  return probe;
}

export async function measureIntonation(
  studentRelative: string,
  referenceRelative: string | null,
): Promise<StoredIntonation> {
  if (!referenceRelative) {
    return { status: "skipped", teacherFinal: null, studentFinal: null, agreement: null, json: null };
  }
  if (!(await parselmouthAvailable())) return emptyIntonation();
  const studentFile = resolveAudio(studentRelative);
  const teacherFile = resolveAudio(referenceRelative);
  if (!studentFile || !teacherFile) return failed("missing_file");

  let temp: string | null = null;
  try {
    const teacherWav = await ensureTeacherWav(teacherFile);
    temp = teacherWav.temp;
    const { stdout } = await exec(python(), [scriptPath(), studentFile, teacherWav.path], {
      timeout: TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONWARNINGS: "ignore" },
    });
    return readIntonationOutput(stdout);
  } catch {
    return failed("failed");
  } finally {
    removeTemp(temp);
  }
}

async function checkParselmouth(): Promise<boolean> {
  try {
    const { stdout } = await exec(python(), [scriptPath(), "--check"], {
      timeout: 8000,
      env: { ...process.env, PYTHONWARNINGS: "ignore" },
    });
    const parsed = JSON.parse(stdout) as { available?: boolean };
    return parsed.available === true;
  } catch {
    return false;
  }
}

function python(): string {
  return "python3";
}

function scriptPath(): string {
  return path.join(process.cwd(), "scripts", "intonation.py");
}

async function ensureTeacherWav(file: string): Promise<{ path: string; temp: string | null }> {
  if (isPcm16kMono(file)) return { path: file, temp: null };
  if (!(await commandWorks("ffmpeg"))) throw new Error("ffmpeg");
  const temp = path.join(
    os.tmpdir(),
    `homework-intonation-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`,
  );
  await transcodeWav(file, temp, TIMEOUT_MS);
  return { path: temp, temp };
}

function isPcm16kMono(file: string): boolean {
  try {
    const decoded = decodePcmWav(fs.readFileSync(file));
    return Boolean(decoded && decoded.sampleRate === 16000 && decoded.channels === 1);
  } catch {
    return false;
  }
}

function removeTemp(file: string | null) {
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch {
    /* The temp wav is already gone. */
  }
}
