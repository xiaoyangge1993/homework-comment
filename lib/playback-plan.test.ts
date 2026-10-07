import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codecFromFfmpegLog, playbackAction } from "./playback-plan";

describe("playback plan", () => {
  it("reads the video codec out of an ffmpeg log", () => {
    assert.equal(
      codecFromFfmpegLog("Stream #0:0(und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p"),
      "hevc",
    );
    assert.equal(codecFromFfmpegLog("Stream #0:0: Video: h264 (High) (avc1 / 0x31637661)"), "h264");
    assert.equal(codecFromFfmpegLog("Stream #0:1: Audio: aac"), null);
  });

  it("remuxes H.264, keeps webm, and transcodes HEVC", () => {
    assert.equal(playbackAction("h264", "mp4"), "remux-mp4");
    assert.equal(playbackAction("h264", "mov"), "remux-mp4");
    assert.equal(playbackAction("vp9", "webm"), "keep-webm");
    assert.equal(playbackAction("hevc", "mov"), "transcode-mp4");
    assert.equal(playbackAction("hevc", "mp4"), "transcode-mp4");
    assert.equal(playbackAction(null, "mp4"), "transcode-mp4");
  });
});
