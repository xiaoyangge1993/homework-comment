import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countWords, pairSentences, splitEnglish, splitOnce, tooLong } from "./sentences";

describe("splitEnglish", () => {
  it("splits the acceptance passage into three sentences", () => {
    const parts = splitEnglish("The pandas are black and white. They are cute. They like bamboo.");
    assert.deepEqual(parts, [
      "The pandas are black and white.",
      "They are cute.",
      "They like bamboo.",
    ]);
  });

  it("keeps an ellipsis as one ending", () => {
    assert.deepEqual(splitEnglish("Wait... Then go."), ["Wait...", "Then go."]);
  });

  it("keeps a fragment that has no ending punctuation", () => {
    assert.deepEqual(splitEnglish("They like bamboo"), ["They like bamboo"]);
  });
});

describe("countWords", () => {
  it("counts a contraction as one word", () => {
    assert.equal(countWords("They're cute."), 2);
  });

  it("flags a sentence over 30 words", () => {
    const words = Array.from({ length: 31 }, () => "word").join(" ");
    assert.equal(countWords(words), 31);
    assert.equal(tooLong(words), true);
    assert.equal(tooLong("They are cute."), false);
  });
});

describe("pairSentences", () => {
  it("aligns Chinese when the counts match", () => {
    const pairs = pairSentences(
      "They are cute. They like bamboo.",
      "它们很可爱。它们喜欢竹子。",
    );
    assert.equal(pairs[0]?.textZh, "它们很可爱。");
    assert.equal(pairs[1]?.textZh, "它们喜欢竹子。");
  });

  it("keeps the whole Chinese gloss on the first sentence when counts differ", () => {
    const pairs = pairSentences("They are cute. They like bamboo.", "它们很可爱，喜欢竹子。");
    assert.equal(pairs[0]?.textZh, "它们很可爱，喜欢竹子。");
    assert.equal(pairs[1]?.textZh, "");
  });
});

describe("splitOnce", () => {
  it("splits at the first internal punctuation", () => {
    assert.deepEqual(splitOnce("They are cute. They like bamboo."), [
      "They are cute.",
      "They like bamboo.",
    ]);
  });

  it("splits a long sentence at the word midpoint", () => {
    const [left, right] = splitOnce("one two three four") ?? [];
    assert.equal(left, "one two");
    assert.equal(right, "three four");
  });
});
