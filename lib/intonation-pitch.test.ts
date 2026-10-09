import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { intonationComment, skippedIntonation } from "./intonation";
import { compareIntonation, correctOctave, decideTracks, type HzPoint } from "./intonation-pitch";
import { encodePcm16Wav } from "./wav";

const exec = promisify(execFile);
const RATE = 16000;

function glide(steady: number, target: number): (time: number) => number {
  return (time) => {
    if (time < 0.75) return steady;
    const span = Math.min(1, Math.max(0, (time - 0.75) / 0.45));
    return Math.exp(Math.log(steady) + (Math.log(target) - Math.log(steady)) * span);
  };
}

function render(f0At: (time: number) => number, duration = 1.2): Int16Array {
  const count = Math.floor(duration * RATE);
  const fade = Math.floor(RATE * 0.03);
  const samples = new Int16Array(count);
  let phase = 0;
  for (let index = 0; index < count; index += 1) {
    const f0 = f0At(index / RATE);
    phase += (2 * Math.PI * f0) / RATE;
    let sample = 0;
    let harmonic = 1;
    while (harmonic * f0 < 2500 && harmonic <= 6) {
      sample += Math.sin(harmonic * phase) / harmonic;
      harmonic += 1;
    }
    if (index < fade) sample *= index / fade;
    else if (index > count - fade) sample *= (count - index) / fade;
    sample = Math.max(-1, Math.min(1, sample * 0.25));
    samples[index] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return samples;
}

function compare(student: (time: number) => number, teacher: (time: number) => number) {
  return compareIntonation(render(student), render(teacher));
}

function ramp(startHz: number, endHz: number): HzPoint[] {
  const points: HzPoint[] = [];
  for (let step = 0; step <= 100; step += 1) {
    const time = step / 100;
    const span = time <= 0.7 ? 0 : Math.min(1, (time - 0.7) / 0.3);
    const hz = Math.exp(Math.log(startHz) + (Math.log(endHz) - Math.log(startHz)) * span);
    points.push({ time, hz });
  }
  return points;
}

describe("in-process pitch", () => {
  it("matches the same large ending rise and stays out of the comment", () => {
    const result = compare(glide(200, 360), glide(180, 320));
    assert.equal(result.status, "match", result.json ?? "");
    assert.equal(result.teacherFinal, "rise");
    assert.equal(result.studentFinal, "rise");
    assert.equal(intonationComment(1, result.status, result.teacherFinal), null);
  });

  it("marks a clear teacher rise against a student fall", () => {
    const result = compare(glide(340, 170), glide(180, 320));
    assert.equal(result.status, "final_mismatch", result.json ?? "");
    assert.equal(result.teacherFinal, "rise");
    assert.equal(result.studentFinal, "fall");
  });

  it("marks a long straight student contour flat", () => {
    const result = compare(() => 220, glide(180, 320));
    assert.equal(result.status, "flat", result.json ?? "");
    assert.equal(intonationComment(1, result.status, result.teacherFinal), "第 1 句语调偏平，试着跟上老师的起伏。");
  });

  it("is uncertain when the voiced span is too short", () => {
    const result = compareIntonation(render(() => 220, 0.08), render(() => 220));
    assert.equal(result.status, "uncertain", result.json ?? "");
    assert.match(result.json ?? "", /few_frames/);
  });

  it("is uncertain when autocorrelation and YIN endings oppose", () => {
    const rise = ramp(180, 320);
    const fall = ramp(320, 180);
    const result = decideTracks(
      { merged: rise, acf: rise, yin: rise },
      { merged: rise, acf: rise, yin: fall },
    );
    assert.equal(result.status, "uncertain", result.json ?? "");
    assert.match(result.json ?? "", /estimator_conflict/);
    assert.equal(intonationComment(2, result.status, result.teacherFinal), null);
  });

  it("folds one octave spike back to the surrounding pitch", () => {
    const corrected = correctOctave([
      { time: 0, hz: 220 },
      { time: 0.01, hz: 222 },
      { time: 0.02, hz: 440 },
      { time: 0.03, hz: 218 },
      { time: 0.04, hz: 221 },
    ]);
    assert.ok(corrected.every((point) => point.hz < 300));
    const result = compare((time) => (time >= 0.4 && time < 0.46 ? 440 : 220), () => 220);
    assert.equal(result.status, "flat", result.json ?? "");
    assert.ok(result.studentFinal !== "rise" && result.studentFinal !== "fall");
  });

  it("skips a sentence that has no teacher reference", () => {
    const stored = skippedIntonation();
    assert.equal(stored.status, "skipped");
    assert.equal(stored.teacherFinal, null);
    assert.equal(stored.json, null);
    assert.equal(intonationComment(1, stored.status, stored.teacherFinal), null);
  });

  it("gives up when the pitch budget is already spent", () => {
    const result = compareIntonation(render(() => 220), render(() => 220), 0);
    assert.equal(result.status, "uncertain", result.json ?? "");
    assert.match(result.json ?? "", /timeout/);
  });
});

describe("praat oracle", () => {
  it("matches Parselmouth on the same obvious glides when Praat is installed", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homework-intonation-"));
    const cases = [
      { name: "match", student: glide(200, 360), teacher: glide(180, 320), status: "match" },
      { name: "mismatch", student: glide(340, 170), teacher: glide(180, 320), status: "final_mismatch" },
      { name: "flat", student: () => 220, teacher: glide(180, 320), status: "flat" },
    ];
    try {
      for (const item of cases) {
        const student = render(item.student);
        const teacher = render(item.teacher);
        const ours = compareIntonation(student, teacher);
        assert.equal(ours.status, item.status, ours.json ?? "");
        const studentPath = path.join(directory, `${item.name}-student.wav`);
        const teacherPath = path.join(directory, `${item.name}-teacher.wav`);
        fs.writeFileSync(studentPath, encodePcm16Wav(student, RATE));
        fs.writeFileSync(teacherPath, encodePcm16Wav(teacher, RATE));
        let parsed: { ok?: boolean; error?: string; status?: string };
        try {
          const { stdout } = await exec("python3", ["scripts/intonation.py", studentPath, teacherPath], {
            timeout: 30_000,
            env: { ...process.env, PYTHONWARNINGS: "ignore" },
          });
          parsed = JSON.parse(stdout) as { ok?: boolean; error?: string; status?: string };
        } catch (error) {
          const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
          if (missing) return;
          throw error;
        }
        if (parsed.error === "parselmouth_missing" || parsed.ok === false) return;
        assert.equal(parsed.status, ours.status, JSON.stringify(parsed));
      }
    } finally {
      for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
      fs.rmdirSync(directory);
    }
  });
});
