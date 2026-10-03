import { createHash, createHmac } from "crypto";

export function tc3Authorization(input: {
  secretId: string;
  secretKey: string;
  payload: string;
  timestamp: number;
  host?: string;
  service?: string;
}): string {
  const host = input.host ?? "tts.tencentcloudapi.com";
  const service = input.service ?? "tts";
  const date = new Date(input.timestamp * 1000).toISOString().slice(0, 10);
  const hashedPayload = createHash("sha256").update(input.payload).digest("hex");
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${input.timestamp}\n${credentialScope}\n${createHash("sha256").update(canonicalRequest).digest("hex")}`;
  const secretDate = createHmac("sha256", `TC3${input.secretKey}`).update(date).digest();
  const secretService = createHmac("sha256", secretDate).update(service).digest();
  const secretSigning = createHmac("sha256", secretService).update("tc3_request").digest();
  const signature = createHmac("sha256", secretSigning).update(stringToSign).digest("hex");
  return `TC3-HMAC-SHA256 Credential=${input.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}
