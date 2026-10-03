import { createHmac, randomInt, randomUUID } from "crypto";
import { limits } from "./config";

export const EVALUATION_NOT_CONFIGURED = "评测未配置";

export function soeConfigured(): boolean {
  return Boolean(process.env.TENCENT_SECRET_ID && process.env.TENCENT_SECRET_KEY && process.env.TENCENT_SOE_APPID);
}

export function buildSoeUrl(refText: string, now = Math.floor(Date.now() / 1000)): { url: string; signSource: string } {
  const appId = process.env.TENCENT_SOE_APPID ?? "";
  const secretId = process.env.TENCENT_SECRET_ID ?? "";
  const secretKey = process.env.TENCENT_SECRET_KEY ?? "";
  const params: Record<string, string> = {
    eval_mode: "1",
    expired: String(now + 24 * 60 * 60),
    nonce: String(randomInt(1, 1_000_000_000)),
    rec_mode: "1",
    ref_text: refText,
    score_coeff: String(limits.soeScoreCoeff),
    secretid: secretId,
    sentence_info_enabled: "0",
    server_engine_type: "16k_en",
    text_mode: "0",
    timestamp: String(now),
    voice_format: "1",
    voice_id: randomUUID(),
  };
  const query = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  const signSource = `soe.cloud.tencent.com/soe/api/${appId}?${query}`;
  const signature = createHmac("sha1", secretKey).update(signSource).digest("base64");
  const encoded = Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
  return {
    signSource,
    url: `wss://soe.cloud.tencent.com/soe/api/${appId}?${encoded}&signature=${encodeURIComponent(signature)}`,
  };
}
