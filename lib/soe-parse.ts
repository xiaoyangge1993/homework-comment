export type PhoneScore = { phone: string; accuracy: number | null };

export type ParsedWord = {
  word: string;
  matchTag: number;
  accuracy: number | null;
  phones: PhoneScore[];
};

export type ParsedScores = {
  ok: boolean;
  error?: string;
  accuracy: number | null;
  fluency: number | null;
  completion: number | null;
  words: ParsedWord[];
};

export type TextMark = { text: string; kind: "plain" | "match" | "miss" | "wrong" | "oov" };

const WORD = /[A-Za-z]+(?:'[A-Za-z]+)*/g;

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function accuracyPercent(value: unknown): number | null {
  const number = asNumber(value);
  if (number == null || number < 0) return null;
  return Math.round(number * 10) / 10;
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

function readWords(result: Record<string, unknown>): ParsedWord[] {
  const source = (Array.isArray(result.Words) ? result.Words : result.words) as unknown[] | undefined;
  if (!source) return [];
  return source.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const word = item as Record<string, unknown>;
    const text = String(word.Word ?? word.word ?? word.ReferenceWord ?? "").replace(/_\d+$/, "");
    if (!text) return [];
    const tag = asNumber(word.MatchTag ?? word.Tag);
    const phones = Array.isArray(word.PhoneInfos)
      ? word.PhoneInfos.flatMap((phone) => {
          if (!phone || typeof phone !== "object") return [];
          const row = phone as Record<string, unknown>;
          const symbol = String(row.Phone ?? row.phone ?? "");
          if (!symbol) return [];
          return [{ phone: symbol, accuracy: accuracyPercent(row.PronAccuracy) }];
        })
      : [];
    return [{ word: text, matchTag: tag ?? 0, accuracy: accuracyPercent(word.PronAccuracy), phones }];
  });
}

export function parseEvaluation(payload: unknown): ParsedScores {
  const result = findResult(payload);
  if (!result) return { ok: false, error: "评测结果无效", accuracy: null, fluency: null, completion: null, words: [] };
  const words = readWords(result);
  const accuracy = accuracyPercent(result.PronAccuracy);
  const fluency = ratioPercent(result.PronFluency);
  const completion = ratioPercent(result.PronCompletion);
  if (accuracy == null) {
    return { ok: false, error: "评测结果无效", accuracy: null, fluency: null, completion: null, words };
  }
  return { ok: true, accuracy, fluency, completion, words };
}

export function wordsOf(rawJson: string | null): ParsedWord[] {
  if (!rawJson) return [];
  try {
    return parseEvaluation(JSON.parse(rawJson)).words;
  } catch {
    return [];
  }
}

export function presentSentence(text: string, rawJson: string | null): { marks: TextMark[]; extras: string[] } {
  const tokens = text.split(/([A-Za-z]+(?:'[A-Za-z]+)*)/);
  const parsed = wordsOf(rawJson);
  const extras = parsed.filter((word) => word.matchTag === 1).map((word) => word.word);
  const aligned = parsed.filter((word) => word.matchTag !== 1);
  const textWords = text.match(WORD) ?? [];
  if (aligned.length === 0 || aligned.length !== textWords.length) {
    return { marks: [{ text, kind: "plain" }], extras };
  }
  let cursor = 0;
  const marks = tokens.map((token) => {
    if (!/^[A-Za-z]+(?:'[A-Za-z]+)*$/.test(token)) return { text: token, kind: "plain" as const };
    const word = aligned[cursor];
    cursor += 1;
    const kind: TextMark["kind"] =
      word?.matchTag === 2 ? "miss" : word?.matchTag === 3 ? "wrong" : word?.matchTag === 4 ? "oov" : "match";
    return { text: token, kind };
  });
  return { marks, extras };
}
