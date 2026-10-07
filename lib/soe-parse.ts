import { limits } from "./config";
import { englishTokens } from "./sentences";

export type PhoneScore = { phone: string; accuracy: number | null };

export type WordKind = "match" | "miss" | "wrong" | "uncertain" | "extra" | "ignore";

export type ParsedWord = {
  word: string;
  matchTag: number;
  accuracy: number | null;
  pronAccuracy: number | null;
  phones: PhoneScore[];
  beginMs: number | null;
  endMs: number | null;
  kind: WordKind;
};

export type StoredWord = {
  word: string;
  kind: WordKind;
  beginMs?: number | null;
  endMs?: number | null;
  phone?: string;
};

export type ParsedScores = {
  ok: boolean;
  error?: string;
  accuracy: number | null;
  fluency: number | null;
  completion: number | null;
  words: ParsedWord[];
};

export type TextMark = {
  text: string;
  kind: "plain" | "match" | "miss" | "wrong" | "uncertain" | "oov";
  beginMs?: number | null;
  endMs?: number | null;
};

const WORD_SPLIT = /([A-Za-z]+(?:'[A-Za-z]+)*)/;
const WORD_TOKEN = /^[A-Za-z]+(?:'[A-Za-z]+)*$/;
const KINDS = new Set<WordKind>(["match", "miss", "wrong", "uncertain", "extra", "ignore"]);

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function accuracyPercent(value: unknown): number | null {
  const number = asNumber(value);
  if (number == null || number < 0) return null;
  return Math.round(number * 10) / 10;
}

function pronRaw(value: unknown): number | null {
  return asNumber(value);
}

export function preliminaryKind(matchTag: number, pronAccuracy: number | null): WordKind {
  if (matchTag === 1) return "extra";
  if (matchTag === 4) return "ignore";
  if (matchTag === 2) return "miss";
  if (matchTag === 3) return "wrong";
  if (pronAccuracy === -1) return "wrong";
  if (matchTag === 0 && pronAccuracy != null && pronAccuracy < limits.pronWrongBelow) return "wrong";
  return "match";
}

function ratioPercent(value: unknown): number | null {
  const number = asNumber(value);
  if (number == null || number < 0) return null;
  const scaled = number <= 1 ? number * 100 : number;
  return Math.round(scaled * 10) / 10;
}

function findResult(input: unknown): Record<string, unknown> | null {
  const seen = new Set<unknown>();
  let current: unknown = input;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (Array.isArray(record.Words) || Array.isArray(record.words) || typeof record.PronAccuracy === "number") {
      return record;
    }
    if (typeof record.result === "string") {
      try {
        current = JSON.parse(record.result);
        continue;
      } catch {
        return null;
      }
    }
    if (record.result && typeof record.result === "object") {
      current = record.result;
      continue;
    }
    return null;
  }
  return null;
}

function wordTime(word: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (!(key in word)) continue;
    const number = asNumber(word[key]);
    if (number == null || number < 0) return null;
    return number;
  }
  return null;
}

function readWords(result: Record<string, unknown>): ParsedWord[] {
  const source = (Array.isArray(result.Words) ? result.Words : result.words) as unknown[] | undefined;
  if (!source) return [];
  return source.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const word = item as Record<string, unknown>;
    const text = String(word.Word ?? word.word ?? word.ReferenceWord ?? "").replace(/_\d+$/, "");
    if (!text) return [];
    const tag = asNumber(word.MatchTag ?? word.Tag) ?? 0;
    const pronAccuracy = pronRaw(word.PronAccuracy);
    const phoneSource = Array.isArray(word.PhoneInfos) ? word.PhoneInfos : Array.isArray(word.PhoneInfo) ? word.PhoneInfo : [];
    const phones = phoneSource.flatMap((phone) => {
      if (!phone || typeof phone !== "object") return [];
      const row = phone as Record<string, unknown>;
      const symbol = String(row.Phone ?? row.phone ?? "");
      if (!symbol) return [];
      return [{ phone: symbol, accuracy: accuracyPercent(row.PronAccuracy) }];
    });
    return [{
      word: text,
      matchTag: tag,
      accuracy: accuracyPercent(word.PronAccuracy),
      pronAccuracy,
      phones,
      beginMs: wordTime(word, ["MemBeginTime", "BeginTime", "Mbtm"]),
      endMs: wordTime(word, ["MemEndTime", "EndTime", "Metm"]),
      kind: preliminaryKind(tag, pronAccuracy),
    }];
  });
}

