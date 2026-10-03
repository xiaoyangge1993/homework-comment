"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { limits } from "@/lib/config";
import type { SentenceDTO } from "@/lib/types";
import { countWords } from "@/lib/sentences";
import { Recorder } from "./Recorder";

export function SentenceEditor({ assignmentId, initial }: { assignmentId: number; initial: SentenceDTO[] }) {
  const router = useRouter();
  const [sentences, setSentences] = useState(initial);
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(initial.map((sentence) => [sentence.id, { textEn: sentence.textEn, textZh: sentence.textZh }])),
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function replace(next: SentenceDTO[]) {
    setSentences(next);
    setDrafts(Object.fromEntries(next.map((sentence) => [sentence.id, { textEn: sentence.textEn, textZh: sentence.textZh }])));
  }

  async function mutate(body: unknown) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/assignments/${assignmentId}/sentences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { sentences?: SentenceDTO[]; error?: string };
      if (!response.ok || !payload.sentences) throw new Error(payload.error || "保存失败");
      replace(payload.sentences);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setPending(false);
    }
  }

  async function upload(sentenceId: number, blob: Blob) {
    const form = new FormData();
    form.set("sentenceId", String(sentenceId));
    const type = blob.type || "audio/webm";
    const ext = type.includes("wav") ? "wav" : type.includes("mp4") ? "mp4" : "webm";
    form.set("file", new File([blob], `reference.${ext}`, { type }));
    const response = await fetch(`/api/assignments/${assignmentId}/reference`, { method: "POST", body: form });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(payload.error || "标准音保存失败");
    setMessage("标准音已保存");
    router.refresh();
    const refreshed = await fetch(`/api/assignments/${assignmentId}`);
    const detail = (await refreshed.json()) as { sentences?: SentenceDTO[]; error?: string };
    if (!refreshed.ok || !detail.sentences) throw new Error(detail.error || "刷新失败");
    replace(detail.sentences);
  }

  async function publish() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/assignments/${assignmentId}/publish`, { method: "POST" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "发布失败");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发布失败");
      setPending(false);
    }
  }

  const blocked = sentences.some((sentence) => sentence.tooLong || sentence.wordCount === 0);

  return (
    <div className="stack">
      {sentences.map((sentence, index) => {
        const draft = drafts[sentence.id] ?? { textEn: sentence.textEn, textZh: sentence.textZh };
        const words = countWords(draft.textEn);
        const long = words > limits.maxWordsPerSentence;
        return (
          <article key={sentence.id} className={long ? "card too-long" : "card"}>
            <div className="sentence-head">
              <h2>第 {index + 1} 句</h2>
              <span className="count">{words} 词{long ? "，需要拆开" : ""}</span>
            </div>
            <label>
              英文
              <textarea
                className="passage"
                value={draft.textEn}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [sentence.id]: { ...draft, textEn: event.target.value } }))
                }
              />
            </label>
            <label>
              中文
              <textarea
                value={draft.textZh}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [sentence.id]: { ...draft, textZh: event.target.value } }))
                }
              />
            </label>
            <div className="row">
              <button
                type="button"
                className="btn"
                disabled={pending}
                onClick={() => mutate({ action: "update", sentenceId: sentence.id, textEn: draft.textEn, textZh: draft.textZh })}
              >
                保存文字
              </button>
              <button
                type="button"
                className="btn"
                disabled={pending || index === sentences.length - 1}
                onClick={() => mutate({ action: "merge", sentenceId: sentence.id })}
              >
                与下一句合并
              </button>
              <button type="button" className="btn" disabled={pending} onClick={() => mutate({ action: "split", sentenceId: sentence.id })}>
                拆开
              </button>
            </div>
            {sentence.referenceUrl ? (
              <div className="audio-row">
                <p className="muted">已有标准音。再录一次会换成新的。</p>
                <audio controls preload="none" src={`${sentence.referenceUrl}?v=${sentence.id}`} />
              </div>
            ) : (
              <p className="muted">还没有标准音。可以先发布，看板会提示无节奏参照。</p>
            )}
            <Recorder disabled={pending} submitLabel="保存标准音" onSubmit={(blob) => upload(sentence.id, blob)} />
          </article>
        );
      })}
      {message ? <p className="ok">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <button type="button" className="btn primary" disabled={pending || blocked} onClick={publish}>
        发布作业
      </button>
    </div>
  );
}
