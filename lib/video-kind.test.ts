import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVideoUpload, videoExtension } from "./video-kind";

describe("videoExtension", () => {
  it("accepts mp4, webm, and mov, and leaves audio alone", () => {
    assert.equal(videoExtension("demo.mp4", "video/mp4"), "mp4");
    assert.equal(videoExtension("demo.mov", "video/quicktime"), "mov");
    assert.equal(videoExtension("demo.webm", ""), "webm");
    assert.equal(videoExtension("read.webm", "audio/webm"), null);
    assert.equal(videoExtension("read.mp4", "audio/mp4"), null);
    assert.equal(videoExtension("clip.avi", "video/avi"), null);
  });

  it("treats an explicit audio upload as audio even if the name looks like video", () => {
    assert.equal(isVideoUpload("audio", "read.mp4", "video/mp4"), false);
    assert.equal(isVideoUpload("video", "clip.mp4", ""), true);
    assert.equal(isVideoUpload("", "clip.webm", "video/webm"), true);
    assert.equal(isVideoUpload("", "read.webm", "audio/webm"), false);
  });
});
