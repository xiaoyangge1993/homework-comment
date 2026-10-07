import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyRecheck,
  completionPercent,
  contentRecheckIndexes,
  kindFromWordMode,
  reconcileFunctionMisses,
  scalePronAccuracy,
  type AlignedToken,
} from "./soe-judge";

const sentence: AlignedToken[] = [
  { text: "The", kind: "miss" },
  { text: "pandas", kind: "wrong" },
  { text: "are", kind: "match" },
  { text: "black", kind: "match" },
  { text: "and", kind: "miss" },
  { text: "white", kind: "match" },
];

describe("reconcileFunctionMisses", () => {
  it("confirms a function word only when both sides omit it", () => {
    const kinds = reconcileFunctionMisses(sentence, { ran: true, text: "pandas are black white" });
    assert.equal(kinds[0], "miss");
    assert.equal(kinds[4], "miss");
    assert.equal(kinds[1], "wrong");
  });

  it("marks a function word uncertain when recognition still heard it", () => {
    const kinds = reconcileFunctionMisses(sentence, { ran: true, text: "the pandas are black and white" });
    assert.equal(kinds[0], "uncertain");
    assert.equal(kinds[4], "uncertain");
  });

  it("marks every disputed copy uncertain when the counts do not agree", () => {
    const tokens: AlignedToken[] = [
      { text: "The", kind: "miss" },
      { text: "cat", kind: "match" },
      { text: "and", kind: "match" },
      { text: "the", kind: "miss" },
      { text: "dog", kind: "match" },
    ];
    const kinds = reconcileFunctionMisses(tokens, { ran: true, text: "the cat and dog" });
    assert.deepEqual(kinds, ["uncertain", "match", "match", "uncertain", "match"]);
  });

  it("keeps the sentence decision when recognition was not run", () => {
    const kinds = reconcileFunctionMisses(sentence, { ran: false, text: null });
    assert.equal(kinds[0], "miss");
  });

  it("marks disputed function words uncertain when recognition fails", () => {
    const kinds = reconcileFunctionMisses(sentence, { ran: true, text: null });
    assert.equal(kinds[0], "uncertain");
    assert.equal(kinds[4], "uncertain");
    assert.equal(kinds[1], "wrong");
  });
});

describe("word recheck", () => {
  it("clears a content word when word mode hears it clearly", () => {
    assert.equal(scalePronAccuracy(0.97), 97);
    assert.equal(scalePronAccuracy(-1), -1);
    assert.equal(applyRecheck("wrong", [{ matchTag: 0, pronAccuracy: 0.97 }]), "match");
    assert.equal(applyRecheck("miss", [{ matchTag: 2, pronAccuracy: 0 }]), "miss");
    assert.equal(applyRecheck("wrong", [{ matchTag: 0, pronAccuracy: -1 }]), "wrong");
    assert.equal(applyRecheck("wrong", null), "wrong");
    assert.equal(kindFromWordMode([{ matchTag: 1, pronAccuracy: -1 }]), null);
  });

  it("rechecks content words and skips function words", () => {
    const indexes = contentRecheckIndexes(
      [
        ...sentence,
        { text: "bamboo", kind: "miss" },
        { text: "soft", kind: "match" },
      ],
      8,
    );
    assert.deepEqual(indexes, [1, 6]);
  });

  it("counts confirmed misses against the textbook length", () => {
    assert.equal(completionPercent(4, 1), 75);
    assert.equal(completionPercent(3, 0), 100);
    assert.equal(completionPercent(0, 0), null);
  });
});
