import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canReplaceReference,
  referencePlaybackKind,
  referenceStorageAction,
  storedReferenceState,
} from "./reference-store";

const blobUrl = "https://store.private.blob.vercel-storage.com/reference/4/sentence.webm";

describe("reference storage", () => {
  it("uses blob when it is configured, and refuses the temporary disk on Vercel", () => {
    assert.equal(referenceStorageAction({ blobEnabled: true, vercel: true }), "blob");
    assert.equal(referenceStorageAction({ blobEnabled: true, vercel: false }), "blob");
    assert.equal(referenceStorageAction({ blobEnabled: false, vercel: true }), "refuse");
    assert.equal(referenceStorageAction({ blobEnabled: false, vercel: false }), "disk");
  });

  it("redirects a blob url and reads a relative path from disk", () => {
    assert.equal(referencePlaybackKind(blobUrl), "redirect");
    assert.equal(referencePlaybackKind("reference/4/sentence.webm"), "file");
  });

  it("lets a published assignment replace only the reference track", () => {
    assert.equal(canReplaceReference("draft"), true);
    assert.equal(canReplaceReference("published"), true);
    assert.equal(canReplaceReference("closed"), true);
    assert.equal(canReplaceReference("archived"), false);
  });

  it("treats a missing disk file as lost and a blob url as ready", () => {
    assert.equal(storedReferenceState(null, false), "absent");
    assert.equal(storedReferenceState("reference/4/sentence.webm", true), "ready");
    assert.equal(storedReferenceState("reference/4/sentence.webm", false), "missing");
    assert.equal(storedReferenceState(blobUrl, false), "ready");
  });
});
