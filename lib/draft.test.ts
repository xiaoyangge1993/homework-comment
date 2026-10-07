import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDraft, type DraftSentence } from "./draft";

function good(index: number): DraftSentence {
  return { index, accuracy: 92, evaluated: true, inaudible: false, missed: [], wrong: [], rhythm: "接近" };
}

describe("buildDraft", () => {
  it("uses the pass line for three clean sentences", () => {
    assert.equal(buildDraft([good(1), good(2), good(3)]), "三句都读全了，可以过。");
  });

  it("names at most three missed or wrong words and asks for a reread", () => {
    const text = buildDraft([
      good(1),
      { ...good(2), missed: ["cute", "small", "soft", "little"] },
      { ...good(3), wrong: [{ word: "bamboo", phone: "b" }] },
    ]);
    assert.match(text, /第 2 句漏了 cute、small、soft/);
    assert.doesNotMatch(text, /little/);
    assert.match(text, /第 3 句 bamboo 读得不准（音素 b）/);
    assert.match(text, /请再跟读第 2 句和第 3 句/);
    assert.ok(text.length <= 80);
  });

  it("adds the rhythm line and does not use the pass template", () => {
    const text = buildDraft([{ ...good(1), rhythm: "停顿偏长" }, good(2)]);
    assert.match(text, /跟读时停顿偏长，试着跟上老师的节奏再读一次/);
    assert.doesNotMatch(text, /可以过/);
  });

  it("asks the teacher to listen when the recording is too quiet", () => {
    const text = buildDraft([{ ...good(1), accuracy: null, evaluated: false, inaudible: true }]);
    assert.match(text, /第 1 句听不清，请老师亲听/);
    assert.doesNotMatch(text, /漏了/);
  });

  it("does not invent a score when evaluation is missing", () => {
    const text = buildDraft([{ ...good(1), accuracy: null, evaluated: false }]);
    assert.match(text, /第 1 句评测未完成，请老师亲听/);
    assert.doesNotMatch(text, /\d{2,}/);
  });

  it("stays within 80 characters", () => {
    const sentences = Array.from({ length: 8 }, (_, index) => ({ ...good(index + 1), accuracy: null, evaluated: false }));
    const text = buildDraft(sentences);
    assert.ok(text.length <= 80);
    assert.ok(text.endsWith("。"));
  });
});
