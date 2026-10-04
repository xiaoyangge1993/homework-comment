"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TeacherLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
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
    <>
      <div className="home-bar">
        <a href="/">跟读预批改</a>
      </div>
      <main className="wrap">
        <h1>老师登录</h1>
        <p className="muted">
          全班共用一个密码。本地写在 .env.local 的 TEACHER_PASSWORD。部署到 Vercel 后，要在项目的 Environment Variables
          里设置同名变量并重新部署，.env.local 不会上传。
        </p>
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
      </main>
    </>
  );
}
