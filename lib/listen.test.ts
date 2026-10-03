import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boardGroup, compareBoard, sentenceNeedsListen, type ListenSentence } from "./listen";

function clean(): ListenSentence {
  return { accuracy: 90, fluency: 90, completion: 100, rhythm: "接近", matchTags: [0] };
}

describe("sentenceNeedsListen", () => {
  it("flags low accuracy, low completion, missed or wrong words, and rhythm", () => {
    assert.equal(sentenceNeedsListen(clean()), false);
    assert.equal(sentenceNeedsListen({ ...clean(), accuracy: 79 }), true);
    assert.equal(sentenceNeedsListen({ ...clean(), completion: 89 }), true);
    assert.equal(sentenceNeedsListen({ ...clean(), matchTags: [2] }), true);
    assert.equal(sentenceNeedsListen({ ...clean(), matchTags: [3] }), true);
    assert.equal(sentenceNeedsListen({ ...clean(), matchTags: [1] }), false);
    assert.equal(sentenceNeedsListen({ ...clean(), rhythm: "偏快" }), true);
    assert.equal(sentenceNeedsListen({ ...clean(), rhythm: null }), false);
    assert.equal(sentenceNeedsListen({ ...clean(), accuracy: null }), true);
  });
});

describe("boardGroup", () => {
  it("puts clean submitted work in the pass group and unfinished work aside", () => {
    assert.equal(boardGroup("submitted", [clean(), clean()]), "pass");
    assert.equal(boardGroup("submitted", [clean(), { ...clean(), matchTags: [2] }]), "listen");
    assert.equal(boardGroup("partial", [clean()]), "partial");
    assert.equal(boardGroup("returned", [clean()]), "returned");
    assert.equal(boardGroup("accepted", [{ ...clean(), accuracy: 10 }]), "accepted");
  });

  it("sorts sentences that need a listen ahead of ones that can pass", () => {
    const rows = [
      { group: "pass" as const, accuracy: 95, name: "甲" },
      { group: "listen" as const, accuracy: null, name: "乙" },
      { group: "listen" as const, accuracy: 40, name: "丙" },
    ].sort(compareBoard);
    assert.deepEqual(
      rows.map((row) => row.name),
      ["乙", "丙", "甲"],
    );
  });
});
