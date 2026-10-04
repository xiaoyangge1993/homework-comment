import { createHmac, timingSafeEqual } from "crypto";
import { AppError } from "./errors";
import { missingEnvMessage, readEnv } from "./env";

function secret(): string {
  const value = readEnv("SESSION_SECRET");
  if (!value) throw new AppError(missingEnvMessage("SESSION_SECRET"));
  return value;
}

export function signSession(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function readSession<T>(token: string | undefined): T | null {
  if (!token || !readEnv("SESSION_SECRET")) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
