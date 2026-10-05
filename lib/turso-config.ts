import { AppError } from "./errors";
import { missingEnvMessage, readEnv } from "./env";

export type TursoConfig = { url: string; authToken: string };

// Vercel instances do not share a disk. Both values are required there so a
// write from one request is visible to the next.
export function tursoConfig(): TursoConfig | null {
  const url = readEnv("TURSO_DATABASE_URL");
  const authToken = readEnv("TURSO_AUTH_TOKEN");
  if (!url && !authToken && !process.env.VERCEL) return null;
  if (!url) throw new AppError(missingEnvMessage("TURSO_DATABASE_URL"));
  if (!authToken) throw new AppError(missingEnvMessage("TURSO_AUTH_TOKEN"));
  return { url, authToken };
}
