import "server-only";

import "./ws-env";
import WebSocket from "ws";
import { parseEvaluation, type ParsedScores } from "./soe-parse";
import { buildSoeUrl, EVALUATION_NOT_CONFIGURED, soeConfigured } from "./soe-sign";

export { EVALUATION_NOT_CONFIGURED, soeConfigured };

type SoeCall = { scores: ParsedScores; raw: unknown };

export function evaluateWav(refText: string, wav: Buffer): Promise<SoeCall> {
  if (!soeConfigured()) {
    return Promise.resolve({
      scores: { ok: false, error: EVALUATION_NOT_CONFIGURED, accuracy: null, fluency: null, completion: null, words: [] },
      raw: { error: EVALUATION_NOT_CONFIGURED },
    });
  }
  const { url } = buildSoeUrl(refText);
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let opened = false;
    let latest: unknown = null;
    let settled = false;
    const finish = (raw: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      const scores = parseEvaluation(raw);
      const preset =
        raw && typeof raw === "object" && typeof (raw as { error?: unknown }).error === "string"
          ? (raw as { error: string }).error
          : null;
      if (!scores.ok && preset) scores.error = preset;
      resolve({ scores, raw: scores.ok ? raw : { error: scores.error ?? preset ?? "评测失败", result: raw } });
    };
    const timer = setTimeout(() => finish({ error: "评测超时", result: latest }), 25000);
    ws.on("error", () => finish({ error: "评测连接失败", result: latest }));
    ws.on("close", () => {
      if (!settled) finish(latest ?? { error: "评测连接已断开" });
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      let message: { code?: number; message?: string; result?: unknown; final?: number };
      try {
        message = JSON.parse(data.toString()) as typeof message;
      } catch {
        return;
      }
      if (message.code && message.code !== 0) {
        finish({ error: message.message || "评测失败", result: message });
        return;
      }
      if (message.result) latest = message;
      if (!opened && message.code === 0 && !message.result && message.final !== 1) {
        opened = true;
        try {
          ws.send(wav);
          ws.send(JSON.stringify({ type: "end" }));
        } catch {
          finish({ error: "评测发送失败", result: latest });
        }
      }
      if (message.final === 1) finish(latest ?? message);
    });
  });
}
