// Bracket access stays a runtime lookup. Next does not inline it at build time,
// so a value set only on the host (Vercel) is still visible after deploy.
export function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  return value;
}

export function missingEnvMessage(name: string): string {
  if (process.env.VERCEL) {
    return `线上没有 ${name}。请在 Vercel 项目的 Environment Variables 里设置，勾选 Production，然后重新部署。本地的 .env.local 不会上传。`;
  }
  return `请在 .env.local 设置 ${name}`;
}
