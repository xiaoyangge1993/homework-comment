import "server-only";

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { hasInternalPause } from "./rhythm";
import { decodePcmWav, pcmHasInternalPause } from "./wav";

const exec = promisify(execFile);

const extraPath = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/local/sbin"].join(":");

function candidateBins(name: "ffmpeg" | "ffprobe"): string[] {
  const fromEnv = name === "ffmpeg" ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  const prefixes = ["/opt/homebrew", "/usr/local"];
  const formulas = ["ffmpeg", "ffmpeg@7", "ffmpeg@6", "ffmpeg@5"];
  const kegs = prefixes.flatMap((prefix) => formulas.map((formula) => path.join(prefix, "opt", formula, "bin", name)));
  return [
    fromEnv,
    ...kegs,
    ...prefixes.map((prefix) => path.join(prefix, "bin", name)),
    path.join(process.cwd(), "bin", name),
  ].filter((value): value is string => Boolean(value));
}

export function resolveTool(name: "ffmpeg" | "ffprobe"): string {
  for (const candidate of candidateBins(name)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return name;
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
