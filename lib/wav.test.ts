import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodePcmWav, encodePcm16Wav, pcmHasInternalPause, resampleLinear } from "./wav";

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

  it("ignores silence only at the start", () => {
    const rate = 16000;
    const samples = new Int16Array(rate);
    samples.fill(0);
    samples.fill(8000, rate * 0.3);
    assert.equal(pcmHasInternalPause(samples, rate), false);
  });
});
