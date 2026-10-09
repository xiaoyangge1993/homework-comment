import { failed, type FinalDirection, type StoredIntonation } from "./intonation";

const SOURCE_RATE = 16000;
const TRACK_RATE = 8000;
const HOP_SECONDS = 0.01;
const PITCH_FLOOR = 120;
const PITCH_CEILING = 500;
const YIN_THRESHOLD = 0.15;
const ACF_CLARITY = 0.45;
const AGREE_SEMITONES = 1.5;
const OCTAVE_RATIO = 1.7;
const MAX_STEP_SEMITONES = 7;
const MIN_VOICED = 8;
const MIN_SPAN_SECONDS = 0.2;
const FLAT_SPAN_SECONDS = 0.3;
const FLAT_RANGE = 2;
const FINAL_WINDOW = 0.3;
const FINAL_MIN_FRAMES = 6;
const FINAL_MIN_SPAN = 0.15;
const FINAL_R2 = 0.5;
const FINAL_SEMITONES = 1.5;
const MAX_ALIGN = 400;
export const INTONATION_BUDGET_MS = 3000;

export type HzPoint = { time: number; hz: number };

type TrackSet = { merged: HzPoint[]; acf: HzPoint[]; yin: HzPoint[] };
type Ending = { direction: FinalDirection; change: number; r2: number };

export function compareIntonation(
  student: Int16Array,
  teacher: Int16Array,
  deadline = Date.now() + INTONATION_BUDGET_MS,
): StoredIntonation {
  const studentTrack = trackPitch(student, deadline);
  if (studentTrack === "timeout") return uncertain("timeout");
  const teacherTrack = trackPitch(teacher, deadline);
  if (teacherTrack === "timeout") return uncertain("timeout");
  return decideTracks(teacherTrack, studentTrack);
}

export function correctOctave(points: HzPoint[]): HzPoint[] {
  const kept: HzPoint[] = [];
  let previous: number | null = null;
  for (const point of points) {
    let hz = point.hz;
    if (previous != null && (hz / previous > OCTAVE_RATIO || previous / hz > OCTAVE_RATIO)) {
      const candidates = [hz / 2, hz * 2].filter((candidate) => candidate >= PITCH_FLOOR && candidate <= PITCH_CEILING);
      let best = hz;
      let bestDistance = Math.abs(Math.log2(hz / previous));
      let replaced = false;
      for (const candidate of candidates) {
        const distance = Math.abs(Math.log2(candidate / previous));
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
          replaced = true;
        }
      }
      if (!replaced) continue;
      hz = best;
    }
    if (previous != null && Math.abs(semitoneRatio(hz, previous)) > MAX_STEP_SEMITONES) continue;
    kept.push({ time: point.time, hz });
    previous = hz;
  }
  return kept;
}

export function decideTracks(teacher: TrackSet, student: TrackSet): StoredIntonation {
  const teacherSemi = semitones(teacher.merged);
  const studentSemi = semitones(student.merged);
  const measurement: Record<string, unknown> = {
    teacherVoiced: teacher.merged.length,
    studentVoiced: student.merged.length,
    teacherMedianHz: median(teacher.merged.map((point) => point.hz)),
    studentMedianHz: median(student.merged.map((point) => point.hz)),
    studentRangeSemitones: null,
    teacherFinalChange: null,
    studentFinalChange: null,
    teacherR2: null,
    studentR2: null,
    estimatorsAgree: null,
    correlation: null,
  };
  if (
    teacher.merged.length < MIN_VOICED ||
    student.merged.length < MIN_VOICED ||
    spanOf(teacher.merged) < MIN_SPAN_SECONDS ||
    spanOf(student.merged) < MIN_SPAN_SECONDS
  ) {
    measurement.reason = "few_frames";
    return pack("uncertain", null, null, null, measurement);
  }

  const studentRange = percentileRange(studentSemi.map((point) => point.st));
  measurement.studentRangeSemitones = round4(studentRange);
  const agreement = contourAgreement(teacherSemi, studentSemi);
  measurement.correlation = agreement.raw == null ? null : round4(agreement.raw);

  if (spanOf(student.merged) >= FLAT_SPAN_SECONDS && studentRange < FLAT_RANGE) {
    return pack("flat", null, null, agreement.clamped, measurement);
  }

  const teacherEnding = confirmedEnding(teacher);
  const studentEnding = confirmedEnding(student);
  measurement.teacherFinalChange = round4(teacherEnding.ending.change);
  measurement.studentFinalChange = round4(studentEnding.ending.change);
  measurement.teacherR2 = round4(teacherEnding.ending.r2);
  measurement.studentR2 = round4(studentEnding.ending.r2);
  measurement.estimatorsAgree = !teacherEnding.conflict && !studentEnding.conflict;
  if (teacherEnding.conflict || studentEnding.conflict) {
    measurement.reason = "estimator_conflict";
    return pack("uncertain", null, null, agreement.clamped, measurement);
  }

  const teacherDirection = teacherEnding.ending.direction;
  const studentDirection = studentEnding.ending.direction;
  const opposite =
    (teacherDirection === "rise" || teacherDirection === "fall") &&
    (studentDirection === "rise" || studentDirection === "fall") &&
    teacherDirection !== studentDirection;
  return pack(opposite ? "final_mismatch" : "match", teacherDirection, studentDirection, agreement.clamped, measurement);
}

