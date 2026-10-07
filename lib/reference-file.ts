import "server-only";

import fs from "fs";
import os from "os";
import path from "path";
import { resolveAudio } from "./audio";
import { isRemoteVideoPath } from "./blob-path";
import { readBlobToFile } from "./blob-store";

export async function openReferenceFile(stored: string | null): Promise<{ absolute: string | null; close: () => void }> {
  if (!stored) return { absolute: null, close: () => undefined };
  if (!isRemoteVideoPath(stored)) return { absolute: resolveAudio(stored), close: () => undefined };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hw-ref-"));
  const ext = path.extname(new URL(stored).pathname) || ".webm";
  const absolute = path.join(dir, `reference${ext}`);
  try {
    await readBlobToFile(stored, absolute);
  } catch {
    fs.rmSync(dir, { recursive: true, force: true });
    return { absolute: null, close: () => undefined };
  }
  return {
    absolute,
    close: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
