"use client";

import { useEffect, useRef, useState } from "react";
import { videoAccept } from "@/lib/video-kind";

function videoMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const types = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm", "video/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function VideoCapture({
  maxSeconds,
  maxBytes,
  tooBig,
  disabled,
  onSubmit,
}: {
  maxSeconds: number;
  maxBytes: number;
  tooBig: string;
  disabled?: boolean;
  onSubmit: (file: File) => Promise<void>;
}) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function submit(file: File) {
    if (file.size > maxBytes) {
      setError(tooBig);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit(file);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "视频提交失败");
    } finally {
      setPending(false);
    }
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
  }

  function stop() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setRecording(false);
  }

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("这个浏览器不能直接录像，请从相册或文件选择。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        previewRef.current.muted = true;
        await previewRef.current.play();
      }
      const mime = videoMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mime || "video/webm";
        const ext = type.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(chunksRef.current, { type });
        stopStream();
        void submit(new File([blob], `clip.${ext}`, { type }));
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      timerRef.current = window.setTimeout(() => stop(), maxSeconds * 1000);
    } catch {
      stopStream();
      setRecording(false);
      setError("这个浏览器不能直接录像，请从相册或文件选择。");
    }
  }

  return (
    <div className="stack">
      <video ref={previewRef} className={recording ? "live-preview" : "live-preview hidden"} playsInline muted />
      <div className="recorder">
        {recording ? (
          <button type="button" className="btn danger" disabled={disabled || pending} onClick={stop}>
            停止
          </button>
        ) : (
          <button type="button" className="btn" disabled={disabled || pending} onClick={() => void start()}>
            现场录像
          </button>
        )}
        <button type="button" className="btn" disabled={disabled || pending || recording} onClick={() => fileRef.current?.click()}>
          从相册或文件选择
        </button>
        <span className="muted">{pending ? "正在处理视频…" : recording ? `最长 ${maxSeconds} 秒` : null}</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={videoAccept}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void submit(file);
        }}
      />
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
