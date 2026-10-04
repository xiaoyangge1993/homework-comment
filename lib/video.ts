import "server-only";

import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { audioRoot } from "./audio";
import { dataDir } from "./db";
import { AppError } from "./errors";
import { commandWorks, durationSeconds, transcodeWav } from "./media";
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

export async function acceptVideoUpload(input: {
  subdir: string;
  filename: string;
  mime: string;
  bytes: Buffer;
  maxBytes: number;
  maxSeconds: number;
  badType: string;
  tooBig: string;
  tooLong: string;
  unreadable: string;
  missingFfmpeg: string;
}): Promise<{ relative: string; absolute: string }> {
  const ext = videoExtension(input.filename, input.mime) ?? videoExtension(input.filename, "");
  if (!ext) throw new AppError(input.badType);
  if (input.bytes.length > input.maxBytes) throw new AppError(input.tooBig);
  if (!(await commandWorks("ffmpeg"))) throw new AppError(input.missingFfmpeg);
  const stored = saveVideoFile(input.subdir, ext, input.bytes);
  const seconds = await durationSeconds(stored.absolute);
  if (!seconds) {
    removeFile(stored.absolute);
    throw new AppError(input.unreadable);
  }
  if (seconds > input.maxSeconds) {
    removeFile(stored.absolute);
    throw new AppError(input.tooLong);
  }
  return stored;
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
