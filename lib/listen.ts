import { limits } from "./config";
import type { RhythmLabel, SubmissionStatus } from "./types";

export type ListenSentence = {
  accuracy: number | null;
  fluency: number | null;
  completion: number | null;
  rhythm: RhythmLabel | null;
  missed: boolean;
  wrong: boolean;
  uncertain: boolean;
};

export type BoardGroup = "listen" | "pass" | "partial" | "returned" | "accepted";

const GROUP_ORDER: Record<BoardGroup, number> = {
  listen: 0,
  pass: 1,
  partial: 2,
  returned: 3,
  accepted: 4,
};

export const groupLabel: Record<BoardGroup, string> = {
  listen: "建议亲听",
  pass: "可一键通过",
  partial: "未交齐",
  returned: "待重录",
  accepted: "已通过",
};

export function sentenceNeedsListen(sentence: ListenSentence): boolean {
  if (sentence.accuracy == null || sentence.completion == null) return true;
  if (sentence.accuracy < limits.accuracyListenBelow) return true;
  if (sentence.completion < limits.completionListenBelow) return true;
  if (sentence.missed || sentence.wrong || sentence.uncertain) return true;
  if (sentence.rhythm != null && sentence.rhythm !== "接近") return true;
  return false;
}

export function boardGroup(status: SubmissionStatus, sentences: ListenSentence[]): BoardGroup {
  if (status === "accepted") return "accepted";
  if (status === "returned") return "returned";
  if (status === "partial") return "partial";
  if (sentences.length === 0 || sentences.some(sentenceNeedsListen)) return "listen";
  return "pass";
}

export function displayAverage(values: (number | null)[]): string {
  if (values.length === 0 || values.some((value) => value == null)) return "待人工";
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return String(Math.round(total / values.length));
}

export function rhythmSummary(rhythms: (RhythmLabel | null)[]): string {
  if (rhythms.some((rhythm) => rhythm === "停顿偏长")) return "停顿偏长";
  if (rhythms.some((rhythm) => rhythm === "偏慢")) return "偏慢";
  if (rhythms.some((rhythm) => rhythm === "偏快")) return "偏快";
  if (rhythms.some((rhythm) => rhythm === "接近")) return "接近";
  return "—";
}

export function compareBoard<T extends { group: BoardGroup; accuracy: number | null; name: string }>(left: T, right: T): number {
  const grouped = GROUP_ORDER[left.group] - GROUP_ORDER[right.group];
  if (grouped !== 0) return grouped;
  if (left.group === "listen") return (left.accuracy ?? -1) - (right.accuracy ?? -1);
  return left.name.localeCompare(right.name, "zh");
}
