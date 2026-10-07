import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodePcmWav, encodePcm16Wav, isInaudible, pcmHasInternalPause, resampleLinear, trimEdgeSilence } from "./wav";

describe("wav", () => {
  it("round-trips 16 kHz mono pcm", () => {
    const samples = Int16Array.from([0, 1000, -1000, 32767]);
    const decoded = decodePcmWav(encodePcm16Wav(samples, 16000));
    assert.ok(decoded);
    assert.equal(decoded.sampleRate, 16000);
    assert.equal(decoded.channels, 1);
    assert.deepEqual(Array.from(decoded.samples), Array.from(samples));
  });

  it("resamples a longer buffer down to 16 kHz", () => {
    const input = new Float32Array(48000);
    const output = resampleLinear(input, 48000, 16000);
    assert.equal(output.length, 16000);
  });

  it("flags a quiet stretch away from the edges", () => {
    const rate = 16000;
    const samples = new Int16Array(rate * 2);
    samples.fill(8000);
    samples.fill(0, rate * 0.5, rate * 1.5);
    assert.equal(pcmHasInternalPause(samples, rate), true);
  });

  it("drops edge silence and keeps a gap between words", () => {
    const rate = 16000;
    const samples = new Int16Array(rate);
    samples.fill(8000, rate * 0.3, rate * 0.45);
    samples.fill(8000, rate * 0.6, rate * 0.75);
    const trimmed = trimEdgeSilence(samples, rate);
    assert.ok(trimmed.length < samples.length);
    assert.ok(trimmed.length > rate * 0.5);
    assert.ok(Array.from(trimmed).includes(0));
    assert.equal(isInaudible(trimmed, rate), false);
  });

  it("treats silence, a short clip, and a quiet clip as inaudible", () => {
    const rate = 16000;
    assert.equal(isInaudible(trimEdgeSilence(new Int16Array(rate), rate), rate), true);
    const brief = new Int16Array(Math.round(rate * 0.1));
    brief.fill(8000);
    assert.equal(isInaudible(brief, rate), true);
    const quiet = new Int16Array(rate);
    quiet.fill(40);
    assert.equal(isInaudible(quiet, rate), true);
  });

  it("ignores silence only at the start", () => {
    const rate = 16000;
    const samples = new Int16Array(rate);
    samples.fill(0);
    samples.fill(8000, rate * 0.3);
    assert.equal(pcmHasInternalPause(samples, rate), false);
  });
});