function trackPitch(samples: Int16Array, deadline: number): TrackSet | "timeout" {
  const signal = decimate(samples);
  const minLag = Math.max(2, Math.round(TRACK_RATE / PITCH_CEILING));
  const maxLag = Math.round(TRACK_RATE / PITCH_FLOOR);
  const frameLen = Math.max(Math.round((TRACK_RATE * 3) / PITCH_FLOOR), maxLag + 2);
  const hop = Math.round(TRACK_RATE * HOP_SECONDS);
  const hann = hannWindow(frameLen);
  const acf: HzPoint[] = [];
  const yin: HzPoint[] = [];
  // YIN's 0.15 gate is defined on a rectangular window. A taper pushes clean low pitches over it.
  for (let start = 0; start + frameLen + maxLag <= signal.length; start += hop) {
    if (Date.now() > deadline) return "timeout";
    const yinFrame = signal.subarray(start, start + frameLen + maxLag);
    if (frameEnergy(yinFrame.subarray(0, frameLen)) < 1e-4) continue;
    const time = (start + frameLen / 2) / TRACK_RATE;
    const acfHz = autocorrelationPitch(applyWindow(signal, start, hann), minLag, maxLag);
    const yinHz = yinPitch(yinFrame, frameLen, minLag, maxLag);
    if (acfHz != null) acf.push({ time, hz: acfHz });
    if (yinHz != null) yin.push({ time, hz: yinHz });
  }
  const acfFixed = correctOctave(acf);
  const yinFixed = correctOctave(yin);
  const yinAt = new Map<number, number>();
  for (const point of yinFixed) yinAt.set(timeKey(point.time), point.hz);
  const merged: HzPoint[] = [];
  for (const point of acfFixed) {
    const other = yinAt.get(timeKey(point.time));
    if (other == null) continue;
    if (Math.abs(semitoneRatio(point.hz, other)) > AGREE_SEMITONES) continue;
    merged.push({ time: point.time, hz: Math.sqrt(point.hz * other) });
  }
  return { merged, acf: acfFixed, yin: yinFixed };
}

function decimate(samples: Int16Array): Float64Array {
  const length = Math.floor(samples.length / (SOURCE_RATE / TRACK_RATE));
  const out = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    const left = samples[index * 2] ?? 0;
    const right = samples[index * 2 + 1] ?? left;
    out[index] = (left + right) / 2 / 32768;
  }
  return out;
}

function hannWindow(length: number): Float64Array {
  const window = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, length - 1));
  }
  return window;
}

function applyWindow(signal: Float64Array, start: number, window: Float64Array): Float64Array {
  const frame = new Float64Array(window.length);
  for (let index = 0; index < window.length; index += 1) frame[index] = signal[start + index] * window[index];
  return frame;
}

function frameEnergy(frame: Float64Array): number {
  let energy = 0;
  for (const sample of frame) energy += sample * sample;
  return energy / frame.length;
}

