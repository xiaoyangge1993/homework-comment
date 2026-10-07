export type PlaybackAction = "remux-mp4" | "keep-webm" | "transcode-mp4";

export function codecFromFfmpegLog(log: string): string | null {
  const match = log.match(/Video:\s*([A-Za-z0-9]+)/);
  return match ? match[1].toLowerCase() : null;
}

// H.264 is remuxed so the moov atom sits at the front. HEVC from phone albums does not play in Chrome.
export function playbackAction(codec: string | null, container: string): PlaybackAction {
  const name = (codec ?? "").trim().toLowerCase();
  const ext = container.toLowerCase().replace(/^\./, "");
  if (name === "h264" || name === "avc" || name === "avc1") return "remux-mp4";
  if ((name === "vp8" || name === "vp9") && ext === "webm") return "keep-webm";
  return "transcode-mp4";
}
