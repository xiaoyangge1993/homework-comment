"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { presentSentence } from "@/lib/soe-parse";
import type { StudentAssignmentView } from "@/lib/types";
import { Recorder } from "./Recorder";

export function ReadAlong({
  view,
  recordable,
}: {
  view: StudentAssignmentView;
  recordable: number[];
}) {
  const router = useRouter();
  const done = view.sentences.filter((sentence) => sentence.attempt).length;

  async function upload(sentenceId: number, blob: Blob) {
    const form = new FormData();
    form.set("assignmentId", String(view.id));
    form.set("sentenceId", String(sentenceId));
    const type = blob.type || "audio/webm";
    const ext = type.includes("wav") ? "wav" : type.includes("mp4") ? "mp4" : "webm";
    form.set("file", new File([blob], `read.${ext}`, { type }));
    const response = await fetch("/api/attempts", { method: "POST", body: form });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(body.error || "提交失败");
    router.refresh();
  }

  return (
    <div className="stack">
      <p className="muted">
        已交 {done} / {view.sentences.length} 句。先听标准音，再录音。每句最长 60 秒。
      </p>
      {view.submission?.status === "submitted" ? <p className="ok">作业已交。等老师听完再看点评。</p> : null}
      {view.submission?.status === "accepted" && view.review?.finalText ? (
        <section className="card">
          <h2>老师点评</h2>
          <p>{view.review.finalText}</p>
          {view.review.ttsUrl ? <audio controls preload="none" src={view.review.ttsUrl} /> : null}
        </section>
      ) : null}
      {view.submission?.status === "returned" ? (
        <div className="warn">
          老师请你重录
          {view.submission.returnedSentenceIds.length
            ? `第 ${view.sentences
                .filter((sentence) => view.submission?.returnedSentenceIds.includes(sentence.id))
                .map((sentence) => sentence.idx + 1)
                .join("、")} 句`
            : "被打回的句子"}
          。其他句的分数还留着。
          {view.review?.finalText ? ` ${view.review.finalText}` : ""}
          {view.review?.ttsUrl ? <audio controls preload="none" src={view.review.ttsUrl} /> : null}
        </div>
      ) : null}
      {view.sentences.map((sentence) => {
        const open = recordable.includes(sentence.id);
        return (
          <article key={sentence.id} className="card">
            <h2>第 {sentence.idx + 1} 句</h2>
            <MarkedSentence text={sentence.textEn} rawJson={sentence.attempt?.rawJson ?? null} />
            {sentence.textZh ? <p className="muted">{sentence.textZh}</p> : null}
            {sentence.referenceUrl ? (
              <div>
                <p className="muted">老师标准音</p>
                <audio controls preload="none" src={sentence.referenceUrl} />
              </div>
            ) : (
              <p className="muted">老师这句没录标准音，可以直接读。</p>
            )}
            {sentence.attempt ? (
              <div>
                <p className="muted">我的录音</p>
                <audio controls preload="none" src={sentence.attempt.audioUrl} />
                <ScoreLine attempt={sentence.attempt} />
                {view.submission?.status !== "accepted" && sentence.attempt.accuracy == null ? (
                  <RetryButton attemptId={sentence.attempt.id} />
                ) : null}
              </div>
            ) : null}
            {open ? (
              <Recorder submitLabel={sentence.attempt ? "重新提交这一句" : "提交这一句"} onSubmit={(blob) => upload(sentence.id, blob)} />
            ) : sentence.attempt ? (
              <p className="muted">这句已经交上。老师打回后才能重录。</p>
            ) : (
              <p className="muted">这句现在不能录。</p>
            )}
          </article>
        );
      })}
    </div>
  );
}

function ScoreLine({ attempt }: { attempt: NonNullable<StudentAssignmentView["sentences"][number]["attempt"]> }) {
  if (attempt.accuracy == null && attempt.fluency == null && attempt.completion == null) {
    let message = "已保存。还没有评测分数。";
    if (attempt.rawJson) {
      try {
        const parsed = JSON.parse(attempt.rawJson) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        message = "已保存。评测结果还不能显示。";
      }
    }
    return (
      <p className="warn">
        {message}
        {attempt.rhythm ? ` 节奏：${attempt.rhythm}` : ""}
      </p>
    );
  }
  return (
    <p>
      准确度 {formatScore(attempt.accuracy)} · 流利度 {formatScore(attempt.fluency)} · 完整度 {formatScore(attempt.completion)}
      {attempt.rhythm ? ` · 节奏 ${attempt.rhythm}` : ""}
    </p>
  );
}

function formatScore(value: number | null): string {
  if (value == null) return "待人工";
  return String(Math.round(value));
}

function MarkedSentence({ text, rawJson }: { text: string; rawJson: string | null }) {
  const presented = presentSentence(text, rawJson);
  return (
    <>
      <p className="sentence-en">
        {presented.marks.map((mark, index) => (
          <span key={index} className={mark.kind === "miss" || mark.kind === "wrong" || mark.kind === "oov" ? `mark-${mark.kind}` : undefined}>
            {mark.text}
          </span>
        ))}
      </p>
      {presented.extras.length > 0 ? <p>多读：{presented.extras.join("、")}</p> : null}
    </>
  );
}

function RetryButton({ attemptId }: { attemptId: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const response = await fetch(`/api/attempts/${attemptId}/retry`, { method: "POST" });
          const body = (await response.json()) as { error?: string };
          if (!response.ok) setError(body.error || "重新评测失败");
          setPending(false);
          router.refresh();
        }}
      >
        {pending ? "评测中…" : "重新评测"}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </>
  );
}
