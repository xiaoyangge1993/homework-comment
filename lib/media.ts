import "server-only";

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { readEnv } from "./env";
import { prepareExecutable, resolveBinary } from "./ffmpeg-bin";
import { hasInternalPause } from "./rhythm";
import { decodePcmWav, pcmHasInternalPause } from "./wav";

const exec = promisify(execFile);

const extraPath = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/local/sbin"].join(":");
const executableTmp = path.join("/tmp", "homework-comment-bin");
const resolvedTools = new Map<"ffmpeg" | "ffprobe", string>();

function bundledFfmpeg(): string {
  // Path only. Requiring the package would pull the binary into every server trace.
  return path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");
}

function canExecute(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveTool(name: "ffmpeg" | "ffprobe"): string {
  const cached = resolvedTools.get(name);
  if (cached) return cached;
  const picked = resolveBinary({
    envPath: name === "ffmpeg" ? readEnv("FFMPEG_PATH") : readEnv("FFPROBE_PATH"),
    cwd: process.cwd(),
    name,
    staticPath: name === "ffmpeg" ? bundledFfmpeg() : null,
    exists: (file) => fs.existsSync(file),
  });
  const ready =
    name === "ffmpeg"
      ? prepareExecutable(picked, {
          canExecute,
          exists: (file) => fs.existsSync(file),
          copy: (from, to) => {
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.copyFileSync(from, to);
          },
          chmod: (file) => fs.chmodSync(file, 0o755),
          tmpDir: executableTmp,
        })
      : picked;
  resolvedTools.set(name, ready);
  return ready;
}

function commandEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${extraPath}:${process.env.PATH ?? ""}` };
}

export async function commandWorks(command: "ffmpeg" | "ffprobe"): Promise<boolean> {
  try {
    await exec(resolveTool(command), ["-version"], { timeout: 8000, env: commandEnv() });
    return true;
  } catch {
    return false;
  }
}

export async function transcodeWav(input: string, output: string, timeout = 30000): Promise<void> {
  await exec(
    resolveTool("ffmpeg"),
    ["-y", "-i", input, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", output],
    { timeout, env: commandEnv() },
  );
}

export async function durationSeconds(file: string): Promise<number | null> {
  if (await commandWorks("ffprobe")) {
    try {
      const { stdout } = await exec(
        resolveTool("ffprobe"),
        ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
        { timeout: 15000, env: commandEnv() },
      );
      const value = Number(stdout.trim());
      if (Number.isFinite(value) && value > 0) return value;
    } catch {
      /* try ffmpeg, then the wav header */
    }
  }
  const fromFfmpeg = await ffmpegDuration(file);
  if (fromFfmpeg) return fromFfmpeg;
  return wavDuration(file);
}

async function ffmpegDuration(file: string): Promise<number | null> {
  if (!(await commandWorks("ffmpeg"))) return null;
  try {
    const { stderr } = await exec(resolveTool("ffmpeg"), ["-i", file, "-f", "null", "-"], {
      timeout: 15000,
      env: commandEnv(),
    });
    return durationFromFfmpegLog(stderr);
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    return durationFromFfmpegLog(stderr);
  }
}

function durationFromFfmpegLog(log: string): number | null {
  const match = log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function wavDuration(file: string): number | null {
  try {
    const decoded = decodePcmWav(fs.readFileSync(file));
    if (!decoded) return null;
    const seconds = decoded.samples.length / decoded.sampleRate;
    return seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

export async function detectInternalPause(file: string, totalSeconds: number): Promise<boolean> {
  if (await commandWorks("ffmpeg")) {
    try {
      const { stderr } = await exec(
        resolveTool("ffmpeg"),
        ["-i", file, "-af", "silencedetect=noise=-35dB:d=0.8", "-f", "null", "-"],
        { timeout: 20000, env: commandEnv() },
      );
      return hasInternalPause(stderr, totalSeconds);
    } catch (error) {
      const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
      if (stderr.includes("silence_")) return hasInternalPause(stderr, totalSeconds);
    }
  }
  try {
    const decoded = decodePcmWav(fs.readFileSync(file));
    if (!decoded) return false;
    return pcmHasInternalPause(decoded.samples, decoded.sampleRate);
  } catch {
    return false;
  }
}
