import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyRhythm, hasInternalPause } from "./rhythm";

describe("classifyRhythm", () => {
  it("compares duration and gives pause priority", () => {
    assert.equal(classifyRhythm(2, 2, false), "接近");
    assert.equal(classifyRhythm(1, 2, false), "偏快");
    assert.equal(classifyRhythm(4, 2, false), "偏慢");
    assert.equal(classifyRhythm(2, 2, true), "停顿偏长");
    assert.equal(classifyRhythm(2, 0, false), null);
  });
});

describe("hasInternalPause", () => {
  it("ignores silence at the edges", () => {
    const log = "silence_start: 0.0\nsilence_end: 1.2\nsilence_start: 1.5\nsilence_end: 2.6\n";
    assert.equal(hasInternalPause(log, 4), true);
    assert.equal(hasInternalPause("silence_start: 0\nsilence_end: 0.9\n", 4), false);
  });
});
