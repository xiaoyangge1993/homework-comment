import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { sentenceNeedsListen } from "./listen";
import {
  firstIntonationComment,
  intonationComment,
  intonationLabel,
  readIntonationOutput,
  skippedIntonation,
} from "./intonation";

const exec = promisify(execFile);

describe("intonation labels", () => {
  it("maps the five review labels and hides skipped results", () => {
    assert.equal(intonationLabel("match", "rise"), "语调一致");
    assert.equal(intonationLabel("final_mismatch", "rise"), "句末应升");
    assert.equal(intonationLabel("final_mismatch", "fall"), "句末应降");
    assert.equal(intonationLabel("final_mismatch", "flat"), null);
    assert.equal(intonationLabel("flat", "fall"), "偏平");
    assert.equal(intonationLabel("uncertain", null), "无法判断");
    assert.equal(intonationLabel("skipped", null), null);
    assert.equal(intonationLabel(null, null), null);
  });

  it("writes one fixed comment and skips uncertain results", () => {
    assert.equal(intonationComment(2, "final_mismatch", "rise"), "第 2 句末应跟上老师读成升调。");
    assert.equal(intonationComment(3, "final_mismatch", "fall"), "第 3 句末应跟上老师读成降调。");
    assert.equal(intonationComment(4, "flat", "rise"), "第 4 句语调偏平，试着跟上老师的起伏。");
    assert.equal(intonationComment(1, "uncertain", null), null);
    assert.equal(intonationComment(1, "skipped", null), null);
    assert.equal(intonationComment(1, "match", "fall"), null);
    assert.equal(
      firstIntonationComment([
        { index: 1, intonationStatus: "match", teacherFinal: "rise" },
        { index: 2, intonationStatus: "final_mismatch", teacherFinal: "fall" },
        { index: 3, intonationStatus: "flat", teacherFinal: "rise" },
      ]),
      "第 2 句末应跟上老师读成降调。",
    );
  });

  it("keeps a missing parser install empty and a bad measurement uncertain", () => {
    assert.equal(readIntonationOutput('{"ok":false,"error":"parselmouth_missing"}').status, null);
    assert.equal(readIntonationOutput("not-json").status, "uncertain");
    const parsed = readIntonationOutput(
      '{"ok":true,"status":"match","teacherFinal":"rise","studentFinal":"rise","contourAgreement":1.4,"measurement":{"teacherVoiced":20}}',
    );
    assert.equal(parsed.status, "match");
    assert.equal(parsed.agreement, 1);
    assert.match(parsed.json ?? "", /teacherVoiced/);
  });

  it("records a missing per-sentence reference as skipped", () => {
    assert.deepEqual(skippedIntonation(), {
      status: "skipped",
      teacherFinal: null,
      studentFinal: null,
      agreement: null,
      json: null,
    });
  });

  it("does not change who the teacher needs to listen to", () => {
    assert.equal(
      sentenceNeedsListen({
        accuracy: 90,
        fluency: 90,
        completion: 100,
        rhythm: "接近",
        missed: false,
        wrong: false,
        uncertain: false,
      }),
      false,
    );
  });
});

describe("intonation script", () => {
  it("compares synthesized contours and stays quiet when pitch cannot be read", async () => {
    let selfTest: { ok?: boolean; audio?: string };
    try {
      const { stdout } = await exec("python3", ["scripts/intonation.py", "--self-test"], {
        timeout: 30_000,
        env: { ...process.env, PYTHONWARNINGS: "ignore" },
      });
      selfTest = JSON.parse(stdout) as { ok?: boolean; audio?: string };
    } catch (error) {
      const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
      if (missing) return;
      throw error;
    }
    assert.equal(selfTest.ok, true);
    if (selfTest.audio === "skipped") return;
    assert.equal(selfTest.audio, "passed");

    const { stdout } = await exec("python3", ["scripts/intonation.py", "missing-student.wav", "missing-teacher.wav"], {
      timeout: 20_000,
      env: { ...process.env, PYTHONWARNINGS: "ignore" },
    });
    assert.equal(readIntonationOutput(stdout).status, "uncertain");
  });
});
