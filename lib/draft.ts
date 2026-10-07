import { limits } from "./config";
import type { RhythmLabel } from "./types";

export type DraftSentence = {
  index: number;
  accuracy: number | null;
  evaluated: boolean;
  inaudible: boolean;
  missed: string[];
  wrong: { word: string; phone?: string }[];
  rhythm: RhythmLabel | null;
};

const CN = "零一二三四五六七八九十";

function countLabel(count: number): string {
  if (count >= 0 && count <= 10) return CN[count] ?? String(count);
  if (count < 20) return `十${CN[count - 10]}`;
  return String(count);
}

function joinClauses(parts: string[]): string {
  return parts
    .map((part) => part.replace(/。$/, ""))
    .filter(Boolean)
    .join("。")
    .concat(parts.length ? "。" : "");
}

function listIndexes(indexes: number[]): string {
  const labels = indexes.map((index) => `第 ${index} 句`);
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]}和${labels[1]}`;
  return `${labels.slice(0, -1).join("、")}和${labels[labels.length - 1]}`;
}

function takeWords(sentences: DraftSentence[], pick: (sentence: DraftSentence) => string[], limit: number) {
  const chosen: { index: number; word: string }[] = [];
  for (const sentence of sentences) {
    for (const word of pick(sentence)) {
      if (chosen.length >= limit) return chosen;
      chosen.push({ index: sentence.index, word });
    }
  }
  return chosen;
}

function groupLine(items: { index: number; word: string }[], render: (index: number, words: string[]) => string): string[] {
  const groups = new Map<number, string[]>();
  for (const item of items) {
    const list = groups.get(item.index) ?? [];
    list.push(item.word);
    groups.set(item.index, list);
  }
  return [...groups.entries()].map(([index, words]) => render(index, words));
}

export function buildDraft(sentences: DraftSentence[]): string {
  if (sentences.length === 0) return "";
  let shortest = "";
  const remember = (text: string) => {
    if (text.length <= limits.draftMaxChars) return text;
    if (!shortest || text.length < shortest.length) shortest = text;
    return null;
  };
  const clean =
    sentences.every((sentence) => sentence.evaluated && sentence.accuracy != null && sentence.accuracy >= limits.accuracyPassAt) &&
    sentences.every((sentence) => sentence.missed.length === 0 && sentence.wrong.length === 0) &&
    sentences.every((sentence) => sentence.rhythm !== "偏慢" && sentence.rhythm !== "停顿偏长");
  if (clean) return `${countLabel(sentences.length)}句都读全了，可以过。`;

  let phone = "";
  for (const sentence of sentences) {
    const found = sentence.wrong.find((item) => item.phone);
    if (found?.phone) {
      phone = found.phone;
      break;
    }
  }

  for (let wordLimit = 3; wordLimit >= 0; wordLimit -= 1) {
    for (const includePhone of [Boolean(phone), false]) {
      const missed = groupLine(takeWords(sentences, (sentence) => sentence.missed, wordLimit), (index, words) => {
        return `第 ${index} 句漏了 ${words.join("、")}`;
      });
      const wrong = groupLine(
        takeWords(sentences, (sentence) => sentence.wrong.map((item) => item.word), wordLimit),
        (index, words) => `第 ${index} 句 ${words.join("、")} 读得不准`,
      );
      const pending = sentences
        .filter((sentence) => !sentence.evaluated)
        .map((sentence) =>
          sentence.inaudible ? `第 ${sentence.index} 句听不清，请老师亲听` : `第 ${sentence.index} 句评测未完成，请老师亲听`,
        );
      const slow = sentences.some((sentence) => sentence.rhythm === "偏慢" || sentence.rhythm === "停顿偏长");
      const reread = sentences
        .filter(
          (sentence) =>
            !sentence.evaluated ||
            sentence.missed.length > 0 ||
            sentence.wrong.length > 0 ||
            sentence.rhythm === "偏慢" ||
            sentence.rhythm === "停顿偏长" ||
            (sentence.accuracy != null && sentence.accuracy < limits.accuracyPassAt),
        )
        .map((sentence) => sentence.index);
      const parts = [...pending, ...missed, ...wrong];
      if (includePhone && phone && wrong.length > 0) parts[parts.indexOf(wrong[0])] = `${wrong[0]}（音素 ${phone}）`;
      if (slow) parts.push("跟读时停顿偏长，试着跟上老师的节奏再读一次");
      if (reread.length > 0) parts.push(`请再跟读${listIndexes(reread)}`);
      const text = joinClauses(parts);
      const kept = remember(text);
      if (kept) return kept;
      if (!includePhone) break;
    }
  }
  const clipped = shortest || "请老师亲听。";
  return clipped.length <= limits.draftMaxChars ? clipped : `${clipped.slice(0, limits.draftMaxChars - 1)}。`;
}
