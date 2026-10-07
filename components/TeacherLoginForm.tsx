"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TeacherLoginForm({ initialPassword = "" }: { initialPassword?: string }) {
  const router = useRouter();
  const [password, setPassword] = useState(initialPassword);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/teacher/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "登录失败");
      router.push("/teacher");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
      setPending(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <label>
        密码
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="btn primary" type="submit" disabled={pending}>
        {pending ? "登录中…" : "登录"}
      </button>
    </form>
  );
}
