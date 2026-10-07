import { TeacherLoginForm } from "@/components/TeacherLoginForm";
import { readEnv } from "@/lib/env";

export default function TeacherLoginPage() {
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
        <TeacherLoginForm initialPassword={readEnv("TEACHER_PASSWORD") ?? ""} />
      </main>
    </>
  );
}
