export type ByteRange =
  | { kind: "all" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

// `bytes=0-1`, `bytes=500-`, and suffix `bytes=-100`. Anything else is unsatisfiable.
export function resolveByteRange(size: number, rangeHeader: string | null): ByteRange {
  if (!rangeHeader) return { kind: "all" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || size === 0) return { kind: "unsatisfiable" };
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (match[1] === "" && match[2]) {
    const suffix = Number(match[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return { kind: "unsatisfiable" };
  }
  return { kind: "partial", start, end: Math.min(end, size - 1) };
}
