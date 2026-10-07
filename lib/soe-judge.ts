import { limits } from "./config";
import type { WordKind } from "./soe-parse";

const FUNCTION_WORDS = new Set(limits.functionWords);

export type AlignedToken = {
  text: string;
  kind: WordKind;
};

export function isFunctionWord(word: string): boolean {
  return FUNCTION_WORDS.has(word.toLowerCase());
}

export function scalePronAccuracy(value: number | null): number | null {
  if (value == null) return null;
  if (value === -1) return -1;
  if (value > 0 && value <= 1) return Math.round(value * 1000) / 10;
  return value;
}

export function completionPercent(tokenCount: number, missedCount: number): number | null {
  if (tokenCount <= 0) return null;
  const ratio = ((tokenCount - missedCount) / tokenCount) * 100;
  return Math.round(ratio * 10) / 10;
}

export function kindFromWordMode(words: { matchTag: number; pronAccuracy: number | null }[]): WordKind | null {
  const reference = words.find((word) => word.matchTag !== 1);
  if (!reference) return null;
  const score = scalePronAccuracy(reference.pronAccuracy);
  if (reference.matchTag === 2) return "miss";
  if (reference.matchTag === 3 || score === -1) return "wrong";
  if (reference.matchTag === 0 && score != null && score < limits.pronWrongBelow) return "wrong";
  if (reference.matchTag === 0 && (score == null || score >= limits.pronWrongBelow)) return "match";
  return null;
}

export function applyRecheck(
  kind: WordKind,
  words: { matchTag: number; pronAccuracy: number | null }[] | null,
): WordKind {
  if (!words) return kind;
  return kindFromWordMode(words) ?? kind;
}

export function contentRecheckIndexes(tokens: AlignedToken[], limit: number): number[] {
  const indexes: number[] = [];
  tokens.forEach((token, index) => {
    if (indexes.length >= limit) return;
    if (isFunctionWord(token.text)) return;
    if (token.kind === "miss" || token.kind === "wrong") indexes.push(index);
  });
  return indexes;
}

export function reconcileFunctionMisses(tokens: AlignedToken[], asr: { ran: boolean; text: string | null }): WordKind[] {
  const kinds = tokens.map((token) => token.kind);
  if (!asr.ran) return kinds;
  const groups = new Map<string, number[]>();
  tokens.forEach((token, index) => {
    const key = token.text.toLowerCase();
    if (token.kind !== "miss" || !isFunctionWord(key)) return;
    const list = groups.get(key) ?? [];
    list.push(index);
    groups.set(key, list);
  });
  if (asr.text == null) {
    for (const indexes of groups.values()) {
      for (const index of indexes) kinds[index] = "uncertain";
    }
    return kinds;
  }
  const heard = tokenCounts(asr.text);
  for (const [key, indexes] of groups) {
    const total = tokens.filter((token) => token.text.toLowerCase() === key).length;
    const spokenBySoe = total - indexes.length;
    if ((heard.get(key) ?? 0) !== spokenBySoe) {
      for (const index of indexes) kinds[index] = "uncertain";
    }
  }
  return kinds;
}

function tokenCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of text.match(/[A-Za-z]+(?:'[A-Za-z]+)*/g) ?? []) {
    const key = token.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
