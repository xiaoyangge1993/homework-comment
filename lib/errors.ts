export class AppError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export function visibleError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (!message || /libsql:|turso\.io|authToken|Bearer\s+|TURSO_/i.test(message)) return "页面加载失败";
  return message.length > 180 ? `${message.slice(0, 180)}…` : message;
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: "服务器出错" }, { status: 500 });
}
