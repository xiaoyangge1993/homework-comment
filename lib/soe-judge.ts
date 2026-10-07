import { limits } from "./config";
import type { WordKind } from "./soe-parse";

const FUNCTION_WORDS = new Set(limits.functionWords);

// 智聆 16k_en 词库用美式拼写。课文里的英式拼写要先换成词库形式，识别对照也按同一组算。
const LEXICON_PAIRS: [string, string][] = [
  ["favorite", "favourite"],
  ["color", "colour"],
  ["gray", "grey"],
  ["center", "centre"],
  ["meter", "metre"],
  ["theater", "theatre"],
  ["mom", "mum"],
  ["practice", "practise"],
  ["dialog", "dialogue"],
  ["defense", "defence"],
  ["license", "licence"],
];

const TO_LEXICON = new Map<string, string>();
for (const [lexicon, textbook] of LEXICON_PAIRS) {
  TO_LEXICON.set(lexicon, lexicon);
  TO_LEXICON.set(textbook, lexicon);
}

export type AlignedToken = {
  text: string;
  kind: WordKind;
};

export function isFunctionWord(word: string): boolean {
  return FUNCTION_WORDS.has(word.toLowerCase());
}

export function wordKey(word: string): string {
  const lower = word.toLowerCase();
  return TO_LEXICON.get(lower) ?? lower;
}

export function lexiconText(text: string): string {
  return text.replace(/[A-Za-z]+(?:'[A-Za-z]+)*/g, (token) => {
    const key = wordKey(token);
    if (key === token.toLowerCase()) return token;
    const cased = token[0] === token[0].toUpperCase() ? key[0].toUpperCase() + key.slice(1) : key;
    return cased;
  });
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
  const next = kindFromWordMode(words);
  // 整句音频拿去按单词评时，对齐经常落在别的词上。漏读只能被明确的命中取消，不能改成错读。
  if (!next || next === "miss") return kind;
  if (kind === "miss" && next !== "match") return kind;
  return next;
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

export function reconcileContentMisses(tokens: AlignedToken[], asr: { ran: boolean; text: string | null }): WordKind[] {
  const kinds = tokens.map((token) => token.kind);
  if (!asr.ran || asr.text == null) return kinds;
  const heard = tokenCounts(asr.text, wordKey);
  const groups = new Map<string, number[]>();
  tokens.forEach((token, index) => {
    if (token.kind !== "miss" || isFunctionWord(token.text)) return;
    const key = wordKey(token.text);
    const list = groups.get(key) ?? [];
    list.push(index);
    groups.set(key, list);
  });
  for (const [key, indexes] of groups) {
    const total = tokens.filter((token) => wordKey(token.text) === key).length;
    const spokenBySoe = total - indexes.length;
    const rescue = Math.min(indexes.length, Math.max(0, (heard.get(key) ?? 0) - spokenBySoe));
    for (let i = 0; i < rescue; i++) kinds[indexes[i]] = "match";
  }
  return kinds;
}

function tokenCounts(text: string, keyOf: (word: string) => string = (word) => word.toLowerCase()): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of text.match(/[A-Za-z]+(?:'[A-Za-z]+)*/g) ?? []) {
    const key = keyOf(token);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
