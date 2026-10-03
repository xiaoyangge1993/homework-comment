"use client";

import { useEffect, useRef, useState } from "react";
import { limits } from "@/lib/config";
import { encodePcm16Wav, floatToPcm16, resampleLinear } from "@/lib/wav";

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

function audioContext(): AudioContext | null {
  const ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!ctor) return null;
  return new ctor();
}

export function Recorder({ onSubmit, submitLabel = "保存录音", disabled }: Props) {
  const maxSeconds = limits.maxRecordSeconds;
  const [state, setState] = useState<"idle" | "recording" | "preview" | "saving">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      processorRef.current?.disconnect();
      void contextRef.current?.close();
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [previewUrl]);

  function publish(blob: Blob) {
    blobRef.current = blob;
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(blob);
    });
    setState("preview");
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function finishWav() {
    const context = contextRef.current;
    const chunks = pcmChunksRef.current;
    processorRef.current?.disconnect();
    processorRef.current = null;
    const rate = context?.sampleRate || 16000;
    void context?.close();
    contextRef.current = null;
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    pcmChunksRef.current = [];
    const pcm = floatToPcm16(resampleLinear(merged, rate, 16000));
    const bytes = encodePcm16Wav(pcm, 16000);
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    publish(new Blob([copy], { type: "audio/wav" }));
  }

  function stop() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    if (processorRef.current) {
      finishWav();
      return;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  function beginTimer() {
    setSeconds(0);
    setState("recording");
    const started = Date.now();
    timerRef.current = window.setInterval(() => {
      const elapsed = Math.min(maxSeconds, Math.floor((Date.now() - started) / 1000));
      setSeconds(elapsed);
      if (elapsed >= maxSeconds) stop();
    }, 200);
  }

  function startWav(stream: MediaStream): boolean {
    const context = audioContext();
    if (!context?.createScriptProcessor) return false;
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const mute = context.createGain();
    mute.gain.value = 0;
    pcmChunksRef.current = [];
    processor.onaudioprocess = (event) => {
      pcmChunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    contextRef.current = context;
    processorRef.current = processor;
    void context.resume();
    beginTimer();
    return true;
  }

  function startMediaRecorder(stream: MediaStream) {
    const mime = pickMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mediaChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) mediaChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      publish(new Blob(mediaChunksRef.current, { type: recorder.mimeType || "audio/webm" }));
    };
    recorderRef.current = recorder;
    recorder.start();
    beginTimer();
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
      if (!startWav(stream)) startMediaRecorder(stream);
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
