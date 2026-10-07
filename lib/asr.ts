import "server-only";

import { randomUUID } from "crypto";
import { tc3Authorization } from "./tts-sign";

export async function recognizeEnglish(wav: Buffer, timeoutMs = 8000): Promise<{ text: string | null; raw: unknown }> {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) return { text: null, raw: { error: "语音识别未配置" } };
  const payload = JSON.stringify({
    ProjectId: 0,
    SubServiceType: 2,
    EngSerViceType: "16k_en",
    SourceType: 1,
    VoiceFormat: "wav",
    Data: wav.toString("base64"),
    DataLen: wav.length,
    UsrAudioKey: randomUUID(),
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const host = "asr.tencentcloudapi.com";
  const authorization = tc3Authorization({ secretId, secretKey, payload, timestamp, host, service: "asr" });
  try {
    const response = await fetch(`https://${host}`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json; charset=utf-8",
        "X-TC-Action": "SentenceRecognition",
        "X-TC-Timestamp": String(timestamp),
        "X-TC-Version": "2019-06-14",
        "X-TC-Region": "ap-shanghai",
      },
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await response.json()) as { Response?: { Result?: unknown; Error?: { Message?: string } } };
    const result = body.Response?.Result;
    if (typeof result === "string") return { text: result, raw: body };
    const message = body.Response?.Error?.Message || "语音识别失败";
    return { text: null, raw: { error: message, response: body } };
  } catch {
    return { text: null, raw: { error: "语音识别失败" } };
  }
}
