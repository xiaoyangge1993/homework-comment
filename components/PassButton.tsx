"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PassButton({ submissionId }: { submissionId: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        className="btn primary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const response = await fetch(`/api/submissions/${submissionId}/accept`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "draft" }),
          });
          const body = (await response.json()) as { error?: string; speechError?: string | null };
          if (!response.ok) setError(body.error || "发送失败");
          else if (body.speechError) setError(`文字已发送。语音合成失败：${body.speechError}`);
          setPending(false);
          router.refresh();
        }}
      >
        {pending ? "发送中…" : "通过并发送"}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </>
  );
}
