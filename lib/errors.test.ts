import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleError } from "./errors";

describe("visibleError", () => {
  it("shows a short database message and hides connection strings", () => {
    assert.equal(visibleError(new Error("no such column: demo_video_path")), "no such column: demo_video_path");
    assert.equal(visibleError(new Error("fetch failed libsql://db.turso.io")), "页面加载失败");
    assert.equal(visibleError(new Error("Bearer secret")), "页面加载失败");
    assert.equal(visibleError("nope"), "页面加载失败");
  });
});
