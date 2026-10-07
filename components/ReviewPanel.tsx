"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewSentence } from "@/lib/types";
import { intonationLabel } from "@/lib/intonation";
import { storedError } from "@/lib/soe-parse";
import { MarkedSentence } from "./MarkedSentence";

export function ReviewPanel({
  submissionId,
  draftText,
  sentences,
  speechReady,
  intonationEnabled,
}: {
  submissionId: number;
  draftText: string;
  sentences: ReviewSentence[];
  speechReady: boolean;
  intonationEnabled: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(draftText);
  const [picked, setPicked] = useState<number[]>([]);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const visible = onlyProblems ? sentences.filter((sentence) => sentence.needsListen) : sentences;

  async function send(path: string, body: unknown) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string; speechError?: string | null };
      if (!response.ok) throw new Error(payload.error || "操作失败");
      if (payload.speechError) setError(`文字已保存。语音合成失败：${payload.speechError}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      {intonationEnabled ? null : <p className="muted">语调未启用</p>}
      <label className="row">
        <input type="checkbox" checked={onlyProblems} onChange={(event) => setOnlyProblems(event.target.checked)} />
        只看要听的句子
      </label>
      {visible.map((sentence) => (
        <ReviewSentenceCard
          key={sentence.id}
          sentence={sentence}
          picked={picked.includes(sentence.id)}
          onToggle={(checked) =>
            setPicked((current) => (checked ? [...current, sentence.id] : current.filter((id) => id !== sentence.id)))
          }
        />
      ))}
      <section className="review-dock">
        <label>
          点评
          <textarea value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={pending}
            onClick={() => void send(`/api/submissions/${submissionId}/accept`, { mode: "draft" })}
          >
            通过并发送
          </button>
          <button
            type="button"
            className="btn"
            disabled={pending || !text.trim()}
            onClick={() => void send(`/api/submissions/${submissionId}/accept`, { mode: "edited", text })}
          >
            修改后发送
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={pending || picked.length === 0}
            onClick={() => void send(`/api/submissions/${submissionId}/return`, { sentenceIds: picked, text })}
          >
            打回选中的句子
          </button>
          {speechReady ? null : (
            <button type="button" className="btn" disabled>
              语音合成未配置
            </button>
          )}
        </div>
        {error ? <p className="error">{error}</p> : null}
      </section>
    </div>
  );
}

function ReviewSentenceCard({
  sentence,
  picked,
  onToggle,
}: {
  sentence: ReviewSentence;
  picked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const attempt = sentence.attempt;
  const tone = intonationLabel(attempt?.intonationStatus ?? null, attempt?.teacherFinal ?? null);

  function seek(seconds: number) {
    const player = videoRef.current;
    if (!player) return;
    player.currentTime = seconds;
    void player.play();
  }

  return (
    <article className={sentence.needsListen ? "card listen-card" : "card"}>
      <div className="sentence-head">
        <h2>第 {sentence.index} 句</h2>
        <div className="sentence-tags">
          {tone ? <span className={tone === "无法判断" ? "pill uncertain" : "pill"}>{tone}</span> : null}
          {sentence.needsListen ? <span className="pill listen">建议亲听</span> : <span className="pill pass">可过</span>}
        </div>
      </div>
      <MarkedSentence text={sentence.textEn} rawJson={attempt?.rawJson ?? null} onSeek={attempt?.videoUrl ? seek : undefined} />
      {sentence.textZh ? <p className="muted">{sentence.textZh}</p> : null}
      {sentence.referenceUrl ? (
        <div>
          <p className="muted">标准音</p>
          <audio controls preload="none" src={sentence.referenceUrl} onPlay={pauseCardMates} />
        </div>
      ) : null}
      {attempt?.videoUrl ? (
        <div>
          <p className="muted">学生视频</p>
          <video ref={videoRef} controls playsInline preload="metadata" src={attempt.videoUrl} />
          <ScoreLine attempt={attempt} />
        </div>
      ) : attempt?.audioUrl ? (
        <div>
          <p className="muted">学生录音</p>
          <audio controls preload="none" src={attempt.audioUrl} />
          <ScoreLine attempt={attempt} />
        </div>
      ) : (
        <p className="warn">这句还没有录音</p>
      )}
      <label className="row">
        <input type="checkbox" checked={picked} onChange={(event) => onToggle(event.target.checked)} />
        打回这一句
      </label>
    </article>
  );
}

function pauseCardMates(event: { currentTarget: HTMLMediaElement }) {
  const card = event.currentTarget.closest("article");
  if (!card) return;
  for (const node of card.querySelectorAll("audio, video")) {
    if (node !== event.currentTarget) (node as HTMLMediaElement).pause();
  }
}

function ScoreLine({ attempt }: { attempt: NonNullable<ReviewSentence["attempt"]> }) {
  if (attempt.accuracy == null && attempt.fluency == null && attempt.completion == null) {
    const message = storedError(attempt.rawJson) ?? "待人工";
    return (
      <p className="score-line warn">
        {message}
        {attempt.rhythm ? ` · 节奏 ${attempt.rhythm}` : ""}
      </p>
    );
  }
  return (
    <p className="score-line">
      准确度 {show(attempt.accuracy)} · 流利度 {show(attempt.fluency)} · 完整度 {show(attempt.completion)}
      {attempt.rhythm ? ` · 节奏 ${attempt.rhythm}` : " · 节奏 —"}
    </p>
  );
}

function show(value: number | null): string {
  if (value == null) return "待人工";
  return String(Math.round(value));
}
