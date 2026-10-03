"use client";

import { useEffect, useRef, useState } from "react";
import { limits } from "@/lib/config";

type Props = {
  onSubmit: (blob: Blob) => Promise<void>;
  submitLabel?: string;
  disabled?: boolean;
};

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function Recorder({ onSubmit, submitLabel = "保存录音", disabled }: Props) {
  const maxSeconds = limits.maxRecordSeconds;
  const [state, setState] = useState<"idle" | "recording" | "preview" | "saving">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [previewUrl]);

  function stop() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("这个浏览器不能录音。请用手机上的 Chrome 或 Safari。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      const mime = pickMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        blobRef.current = blob;
        setPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return URL.createObjectURL(blob);
        });
        setState("preview");
        stream.getTracks().forEach((track) => track.stop());
      };
      recorderRef.current = recorder;
      recorder.start();
      setSeconds(0);
      setState("recording");
      const started = Date.now();
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.min(maxSeconds, Math.floor((Date.now() - started) / 1000));
        setSeconds(elapsed);
        if (elapsed >= maxSeconds) stop();
      }, 200);
    } catch {
      setError("无法使用麦克风。请允许浏览器录音后再试。");
    }
  }

  async function save() {
    if (!blobRef.current) return;
    setState("saving");
    setError(null);
    try {
      await onSubmit(blobRef.current);
      blobRef.current = null;
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      setState("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
      setState("preview");
    }
  }

  return (
    <div className="recorder">
      {state === "recording" ? (
        <button type="button" className="btn danger" onClick={stop}>
          停止（{seconds}s / {maxSeconds}s）
        </button>
      ) : (
        <button type="button" className="btn" onClick={start} disabled={disabled || state === "saving"}>
          {previewUrl ? "重录" : "录音"}
        </button>
      )}
      {previewUrl && state !== "recording" ? (
        <>
          <audio controls src={previewUrl} />
          <button type="button" className="btn primary" onClick={save} disabled={disabled || state === "saving"}>
            {state === "saving" ? "保存中…" : submitLabel}
          </button>
        </>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
