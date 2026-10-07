import "server-only";

import fs from "fs";
import os from "os";
import path from "path";
import { blobUploadMatches, isRemoteVideoPath } from "./blob-path";
import { putPrivateFile, readBlobToFile, removeBlob } from "./blob-store";
import { AppError } from "./errors";
import { buildPlaybackFile, inspectVideoFile } from "./video";

export type StagedVideo = {
  localPath: string;
  playbackUrl: string;
  finish: (action: "keep" | "discard", previousUrl?: string | null) => Promise<void>;
};

type StageInput = {
  blobUrl: string;
  pathname: string;
  prefix: string;
  maxBytes: number;
  maxSeconds: number;
  playbackTimeout: number;
  badType: string;
  tooBig: string;
  tooLong: string;
  unreadable: string;
  missingFfmpeg: string;
};

// Downloads a private blob, checks it, and stores a browser-playable copy.
// finish("keep") drops the raw upload once the playback object is the one to keep.
// finish("discard") drops both new objects and leaves any previous video alone.
export async function stageRemoteVideo(input: StageInput): Promise<StagedVideo> {
  const pathname = blobUploadMatches(input);
  if (!pathname) throw new AppError("找不到上传的视频");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hw-video-"));
  const ext = path.extname(pathname) || ".mp4";
  const localPath = path.join(dir, `source${ext}`);
  const sourceUrl = input.blobUrl;
  let playbackUrl = sourceUrl;
  let uploadedNew = false;
  try {
    await readBlobToFile(sourceUrl, localPath);
    await inspectVideoFile(localPath, pathname, "", input);
    const playback = await buildPlaybackFile(localPath, dir, input.playbackTimeout);
    if (playback.absolute !== localPath) {
      const stored = await putPrivateFile(`${input.prefix}/play-${Date.now()}.mp4`, playback.absolute, playback.contentType);
      playbackUrl = stored.url;
      uploadedNew = true;
    }
  } catch (error) {
    if (uploadedNew) await removeBlob(playbackUrl);
    await removeBlob(sourceUrl);
    fs.rmSync(dir, { recursive: true, force: true });
    if (error instanceof AppError) throw error;
    throw new AppError("这段视频转成可播放的格式失败");
  }

  let settled = false;
  return {
    localPath,
    playbackUrl,
    finish: async (action, previousUrl) => {
      if (settled) return;
      settled = true;
      try {
        if (action === "discard") {
          if (uploadedNew) await removeBlob(playbackUrl);
          await removeBlob(sourceUrl);
          return;
        }
        if (uploadedNew) await removeBlob(sourceUrl);
        if (previousUrl && previousUrl !== playbackUrl && isRemoteVideoPath(previousUrl)) await removeBlob(previousUrl);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