export function parseEvaluation(payload: unknown): ParsedScores {
  const preset =
    payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : null;
  const result = findResult(payload);
  if (!result) return { ok: false, error: preset ?? "评测结果无效", accuracy: null, fluency: null, completion: null, words: [] };
  const words = readWords(result);
  const accuracy = accuracyPercent(result.PronAccuracy);
  const fluency = ratioPercent(result.PronFluency);
  const completion = ratioPercent(result.PronCompletion);
  if (accuracy == null) {
    return { ok: false, error: preset ?? "评测结果无效", accuracy: null, fluency: null, completion: null, words };
  }
  return { ok: true, accuracy, fluency, completion, words };
}

export function storedError(rawJson: string | null): string | null {
  if (!rawJson) return null;
  try {
    const payload = JSON.parse(rawJson) as { error?: unknown };
    return typeof payload.error === "string" && payload.error ? payload.error : null;
  } catch {
    return null;
  }
}

export function storedHeardText(rawJson: string | null): string | null {
  if (!rawJson) return null;
  try {
    const payload = JSON.parse(rawJson) as { asrText?: unknown; asr?: unknown };
    const direct = heardString(payload.asrText);
    if (direct) return direct;
    const asr = payload.asr;
    if (!asr || typeof asr !== "object") return null;
    const response = (asr as { Response?: { Result?: unknown } }).Response;
    return heardString(response?.Result);
  } catch {
    return null;
  }
}

function heardString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function wordsOf(rawJson: string | null): ParsedWord[] {
  if (!rawJson) return [];
  try {
    return wordsFromPayload(JSON.parse(rawJson));
  } catch {
    return [];
  }
}

function wordsFromPayload(payload: unknown): ParsedWord[] {
  if (!payload || typeof payload !== "object") return parseEvaluation(payload).words;
  const record = payload as Record<string, unknown>;
  const judgment = record.judgment;
  if (judgment && typeof judgment === "object") {
    const stored = judgment as { words?: unknown; extras?: unknown };
    const words = Array.isArray(stored.words) ? stored.words.flatMap(storedWord) : [];
    const extras = Array.isArray(stored.extras) ? stored.extras.flatMap(extraWord) : [];
    return [...words, ...extras];
  }
  const source = "sentence" in record ? record.sentence : payload;
  return parseEvaluation(source).words;
}

function storedWord(item: unknown): ParsedWord[] {
  if (!item || typeof item !== "object") return [];
  const row = item as Record<string, unknown>;
  const word = String(row.word ?? "");
  if (!word) return [];
  const kind = asKind(row.kind);
  const phone = typeof row.phone === "string" && row.phone ? row.phone : "";
  return [{
    word,
    matchTag: tagForKind(kind),
    accuracy: null,
    pronAccuracy: null,
    phones: phone ? [{ phone, accuracy: null }] : [],
    beginMs: asNumber(row.beginMs),
    endMs: asNumber(row.endMs),
    kind,
  }];
}

function extraWord(item: unknown): ParsedWord[] {
  const word = String(item ?? "");
  if (!word) return [];
  return [{ word, matchTag: 1, accuracy: null, pronAccuracy: null, phones: [], beginMs: null, endMs: null, kind: "extra" }];
}

function asKind(value: unknown): WordKind {
  return typeof value === "string" && KINDS.has(value as WordKind) ? (value as WordKind) : "match";
}

function tagForKind(kind: WordKind): number {
  if (kind === "extra") return 1;
  if (kind === "miss") return 2;
  if (kind === "wrong") return 3;
  if (kind === "ignore") return 4;
  return 0;
}

function markKind(kind: WordKind): TextMark["kind"] {
  if (kind === "miss") return "miss";
  if (kind === "wrong") return "wrong";
  if (kind === "uncertain") return "uncertain";
  return "match";
}

export function presentSentence(text: string, rawJson: string | null): { marks: TextMark[]; extras: string[]; uncertain: string[] } {
  const tokens = text.split(WORD_SPLIT);
  const parsed = wordsOf(rawJson);
  const extras = parsed.filter((word) => word.kind === "extra").map((word) => word.word);
  const uncertain = parsed.filter((word) => word.kind === "uncertain").map((word) => word.word);
  const aligned = parsed.filter((word) => word.kind !== "extra");
  const textWords = englishTokens(text);
  if (aligned.length === 0 || aligned.length !== textWords.length) {
    return { marks: [{ text, kind: "plain" }], extras, uncertain: [] };
  }
  let cursor = 0;
  const marks = tokens.map((token) => {
    if (!WORD_TOKEN.test(token)) return { text: token, kind: "plain" as const };
    const word = aligned[cursor];
    cursor += 1;
    return { text: token, kind: markKind(word?.kind ?? "match"), beginMs: word?.beginMs ?? null, endMs: word?.endMs ?? null };
  });
  return { marks, extras, uncertain };
}
