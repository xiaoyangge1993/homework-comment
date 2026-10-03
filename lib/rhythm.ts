import { limits } from "./config";
import type { RhythmLabel } from "./types";

export function classifyRhythm(studentSeconds: number, teacherSeconds: number, internalPause: boolean): RhythmLabel | null {
  if (!(studentSeconds > 0) || !(teacherSeconds > 0)) return null;
  if (internalPause) return "停顿偏长";
  const ratio = studentSeconds / teacherSeconds;
  if (ratio < limits.rhythmFastBelow) return "偏快";
  if (ratio > limits.rhythmSlowAbove) return "偏慢";
  return "接近";
}

export function hasInternalPause(log: string, totalSeconds: number): boolean {
  const starts = [...log.matchAll(/silence_start:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
  const ends = [...log.matchAll(/silence_end:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
  return starts.some((start, index) => {
    const end = ends[index];
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    if (start < 0.2) return false;
    if (end > totalSeconds - 0.2) return false;
    return end - start >= limits.pauseSeconds;
  });
}
