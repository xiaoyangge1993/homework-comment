import { upload, uploadPresigned } from "@vercel/blob/client";
import { videoExtension } from "./video-kind";
import { BLOB_NOT_CONFIGURED, readJson } from "./response-error";

const MULTIPART_FROM = 50 * 1024 * 1024;

export type VideoUploadMode = { enabled: boolean; direct: boolean; presigned: boolean };

export async function videoUploadMode(): Promise<VideoUploadMode> {
  const response = await fetch("/api/blob/client", { cache: "no-store" });
  const mode = await readJson<VideoUploadMode>(response, "视频上传还没准备好");
  return { enabled: Boolean(mode.enabled), direct: Boolean(mode.direct), presigned: Boolean(mode.presigned) };
}

function contentTypeFor(file: File): string | null {
  const type = file.type.toLowerCase().split(";")[0]?.trim() ?? "";
  if (type === "video/mp4" || type === "video/webm" || type === "video/quicktime") return type;
  const ext = videoExtension(file.name, type) ?? videoExtension(file.name, "");
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  if (ext === "mp4") return "video/mp4";
  return null;
}

function safeVideoName(name: string): string {
  const base = (name.split(/[/\\]/).pop() || "clip.mp4").replace(/[^\w.\-]+/g, "_");
  const ext = base.toLowerCase().match(/\.(mp4|webm|mov)$/)?.[0] ?? ".mp4";
  const stem = base.slice(0, base.toLowerCase().endsWith(ext) ? base.length - ext.length : undefined).replace(/^\.+/, "");
  return `${stem || "clip"}${ext}`;
}

export async function uploadVideoToBlob(
  file: File,
  input: { kind: "demo" | "attempt"; assignmentId: number; sentenceId?: number; presigned: boolean },
): Promise<{ url: string; pathname: string }> {
  const contentType = contentTypeFor(file);
  if (!contentType) throw new Error(input.kind === "demo" ? "布置视频只接受 mp4、webm、mov" : "这句视频只接受 mp4、webm、mov");
  const folder = input.kind === "demo" ? "demo" : "attempt";
  const send = input.presigned ? uploadPresigned : upload;
  try {
    const blob = await send(`${folder}/${input.assignmentId}/${safeVideoName(file.name)}`, file, {
      access: "private",
      handleUploadUrl: "/api/blob/client",
      contentType,
      clientPayload: JSON.stringify({
        kind: input.kind,
        assignmentId: input.assignmentId,
        sentenceId: input.sentenceId,
      }),
      multipart: file.size > MULTIPART_FROM,
    });
    return { url: blob.url, pathname: blob.pathname };
  } catch {
    throw new Error("视频没有传上去");
  }
}

export async function requireVideoMode(): Promise<VideoUploadMode> {
  const mode = await videoUploadMode();
  if (!mode.enabled && !mode.direct) throw new Error(BLOB_NOT_CONFIGURED);
  return mode;
}
