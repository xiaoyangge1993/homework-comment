import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyRecheck,
  completionPercent,
  contentRecheckIndexes,
  kindFromWordMode,
  lexiconText,
  reconcileContentMisses,
  reconcileFunctionMisses,
  scalePronAccuracy,
  wordKey,
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
    assert.equal(applyRecheck("wrong", [{ matchTag: 2, pronAccuracy: 0 }]), "wrong");
    assert.equal(applyRecheck("miss", [{ matchTag: 0, pronAccuracy: 8.43 }]), "miss");
    assert.equal(applyRecheck("miss", [{ matchTag: 0, pronAccuracy: 0.97 }]), "match");
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

describe("spelling and content misses", () => {
  const colour: AlignedToken[] = [
    { text: "My", kind: "match" },
    { text: "favourite", kind: "miss" },
    { text: "colour", kind: "match" },
    { text: "is", kind: "match" },
    { text: "blue", kind: "match" },
  ];

  it("sends the lexicon spelling and keeps the textbook letters' case", () => {
    assert.equal(wordKey("Favourite"), "favorite");
    assert.equal(wordKey("color"), "color");
    assert.equal(lexiconText("My favourite colour is blue."), "My favorite color is blue.");
    assert.equal(lexiconText("The pandas are black and white."), "The pandas are black and white.");
  });

  it("clears a content miss when recognition heard the other spelling", () => {
    const kinds = reconcileContentMisses(colour, { ran: true, text: "My favorite color is blue." });
    assert.deepEqual(kinds, ["match", "match", "match", "match", "match"]);
  });

  it("keeps the miss when recognition also lacks the word", () => {
    const kinds = reconcileContentMisses(colour, { ran: true, text: "My color is blue." });
    assert.equal(kinds[1], "miss");
  });

  it("clears only as many copies as recognition heard", () => {
    const tokens: AlignedToken[] = [
      { text: "favourite", kind: "miss" },
      { text: "and", kind: "match" },
      { text: "favourite", kind: "miss" },
    ];
    const kinds = reconcileContentMisses(tokens, { ran: true, text: "favorite and" });
    assert.deepEqual(kinds, ["match", "match", "miss"]);
  });

  it("leaves content misses unchanged when recognition fails", () => {
    const kinds = reconcileContentMisses(colour, { ran: true, text: null });
    assert.equal(kinds[1], "miss");
    assert.equal(reconcileContentMisses(colour, { ran: false, text: "favorite" })[1], "miss");
  });
});
