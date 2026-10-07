import { videoExtension } from "./video-kind";

function blobHostname(hostname: string): boolean {
  return hostname === "blob.vercel-storage.com" || hostname.endsWith(".blob.vercel-storage.com");
}

export function remoteBlobPathname(blobUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(blobUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  if (!blobHostname(url.hostname)) return null;
  let pathname = url.pathname.replace(/^\/+/, "");
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!pathname || pathname.includes("..") || pathname.includes("\\") || pathname.includes("\0")) return null;
  return pathname;
}

export function isRemoteVideoPath(value: string): boolean {
  return remoteBlobPathname(value) !== null;
}

export function pathnameAllowed(pathname: string, prefix: string): boolean {
  const normal = pathname.replace(/^\/+/, "");
  if (!normal || normal.includes("..") || normal.includes("\\") || normal.includes("\0")) return false;
  const root = prefix.replace(/^\/+|\/+$/g, "");
  if (!root || !normal.startsWith(`${root}/`)) return false;
  return videoExtension(normal, "") !== null;
}

// The URL, the claimed pathname, and the assignment prefix must all name the same object.
export function blobUploadMatches(input: { blobUrl: string; pathname: string; prefix: string }): string | null {
  const fromUrl = remoteBlobPathname(input.blobUrl);
  if (!fromUrl) return null;
  const given = input.pathname.replace(/^\/+/, "");
  if (given !== fromUrl) return null;
  if (!pathnameAllowed(given, input.prefix)) return null;
  return fromUrl;
}
