import "server-only";

import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { audioRoot } from "./audio";
import { dataDir } from "./db";
import { AppError } from "./errors";
import { commandWorks, durationSeconds, remuxFaststart, transcodePlayableMp4, transcodeWav, videoCodec } from "./media";
import { playbackAction } from "./playback-plan";
import { videoExtension, type VideoExt } from "./video-kind";

export function videoRoot(): string {
  return path.join(dataDir(), "video");
}

export function resolveVideo(relativePath: string): string | null {
  if (!relativePath || relativePath.includes("\0")) return null;
  const root = path.resolve(videoRoot());
  const full = path.resolve(root, relativePath);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(full)) return null;
  return full;
}

function videoContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    default:
      return "application/octet-stream";
  }
}

export function videoFileResponse(relativePath: string, request: Request): Response {
  const full = resolveVideo(relativePath);
  if (!full) return new Response("找不到视频", { status: 404 });
  const size = fs.statSync(full).size;
  const headers = {
    "Content-Type": videoContentType(full),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
  const range = request.headers.get("range");
  if (!range) {
    return new Response(Readable.toWeb(fs.createReadStream(full)) as ReadableStream, {
      status: 200,
      headers: { ...headers, "Content-Length": String(size) },
    });
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || size === 0) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (match[1] === "" && match[2]) {
    const suffix = Number(match[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  end = Math.min(end, size - 1);
  return new Response(Readable.toWeb(fs.createReadStream(full, { start, end })) as ReadableStream, {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
    },
  });
}

function saveVideoFile(subdir: string, ext: VideoExt, bytes: Buffer): { relative: string; absolute: string } {
  const name = `${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  const dir = path.join(videoRoot(), subdir);
  fs.mkdirSync(dir, { recursive: true });
  const absolute = path.join(dir, name);
  fs.writeFileSync(absolute, bytes);
  return { relative: path.posix.join(subdir, name), absolute };
}

function removeFile(file: string) {
  try {
    fs.unlinkSync(file);
  } catch {
    /* the rejected upload is already gone */
  }
}

type VideoCheck = {
  maxBytes: number;
  maxSeconds: number;
  badType: string;
  tooBig: string;
  tooLong: string;
  unreadable: string;
  missingFfmpeg: string;
};

async function assertPlayable(absolute: string, input: Pick<VideoCheck, "maxSeconds" | "tooLong" | "unreadable" | "missingFfmpeg">) {
  if (!(await commandWorks("ffmpeg"))) throw new AppError(input.missingFfmpeg);
  const seconds = await durationSeconds(absolute);
  if (!seconds) throw new AppError(input.unreadable);
  if (seconds > input.maxSeconds) throw new AppError(input.tooLong);
}

export async function inspectVideoFile(absolute: string, filename: string, mime: string, input: VideoCheck): Promise<void> {
  const ext = videoExtension(filename, mime) ?? videoExtension(filename, "");
  if (!ext) throw new AppError(input.badType);
  const size = fs.statSync(absolute).size;
  if (size <= 0) throw new AppError(input.badType);
  if (size > input.maxBytes) throw new AppError(input.tooBig);
  await assertPlayable(absolute, input);
}

export async function acceptVideoUpload(input: VideoCheck & {
  subdir: string;
  filename: string;
  mime: string;
  bytes: Buffer;
}): Promise<{ relative: string; absolute: string }> {
  const ext = videoExtension(input.filename, input.mime) ?? videoExtension(input.filename, "");
  if (!ext) throw new AppError(input.badType);
  if (input.bytes.length > input.maxBytes) throw new AppError(input.tooBig);
  const stored = saveVideoFile(input.subdir, ext, input.bytes);
  try {
    await assertPlayable(stored.absolute, input);
  } catch (error) {
    removeFile(stored.absolute);
    throw error;
  }
  return stored;
}

// Phone albums are often HEVC. Chrome paints a broken icon unless the file is H.264 or WebM.
export async function buildPlaybackFile(
  input: string,
  directory: string,
  timeout: number,
): Promise<{ absolute: string; contentType: string }> {
  const ext = path.extname(input).replace(/^\./, "").toLowerCase();
  const action = playbackAction(await videoCodec(input), ext);
  if (action === "keep-webm") return { absolute: input, contentType: "video/webm" };
  const output = path.join(directory, "playback.mp4");
  if (action === "remux-mp4") {
    try {
      await remuxFaststart(input, output, timeout);
      if (fs.existsSync(output) && fs.statSync(output).size > 0) {
        return { absolute: output, contentType: "video/mp4" };
      }
    } catch {
      /* the copy could not move the index forward; encode instead */
    }
  }
  await transcodePlayableMp4(input, output, timeout);
  if (!fs.existsSync(output) || fs.statSync(output).size === 0) {
    throw new AppError("这段视频转成可播放的格式失败");
  }
  return { absolute: output, contentType: "video/mp4" };
}

export async function extractWav(videoAbsolute: string, wavAbsolute: string, timeout: number): Promise<string> {
  fs.mkdirSync(path.dirname(wavAbsolute), { recursive: true });
  try {
    await transcodeWav(videoAbsolute, wavAbsolute, timeout);
  } catch (error) {
    removeFile(wavAbsolute);
    throw error;
  }
  return path.relative(audioRoot(), wavAbsolute).split(path.sep).join("/");
}
