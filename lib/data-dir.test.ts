import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveDataDir } from "./data-dir";

describe("resolveDataDir", () => {
  it("keeps the project data directory when it can be written", () => {
    assert.equal(resolveDataDir("/app", undefined, () => true), path.join("/app", "data"));
  });

  it("uses /tmp when the project directory is read-only, as on Vercel", () => {
    assert.equal(resolveDataDir("/var/task", undefined, () => false), path.join("/tmp", "homework-comment"));
  });

  it("honors DATA_DIR when it is set", () => {
    assert.equal(resolveDataDir("/app", "/persistent/data", () => false), "/persistent/data");
  });
});
