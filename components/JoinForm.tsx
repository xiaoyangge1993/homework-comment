"use client";

import { useState } from "react";

export function JoinForm({ next, initialCode }: { next?: string; initialCode?: string }) {
  const [code, setCode] = useState(initialCode ?? "");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [needConfirm, setNeedConfirm] = useState(false);

  async function send(confirm: boolean) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, confirm }),
      });
      const body = (await response.json()) as { needConfirm?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error || "进入失败");
      if (body.needConfirm) {
        setNeedConfirm(true);
        setPending(false);
        return;
      }
      window.location.href = next || "/join";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "进入失败");
      setPending(false);
    }
  }

  return (
    <form
      className="card stack"
      onSubmit={(event) => {
        event.preventDefault();
        void send(false);
      }}
    >
      <label>
        班级码
        <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} autoCapitalize="characters" required />
      </label>
      <label>
        姓名
        <input value={name} onChange={(event) => { setName(event.target.value); setNeedConfirm(false); }} required />
      </label>
      {needConfirm ? (
        <div className="warn">
          <p>班里已有叫「{name.trim()}」的同学。如果是你本人，确认后继续原来的作业。系统不会自动把两次记录并在一起。如果不是你，请换一个姓名。</p>
          <div className="row">
            <button type="button" className="btn primary" disabled={pending} onClick={() => void send(true)}>
              是我，继续
            </button>
            <button type="button" className="btn" onClick={() => setNeedConfirm(false)}>
              我改个姓名
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <button className="btn primary" type="submit" disabled={pending || needConfirm}>
        {pending ? "进入中…" : "进入"}
      </button>
    </form>
  );
}
