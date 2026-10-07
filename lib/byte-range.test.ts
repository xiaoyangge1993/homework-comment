import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveByteRange } from "./byte-range";

describe("resolveByteRange", () => {
  it("returns the whole file when the header is missing", () => {
    assert.deepEqual(resolveByteRange(1000, null), { kind: "all" });
    assert.deepEqual(resolveByteRange(1000, ""), { kind: "all" });
  });

  it("reads a closed range, an open end, and a suffix", () => {
    assert.deepEqual(resolveByteRange(1000, "bytes=0-1"), { kind: "partial", start: 0, end: 1 });
    assert.deepEqual(resolveByteRange(1000, "bytes=500-"), { kind: "partial", start: 500, end: 999 });
    assert.deepEqual(resolveByteRange(1000, "bytes=-100"), { kind: "partial", start: 900, end: 999 });
  });

  it("rejects a range that starts past the end or runs backwards", () => {
    assert.deepEqual(resolveByteRange(1000, "bytes=1000-"), { kind: "unsatisfiable" });
    assert.deepEqual(resolveByteRange(1000, "bytes=5-4"), { kind: "unsatisfiable" });
    assert.deepEqual(resolveByteRange(0, "bytes=0-1"), { kind: "unsatisfiable" });
    assert.deepEqual(resolveByteRange(1000, "bytes=0-1,2-3"), { kind: "unsatisfiable" });
  });
});
