import "server-only";

import { del, get, issueSignedToken, presignUrl, put } from "@vercel/blob";
import fs from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { videoStorageFromEnv, type VideoStorageMode } from "./blob-mode";
import { readEnv } from "./env";
import { AppError } from "./errors";
import { remoteBlobPathname } from "./blob-path";

const SIGNED_URL_MS = 60 * 60 * 1000;

export function videoStorageMode(): VideoStorageMode {
  return videoStorageFromEnv({
    storeId: readEnv("BLOB_STORE_ID"),
    token: readEnv("BLOB_READ_WRITE_TOKEN"),
    webhookKey: readEnv("BLOB_WEBHOOK_PUBLIC_KEY"),
    vercel: process.env.VERCEL,
  });
}

export function blobConfigured(): boolean {
  return videoStorageMode().enabled;
}

export async function readBlobToFile(blobUrl: string, absolute: string): Promise<void> {
  const result = await get(blobUrl, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) throw new AppError("找不到上传的视频");
  await pipeline(
    Readable.fromWeb(result.stream as import("stream/web").ReadableStream),
    fs.createWriteStream(absolute),
  );
}

export async function putPrivateBytes(
  pathname: string,
  bytes: Buffer,
  contentType: string,
): Promise<{ url: string; pathname: string }> {
  const blob = await put(pathname, bytes, {
    access: "private",
    contentType,
    addRandomSuffix: true,
  });
  return { url: blob.url, pathname: blob.pathname };
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

export async function signedBlobRedirect(blobUrl: string, missing: string): Promise<Response> {
  const pathname = remoteBlobPathname(blobUrl);
  if (!pathname) return new Response(missing, { status: 404 });
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
    return new Response(missing, { status: 404 });
  }
}

export async function signedVideoRedirect(blobUrl: string): Promise<Response> {
  return signedBlobRedirect(blobUrl, "找不到视频");
}
