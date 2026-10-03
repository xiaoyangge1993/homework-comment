import "server-only";

import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { dataDir } from "./db";

export function audioRoot(): string {
  return path.join(dataDir(), "audio");
}

function safeExtension(filename: string): string {
  const match = filename.toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  const ext = match?.[1] ?? "webm";
  if (["webm", "wav", "mp3", "mp4", "m4a", "ogg", "mpeg"].includes(ext)) return `.${ext}`;
  return ".webm";
}

export function saveAudio(subdir: string, filename: string, bytes: Buffer): string {
  const name = `${Date.now()}-${randomBytes(4).toString("hex")}${safeExtension(filename)}`;
  const dir = path.join(audioRoot(), subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), bytes);
  return path.posix.join(subdir, name);
}

export function resolveAudio(relativePath: string): string | null {
  if (!relativePath || relativePath.includes("\0")) return null;
  const root = path.resolve(audioRoot());
  const full = path.resolve(root, relativePath);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(full)) return null;
  return full;
}

export function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".webm":
      return "audio/webm";
    case ".wav":
      return "audio/wav";
    case ".mp3":
    case ".mpeg":
      return "audio/mpeg";
    case ".mp4":
    case ".m4a":
      return "audio/mp4";
    case ".ogg":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}

export function audioResponse(relativePath: string): Response {
  const full = resolveAudio(relativePath);
  if (!full) return new Response("找不到音频", { status: 404 });
  const bytes = fs.readFileSync(full);
  return new Response(bytes, {
    headers: {
      "Content-Type": contentTypeFor(full),
      "Cache-Control": "private, no-store",
    },
  });
}
