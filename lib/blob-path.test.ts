import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blobUploadMatches, isRemoteVideoPath, pathnameAllowed } from "./blob-path";

const url = "https://store.private.blob.vercel-storage.com/demo/1/clip.mp4";

describe("blob paths", () => {
  it("tells a blob url from a disk path", () => {
    assert.equal(isRemoteVideoPath(url), true);
    assert.equal(isRemoteVideoPath("demo/1/clip.mp4"), false);
    assert.equal(isRemoteVideoPath("/api/video/demo/1"), false);
    assert.equal(isRemoteVideoPath("http://store.private.blob.vercel-storage.com/demo/1/clip.mp4"), false);
    assert.equal(isRemoteVideoPath("https://evil.blob.vercel-storage.com.evil.com/demo/1/clip.mp4"), false);
  });

  it("rejects a pathname that leaves its prefix", () => {
    assert.equal(pathnameAllowed("demo/1/clip.mp4", "demo/1"), true);
    assert.equal(pathnameAllowed("demo/12/clip.mp4", "demo/1"), false);
    assert.equal(pathnameAllowed("demo/1/../2/clip.mp4", "demo/1"), false);
    assert.equal(pathnameAllowed("demo/1/clip.txt", "demo/1"), false);
  });

  it("requires the url and the claimed pathname to be the same object", () => {
    assert.equal(blobUploadMatches({ blobUrl: url, pathname: "demo/1/clip.mp4", prefix: "demo/1" }), "demo/1/clip.mp4");
    assert.equal(blobUploadMatches({ blobUrl: url, pathname: "demo/1/other.mp4", prefix: "demo/1" }), null);
    assert.equal(
      blobUploadMatches({
        blobUrl: "https://files.example.com/demo/1/clip.mp4",
        pathname: "demo/1/clip.mp4",
        prefix: "demo/1",
      }),
      null,
    );
    assert.equal(blobUploadMatches({ blobUrl: url, pathname: "demo/1/clip.mp4", prefix: "attempt/1" }), null);
  });
});
