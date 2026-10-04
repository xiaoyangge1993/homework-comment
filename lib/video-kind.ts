export type VideoExt = "mp4" | "webm" | "mov";

export const videoAccept = "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov";

export function videoExtension(filename: string, mime: string): VideoExt | null {
  const type = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  if (type.startsWith("audio/")) return null;
  if (type === "video/mp4") return "mp4";
  if (type === "video/webm") return "webm";
  if (type === "video/quicktime" || type === "video/mov") return "mov";
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext !== "mp4" && ext !== "webm" && ext !== "mov") return null;
  if (type.startsWith("video/") || type === "" || type === "application/octet-stream") return ext;
  return null;
}

export function isVideoUpload(kind: string, filename: string, mime: string): boolean {
  if (kind === "audio") return false;
  if (kind === "video") return true;
  return videoExtension(filename, mime) != null;
}
