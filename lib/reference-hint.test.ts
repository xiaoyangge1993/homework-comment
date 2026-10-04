import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { referenceHint } from "./reference-hint";

describe("referenceHint", () => {
  it("names the whole-video case only when no sentence has a reference track", () => {
    assert.equal(referenceHint({ sentenceCount: 3, missingReference: 0, hasDemoVideo: true }), "每句都有标准音");
    assert.equal(referenceHint({ sentenceCount: 3, missingReference: 3, hasDemoVideo: true }), "只有整段视频参照");
    assert.equal(referenceHint({ sentenceCount: 3, missingReference: 1, hasDemoVideo: true }), "无节奏参照");
    assert.equal(referenceHint({ sentenceCount: 3, missingReference: 3, hasDemoVideo: false }), "无节奏参照");
  });
});
