import { limits } from "./config";

export type PcmWav = {
  sampleRate: number;
  channels: number;
  samples: Int16Array;
};

export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const length = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const output = new Float32Array(length);
  const scale = fromRate / toRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * scale;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const mix = position - left;
    output[index] = input[left] * (1 - mix) + input[right] * mix;
  }
  return output;
}

export function floatToPcm16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export function encodePcm16Wav(samples: Int16Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  writeText(bytes, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(bytes, 8, "WAVE");
  writeText(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(bytes, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) view.setInt16(44 + index * 2, samples[index], true);
  return bytes;
}

export function decodePcmWav(bytes: Uint8Array): PcmWav | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readText(bytes, 0, 4) !== "RIFF" || readText(bytes, 8, 4) !== "WAVE") return null;
  let offset = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataOffset = 0;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = readText(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === "fmt " && size >= 16 && start + 16 <= bytes.length) {
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      bits = view.getUint16(start + 14, true);
    }
    if (id === "data") {
      dataOffset = start;
      dataSize = size;
      break;
    }
    offset = start + size + (size % 2);
  }
  if (format !== 1 || channels < 1 || sampleRate < 1 || bits !== 16 || dataOffset === 0) return null;
  const available = Math.min(dataSize, bytes.length - dataOffset);
  const frameCount = Math.floor(available / (channels * 2));
  const samples = new Int16Array(frameCount);
  for (let index = 0; index < frameCount; index += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += view.getInt16(dataOffset + (index * channels + channel) * 2, true);
    }
    samples[index] = Math.round(sum / channels);
  }
  return { sampleRate, channels, samples };
}

export function pcmHasInternalPause(samples: Int16Array, sampleRate: number): boolean {
  if (sampleRate < 1 || samples.length === 0) return false;
  const frame = Math.round(sampleRate * 0.02);
  const total = samples.length / sampleRate;
  const silence = 32768 * 10 ** (-35 / 20);
  let runStart = -1;
  for (let offset = 0; offset < samples.length; offset += frame) {
    const end = Math.min(samples.length, offset + frame);
    let energy = 0;
    for (let index = offset; index < end; index += 1) energy += samples[index] * samples[index];
    const rms = Math.sqrt(energy / (end - offset));
    const time = offset / sampleRate;
    if (rms < silence) {
      if (runStart < 0) runStart = time;
      continue;
    }
    if (runStart >= 0 && isInternal(runStart, time, total)) return true;
    runStart = -1;
  }
  return runStart >= 0 && isInternal(runStart, total, total);
}

function isInternal(start: number, end: number, total: number): boolean {
  if (start < 0.2) return false;
  if (end > total - 0.2) return false;
  return end - start >= limits.pauseSeconds;
}

function writeText(bytes: Uint8Array, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index);
}

function readText(bytes: Uint8Array, offset: number, length: number): string {
  let text = "";
  for (let index = 0; index < length; index += 1) text += String.fromCharCode(bytes[offset + index] ?? 0);
  return text;
}
