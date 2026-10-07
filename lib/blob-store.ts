import "server-only";

import { del, get, issueSignedToken, presignUrl, put } from "@vercel/blob";
import fs from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { readEnv } from "./env";
import { AppError } from "./errors";
import { remoteBlobPathname } from "./blob-path";

const SIGNED_URL_MS = 60 * 60 * 1000;

export function blobConfigured(): boolean {
  return Boolean(readEnv("BLOB_READ_WRITE_TOKEN"));
}

export function videoStorageMode(): { enabled: boolean; direct: boolean } {
  const enabled = blobConfigured();
  return { enabled, direct: !enabled && !process.env.VERCEL };
}

export async function readBlobToFile(blobUrl: string, absolute: string): Promise<void> {
  const result = await get(blobUrl, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) throw new AppError("找不到上传的视频");
  await pipeline(
    Readable.fromWeb(result.stream as import("stream/web").ReadableStream),
    fs.createWriteStream(absolute),
  );
}

export async function putPrivateFile(
  pathname: string,
  absolute: string,
  contentType: string,
): Promise<{ url: string; pathname: string }> {
  const size = fs.statSync(absolute).size;
  const blob = await put(pathname, fs.createReadStream(absolute), {
    access: "private",
    contentType,
    addRandomSuffix: true,
    multipart: size > 4 * 1024 * 1024,
  });
  return { url: blob.url, pathname: blob.pathname };
}

export async function removeBlob(urlOrPathname: string): Promise<void> {
  try {
    await del(urlOrPathname);
  } catch {
    /* the object is already gone */
  }
}

export async function signedVideoRedirect(blobUrl: string): Promise<Response> {
  const pathname = remoteBlobPathname(blobUrl);
  if (!pathname) return new Response("找不到视频", { status: 404 });
  try {
    const validUntil = Date.now() + SIGNED_URL_MS;
    const signed = await issueSignedToken({ pathname, operations: ["get"], validUntil });
    const { presignedUrl } = await presignUrl(signed, {
      access: "private",
      operation: "get",
      pathname,
      validUntil,
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: presignedUrl,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error(error);
    return new Response("找不到视频", { status: 404 });
  }
}
