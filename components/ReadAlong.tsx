"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requireVideoMode, uploadVideoToBlob } from "@/lib/client-video";
import { limits } from "@/lib/config";
import { readJson } from "@/lib/response-error";
import type { AttemptView, StudentAssignmentView } from "@/lib/types";
import { MarkedSentence } from "./MarkedSentence";
import { Recorder } from "./Recorder";
import { VideoCapture } from "./VideoCapture";

export function ReadAlong({
  view,
  recordable,
}: {
  view: StudentAssignmentView;
  recordable: number[];
}) {
  const router = useRouter();
  const done = view.sentences.filter((sentence) => sentence.attempt).length;

  async function upload(sentenceId: number, file: File, kind: "audio" | "video") {
    if (kind === "video") {
      const mode = await requireVideoMode();
      if (mode.enabled) {
        const blob = await uploadVideoToBlob(file, { kind: "attempt", assignmentId: view.id, sentenceId });
        const response = await fetch("/api/attempts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignmentId: view.id, sentenceId, blobUrl: blob.url, pathname: blob.pathname }),
        });
        await readJson(response, "提交失败");
        router.refresh();
        return;
      }
    }
    const form = new FormData();
    form.set("assignmentId", String(view.id));
    form.set("sentenceId", String(sentenceId));
    form.set("kind", kind);
    form.set("file", file);
    const response = await fetch("/api/attempts", { method: "POST", body: form });
    await readJson(response, "提交失败");
    router.refresh();
  }

  return (
    <div className="stack">
      <p className="muted">
        已交 {done} / {view.sentences.length} 句。先看老师的示范，再逐句跟读。可以录像、从相册选视频，或只录音。视频最长 60 秒。
      </p>
      {view.demoVideoUrl ? (
        <section className="card">
          <h2>老师的示范</h2>
          <video controls playsInline preload="metadata" src={view.demoVideoUrl} />
        </section>
      ) : (
        <p className="muted">老师这回没有整段示范，直接逐句跟读。</p>
      )}
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
      {view.sentences.map((sentence) => (
        <SentenceCard
          key={sentence.id}
          sentence={sentence}
          open={recordable.includes(sentence.id)}
          accepted={view.submission?.status === "accepted"}
          onUpload={upload}
        />
      ))}
    </div>
  );
}

function SentenceCard({
  sentence,
  open,
  accepted,
  onUpload,
}: {
  sentence: StudentAssignmentView["sentences"][number];
  open: boolean;
  accepted: boolean;
  onUpload: (sentenceId: number, file: File, kind: "audio" | "video") => Promise<void>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const attempt = sentence.attempt;

  function seek(seconds: number) {
    const player = videoRef.current;
    if (!player) return;
    player.currentTime = seconds;
    void player.play();
  }

  return (
    <article className="card">
      <h2>第 {sentence.idx + 1} 句</h2>
      <MarkedSentence text={sentence.textEn} rawJson={attempt?.rawJson ?? null} onSeek={attempt?.videoUrl ? seek : undefined} />
      {sentence.textZh ? <p className="muted">{sentence.textZh}</p> : null}
      {sentence.referenceUrl ? (
        <div>
          <p className="muted">老师标准音</p>
          <audio controls preload="none" src={sentence.referenceUrl} />
        </div>
      ) : (
        <p className="muted">老师这句没录标准音，可以直接读。</p>
      )}
      {attempt ? (
        <div>
          <p className="muted">{attempt.videoUrl ? "我的视频" : "我的录音"}</p>
          {attempt.videoUrl ? (
            <video ref={videoRef} controls playsInline preload="metadata" src={attempt.videoUrl} />
          ) : attempt.audioUrl ? (
            <audio controls preload="none" src={attempt.audioUrl} />
          ) : (
            <p className="warn">这句的文件还在，暂时播不了。</p>
          )}
          <ScoreLine attempt={attempt} />
          {!accepted && attempt.accuracy == null ? <RetryButton attemptId={attempt.id} /> : null}
        </div>
      ) : null}
      {open ? (
        <div className="stack">
          <VideoCapture
            maxSeconds={limits.maxSentenceVideoSeconds}
            maxBytes={limits.maxSentenceVideoBytes}
            tooBig="这句视频不能超过 80MB"
            onSubmit={(file) => onUpload(sentence.id, file, "video")}
          />
          <Recorder
            submitLabel={attempt ? "重新提交这一句" : "只录音并提交"}
            onSubmit={(blob) => onUpload(sentence.id, audioFile(blob), "audio")}
          />
        </div>
      ) : attempt ? (
        <p className="muted">这句已经交上。老师打回后才能重录。</p>
      ) : (
        <p className="muted">这句现在不能录。</p>
      )}
    </article>
  );
}

function audioFile(blob: Blob): File {
  const type = blob.type || "audio/webm";
  const ext = type.includes("wav") ? "wav" : type.includes("mp4") ? "mp4" : "webm";
  return new File([blob], `read.${ext}`, { type });
}

function ScoreLine({ attempt }: { attempt: AttemptView }) {
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
