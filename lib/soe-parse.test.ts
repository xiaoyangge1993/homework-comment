import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEvaluation, presentSentence } from "./soe-parse";
import { buildSoeUrl } from "./soe-sign";

const sample = {
  code: 0,
  result: {
    SuggestedScore: 55,
    PronAccuracy: 82.2,
    PronFluency: 0.9,
    PronCompletion: 0.5,
    Words: [
      { Word: "They", MatchTag: 0, PronAccuracy: 90 },
      { Word: "are", MatchTag: 2, PronAccuracy: 0 },
      { Word: "cute", MatchTag: 3, PronAccuracy: 40, PhoneInfos: [{ Phone: "k", PronAccuracy: 20 }] },
      { Word: "very", MatchTag: 1, PronAccuracy: 10 },
    ],
  },
};

describe("parseEvaluation", () => {
  it("maps sentence scores and word tags", () => {
    const parsed = parseEvaluation(sample);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.accuracy, 82.2);
    assert.equal(parsed.fluency, 90);
    assert.equal(parsed.completion, 50);
    assert.deepEqual(
      parsed.words.map((word) => [word.word, word.matchTag]),
      [
        ["They", 0],
        ["are", 2],
        ["cute", 3],
        ["very", 1],
      ],
    );
    assert.equal(parsed.words[2]?.phones[0]?.phone, "k");
  });

  it("keeps an interface error instead of inventing a score", () => {
    const parsed = parseEvaluation({
      error: "请求未授权。请联系主账号授权。",
      result: { code: 4002, message: "请求未授权。请联系主账号授权。" },
    });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.accuracy, null);
    assert.equal(parsed.error, "请求未授权。请联系主账号授权。");
  });

  it("reads PhoneInfo when PhoneInfos is absent", () => {
    const parsed = parseEvaluation({
      result: {
        PronAccuracy: 80,
        PronFluency: 0.8,
        PronCompletion: 1,
        Words: [{ Word: "cute", MatchTag: 3, PhoneInfo: [{ Phone: "k", PronAccuracy: 20 }] }],
      },
    });
    assert.equal(parsed.words[0]?.phones[0]?.phone, "k");
  });

  it("treats negative scores as unusable", () => {
    const parsed = parseEvaluation({ result: { PronAccuracy: -1, PronFluency: -1, PronCompletion: -1, Words: [] } });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.accuracy, null);
    assert.equal(parsed.fluency, null);
    assert.equal(parsed.completion, null);
  });

  it("keeps word start times in milliseconds", () => {
    const parsed = parseEvaluation({
      result: {
        PronAccuracy: 70,
        PronFluency: 0.8,
        PronCompletion: 1,
        Words: [
          { Word: "are", MatchTag: 2, PronAccuracy: 0, MemBeginTime: 480, MemEndTime: 900 },
          { Word: "cute", MatchTag: 3, PronAccuracy: 40, BeginTime: 1000, EndTime: 1500 },
        ],
      },
    });
    assert.equal(parsed.words[0]?.beginMs, 480);
    assert.equal(parsed.words[0]?.endMs, 900);
    assert.equal(parsed.words[1]?.beginMs, 1000);
    const view = presentSentence("They are cute.", JSON.stringify({
      result: {
        PronAccuracy: 70,
        Words: [
          { Word: "They", MatchTag: 0, PronAccuracy: 90 },
          { Word: "are", MatchTag: 2, PronAccuracy: 0, MemBeginTime: 480, MemEndTime: 900 },
          { Word: "cute", MatchTag: 3, PronAccuracy: 40 },
        ],
      },
    }));
    assert.equal(view.marks.find((mark) => mark.text === "are")?.beginMs, 480);
    assert.equal(view.marks.find((mark) => mark.text === "cute")?.beginMs, null);
  });

  it("underlines missed words, marks wrong words, and lists extras", () => {
    const view = presentSentence("They are cute.", JSON.stringify(sample));
    assert.equal(view.marks.find((mark) => mark.text === "are")?.kind, "miss");
    assert.equal(view.marks.find((mark) => mark.text === "cute")?.kind, "wrong");
    assert.deepEqual(view.extras, ["very"]);
  });
});

describe("buildSoeUrl", () => {
  it("signs the raw sentence and encodes the request", () => {
    process.env.TENCENT_SECRET_ID = "sid";
    process.env.TENCENT_SECRET_KEY = "skey";
    process.env.TENCENT_SOE_APPID = "10001";
    const { url, signSource } = buildSoeUrl("They are cute?", 1_700_000_000);
    assert.match(signSource, /eval_mode=1/);
    assert.match(signSource, /server_engine_type=16k_en/);
    assert.ok(signSource.includes("ref_text=They are cute?"));
    assert.equal(signSource.includes("%20"), false);
    assert.match(url, /ref_text=They%20are%20cute%3F/);
    assert.match(url, /signature=/);
  });
});
