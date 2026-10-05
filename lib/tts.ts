import "server-only";

import { randomUUID } from "crypto";
import { saveAudio } from "./audio";
import { limits } from "./config";
import { getDb } from "./db";
import { tc3Authorization } from "./tts-sign";

export function ttsConfigured(): boolean {
  return Boolean(process.env.TENCENT_SECRET_ID && process.env.TENCENT_SECRET_KEY);
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) throw new Error("语音合成未配置");
  const voice = Number(process.env.TENCENT_TTS_VOICE_TYPE || 101001);
  const payload = JSON.stringify({
    Text: text,
    SessionId: randomUUID(),
    Volume: 0,
    Speed: limits.ttsSpeed,
    ProjectId: 0,
    ModelType: 1,
    VoiceType: Number.isInteger(voice) ? voice : 101001,
    PrimaryLanguage: 1,
    SampleRate: 16000,
    Codec: "mp3",
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const host = "tts.tencentcloudapi.com";
  const authorization = tc3Authorization({ secretId, secretKey, payload, timestamp, host });
  const response = await fetch(`https://${host}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8",
      "X-TC-Action": "TextToVoice",
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": "2019-08-23",
      "X-TC-Region": "ap-guangzhou",
    },
    body: payload,
  });
  const body = (await response.json()) as {
    Response?: { Audio?: string; Error?: { Code?: string; Message?: string } };
  };
  const audio = body.Response?.Audio;
  if (!audio) throw new Error(ttsErrorMessage(body.Response?.Error));
  return Buffer.from(audio, "base64");
}

function ttsErrorMessage(error: { Code?: string; Message?: string } | undefined): string {
  const code = error?.Code ?? "";
  if (code === "UnsupportedOperation.PkgExhausted") return "语音合成资源包已用完";
  if (code.startsWith("AuthFailure")) return "语音合成未授权，请让主账号给这个密钥开通语音合成";
  return error?.Message || "语音合成失败";
}

export async function attachSpeech(submissionId: number, text: string): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed || !ttsConfigured()) return null;
  if (trimmed.length > 150) return "点评超过语音合成长度，文字已经保存";
  try {
    const audio = await synthesizeSpeech(trimmed);
    const relative = saveAudio(`tts/${submissionId}`, "comment.mp3", audio);
    const db = await getDb();
    await db.prepare("UPDATE review SET tts_audio_path = ? WHERE submission_id = ?").run(relative, submissionId);
    return null;
  } catch (error) {
    console.error(error);
    return error instanceof Error ? error.message : "语音合成失败";
  }
}
