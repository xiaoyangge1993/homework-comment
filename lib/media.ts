import "server-only";

import { execFile } from "child_process";
import { promisify } from "util";
import { hasInternalPause } from "./rhythm";

const exec = promisify(execFile);

export async function commandWorks(command: string): Promise<boolean> {
  try {
    await exec(command, ["-version"], { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

export async function transcodeWav(input: string, output: string): Promise<void> {
  await exec("ffmpeg", ["-y", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", output], {
    timeout: 30000,
  });
}

export async function durationSeconds(file: string): Promise<number | null> {
  try {
    const { stdout } = await exec(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
      { timeout: 15000 },
    );
    const value = Number(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function detectInternalPause(file: string, totalSeconds: number): Promise<boolean> {
  try {
    const { stderr } = await exec("ffmpeg", ["-i", file, "-af", "silencedetect=noise=-35dB:d=0.8", "-f", "null", "-"], {
      timeout: 20000,
    });
    return hasInternalPause(stderr, totalSeconds);
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    return hasInternalPause(stderr, totalSeconds);
  }
}
