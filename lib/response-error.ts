export const PAYLOAD_TOO_LARGE = "视频超过线上单次上传限制，没有保存";
export const BLOB_NOT_CONFIGURED = "线上视频存储还没配置。请在 Vercel 添加 Private Blob，设置 BLOB_READ_WRITE_TOKEN，然后重新部署。";

export function messageFromBody(status: number, text: string, fallback: string): string {
  const trimmed = text.trim();
  if (status === 413 || trimmed.startsWith("Request Entity Too Large")) return PAYLOAD_TOO_LARGE;
  try {
    const payload = JSON.parse(trimmed) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error) return payload.error;
  } catch {
    /* the platform sometimes returns plain text */
  }
  return fallback;
}

export async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) throw new Error(messageFromBody(response.status, text, fallback));
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(messageFromBody(response.status, text, fallback));
  }
}