function autocorrelationPitch(frame: Float64Array, minLag: number, maxLag: number): number | null {
  let energy = 0;
  for (const sample of frame) energy += sample * sample;
  if (energy <= 1e-8) return null;
  let bestLag = -1;
  let best = 0;
  let previous = 0;
  let current = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    const limit = frame.length - lag;
    for (let index = 0; index < limit; index += 1) sum += frame[index] * frame[index + lag];
    const norm = sum / energy;
    if (lag > minLag && previous < current && current >= norm && current > best) {
      best = current;
      bestLag = lag - 1;
    }
    previous = current;
    current = norm;
  }
  if (previous < current && current > best) {
    best = current;
    bestLag = maxLag;
  }
  if (bestLag < 0 || best < ACF_CLARITY) return null;
  return TRACK_RATE / bestLag;
}

function yinPitch(frame: Float64Array, width: number, minLag: number, maxLag: number): number | null {
  const difference = new Float64Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau += 1) {
    let sum = 0;
    for (let index = 0; index < width; index += 1) {
      const delta = frame[index] - frame[index + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }
  const normalized = new Float64Array(maxLag + 1);
  normalized[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau += 1) {
    running += difference[tau];
    normalized[tau] = running === 0 ? 1 : (difference[tau] * tau) / running;
  }
  let tau = minLag;
  while (tau <= maxLag && normalized[tau] >= YIN_THRESHOLD) tau += 1;
  if (tau > maxLag) return null;
  while (tau + 1 <= maxLag && normalized[tau + 1] < normalized[tau]) tau += 1;
  if (normalized[tau] >= YIN_THRESHOLD) return null;
  let refined = tau;
  if (tau > 0 && tau < maxLag) {
    const earlier = normalized[tau - 1];
    const here = normalized[tau];
    const later = normalized[tau + 1];
    const denominator = 2 * (2 * here - later - earlier);
    if (denominator !== 0) refined = tau + (later - earlier) / denominator;
  }
  if (refined < minLag || refined > maxLag) return null;
  return TRACK_RATE / refined;
}

function confirmedEnding(track: TrackSet): { ending: Ending; conflict: boolean } {
  const acf = endingOf(semitones(track.acf));
  const yin = endingOf(semitones(track.yin));
  const opposite =
    (acf.direction === "rise" || acf.direction === "fall") &&
    (yin.direction === "rise" || yin.direction === "fall") &&
    acf.direction !== yin.direction;
  if (opposite) return { ending: acf, conflict: true };
  if (acf.direction === yin.direction) return { ending: acf, conflict: false };
  return { ending: { direction: "flat", change: (acf.change + yin.change) / 2, r2: Math.min(acf.r2, yin.r2) }, conflict: false };
}

function endingOf(points: { time: number; st: number }[]): Ending {
  if (points.length < 2) return { direction: "flat", change: 0, r2: 0 };
  const end = points[points.length - 1].time;
  let window = points.filter((point) => point.time >= end - FINAL_WINDOW);
  if (window.length < 2) window = points.slice(-2);
  const covered = window[window.length - 1].time - window[0].time;
  if (window.length < FINAL_MIN_FRAMES || covered < FINAL_MIN_SPAN) return { direction: "flat", change: 0, r2: 0 };
  const count = window.length;
  const meanTime = window.reduce((sum, point) => sum + point.time, 0) / count;
  const meanSt = window.reduce((sum, point) => sum + point.st, 0) / count;
  let variance = 0;
  let covariance = 0;
  let total = 0;
  for (const point of window) {
    variance += (point.time - meanTime) ** 2;
    covariance += (point.time - meanTime) * (point.st - meanSt);
    total += (point.st - meanSt) ** 2;
  }
  if (variance <= 1e-12 || total <= 1e-8) return { direction: "flat", change: 0, r2: 1 };
  const slope = covariance / variance;
  const change = slope * FINAL_WINDOW;
  let residual = 0;
  for (const point of window) {
    const predicted = meanSt + slope * (point.time - meanTime);
    residual += (point.st - predicted) ** 2;
  }
  const r2 = 1 - residual / total;
  if (r2 < FINAL_R2) return { direction: "flat", change, r2 };
  if (change > FINAL_SEMITONES) return { direction: "rise", change, r2 };
  if (change < -FINAL_SEMITONES) return { direction: "fall", change, r2 };
  return { direction: "flat", change, r2 };
}

function semitones(points: HzPoint[]): { time: number; st: number }[] {
  const center = median(points.map((point) => point.hz));
  if (center == null || center <= 0) return [];
  return points.map((point) => ({ time: point.time, st: semitoneRatio(point.hz, center) }));
}

function percentileRange(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return percentile(ordered, 0.9) - percentile(ordered, 0.1);
}

function percentile(ordered: number[], fraction: number): number {
  const index = (ordered.length - 1) * fraction;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return ordered[low];
  return ordered[low] * (high - index) + ordered[high] * (index - low);
}

function contourAgreement(
  teacher: { st: number }[],
  student: { st: number }[],
): { raw: number | null; clamped: number | null } {
  const aligned = dtw(downsample(teacher), downsample(student));
  const raw = pearson(aligned.left, aligned.right);
  if (raw == null) return { raw: null, clamped: null };
  return { raw, clamped: round4(Math.min(1, Math.max(0, raw))) };
}

function downsample(points: { st: number }[]): number[] {
  if (points.length <= MAX_ALIGN) return points.map((point) => point.st);
  const last = points.length - 1;
  const picked: number[] = [];
  for (let index = 0; index < MAX_ALIGN; index += 1) {
    picked.push(points[Math.round((index * last) / (MAX_ALIGN - 1))].st);
  }
  return picked;
}

function dtw(left: number[], right: number[]): { left: number[]; right: number[] } {
  const rows = left.length;
  const cols = right.length;
  if (rows === 0 || cols === 0) return { left: [], right: [] };
  const inf = Number.POSITIVE_INFINITY;
  const cost = Array.from({ length: rows + 1 }, () => new Float64Array(cols + 1).fill(inf));
  cost[0][0] = 0;
  for (let row = 1; row <= rows; row += 1) {
    const sample = left[row - 1];
    const previous = cost[row - 1];
    const current = cost[row];
    for (let column = 1; column <= cols; column += 1) {
      const step = Math.abs(sample - right[column - 1]);
      let best = previous[column - 1];
      if (previous[column] < best) best = previous[column];
      if (current[column - 1] < best) best = current[column - 1];
      current[column] = step + best;
    }
  }
  let row = rows;
  let column = cols;
  const alignedLeft: number[] = [];
  const alignedRight: number[] = [];
  while (row > 0 && column > 0) {
    alignedLeft.push(left[row - 1]);
    alignedRight.push(right[column - 1]);
    if (row === 1 && column === 1) break;
    const diagonal = cost[row - 1][column - 1];
    const up = cost[row - 1][column];
    const side = cost[row][column - 1];
    if (diagonal <= up && diagonal <= side) {
      row -= 1;
      column -= 1;
    } else if (up <= side) row -= 1;
    else column -= 1;
  }
  alignedLeft.reverse();
  alignedRight.reverse();
  return { left: alignedLeft, right: alignedRight };
}

function pearson(left: number[], right: number[]): number | null {
  if (left.length < 2 || left.length !== right.length) return null;
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / left.length;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / right.length;
  let varianceLeft = 0;
  let varianceRight = 0;
  let covariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - meanLeft;
    const rightDelta = right[index] - meanRight;
    varianceLeft += leftDelta * leftDelta;
    varianceRight += rightDelta * rightDelta;
    covariance += leftDelta * rightDelta;
  }
  if (varianceLeft <= 1e-12 || varianceRight <= 1e-12) return null;
  return covariance / Math.sqrt(varianceLeft * varianceRight);
}

function spanOf(points: HzPoint[]): number {
  if (points.length < 2) return 0;
  return points[points.length - 1].time - points[0].time;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const mid = Math.floor(ordered.length / 2);
  if (ordered.length % 2) return round4(ordered[mid]);
  return round4((ordered[mid - 1] + ordered[mid]) / 2);
}

function semitoneRatio(hz: number, reference: number): number {
  return 12 * Math.log2(hz / reference);
}

function timeKey(time: number): number {
  return Math.round(time * 1000);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function uncertain(reason: string): StoredIntonation {
  return failed(reason);
}

function pack(
  status: StoredIntonation["status"],
  teacherFinal: FinalDirection | null,
  studentFinal: FinalDirection | null,
  agreement: number | null,
  measurement: Record<string, unknown>,
): StoredIntonation {
  return {
    status,
    teacherFinal,
    studentFinal,
    agreement,
    json: JSON.stringify(measurement),
  };
}
