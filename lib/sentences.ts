import { limits } from "./config";

const WORD = /[A-Za-z]+(?:'[A-Za-z]+)*/g;

export function englishTokens(text: string): string[] {
  return text.match(WORD) ?? [];
}

export function countWords(text: string): number {
  return englishTokens(text).length;
}

export function tooLong(text: string): boolean {
  return countWords(text) > limits.maxWordsPerSentence;
}

function splitOn(text: string, isBreak: (ch: string) => boolean): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (!isBreak(ch)) continue;
    let end = i + 1;
    while (end < cleaned.length && cleaned[end] === ch) end++;
    const sentence = cleaned.slice(start, end).trim();
    if (sentence) parts.push(sentence);
    start = end;
    i = end - 1;
  }
  const rest = cleaned.slice(start).trim();
  if (rest) parts.push(rest);
  return parts;
}

export function splitEnglish(text: string): string[] {
  return splitOn(text, (ch) => ch === "." || ch === "?" || ch === "!").filter(
    (sentence) => countWords(sentence) > 0,
  );
}

export function splitChinese(text: string): string[] {
  return splitOn(
    text,
    (ch) => ch === "。" || ch === "！" || ch === "？" || ch === "!" || ch === "?",
  );
}

export function pairSentences(english: string, chinese: string): { textEn: string; textZh: string }[] {
  const en = splitEnglish(english);
  const zh = chinese.trim() ? splitChinese(chinese) : [];
  const aligned = zh.length === en.length;
  return en.map((textEn, index) => ({
    textEn,
    textZh: aligned ? zh[index] ?? "" : index === 0 ? chinese.trim() : "",
  }));
}

export function mergeText(left: string, right: string): string {
  return `${left.trim()} ${right.trim()}`.replace(/\s+/g, " ").trim();
}

function splitOnceOn(text: string, isBreak: (ch: string) => boolean, keep: (part: string) => boolean): [string, string] | null {
  const trimmed = text.trim();
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (!isBreak(ch)) continue;
    let end = i + 1;
    while (end < trimmed.length && trimmed[end] === ch) end++;
    const left = trimmed.slice(0, end).trim();
    const right = trimmed.slice(end).trim();
    if (keep(left) && keep(right)) return [left, right];
  }
  return null;
}

export function splitOnce(text: string): [string, string] | null {
  const byPunctuation = splitOnceOn(
    text,
    (ch) => ch === "." || ch === "?" || ch === "!",
    (part) => countWords(part) > 0,
  );
  if (byPunctuation) return byPunctuation;
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const mid = Math.ceil(tokens.length / 2);
  const left = tokens.slice(0, mid).join(" ");
  const right = tokens.slice(mid).join(" ");
  if (countWords(left) === 0 || countWords(right) === 0) return null;
  return [left, right];
}

export function splitChineseOnce(text: string): [string, string] {
  const trimmed = text.trim();
  if (!trimmed) return ["", ""];
  const parts = splitOnceOn(
    trimmed,
    (ch) => ch === "。" || ch === "！" || ch === "？" || ch === "!" || ch === "?",
    (part) => part.length > 0,
  );
  if (parts) return parts;
  return [trimmed, ""];
}
