import path from "path";

const prefixes = ["/opt/homebrew", "/usr/local"];
const formulas = ["ffmpeg", "ffmpeg@7", "ffmpeg@6", "ffmpeg@5"];

export function resolveBinary(input: {
  envPath: string | undefined;
  cwd: string;
  name: "ffmpeg" | "ffprobe";
  staticPath?: string | null;
  exists: (file: string) => boolean;
}): string {
  const kegs = prefixes.flatMap((prefix) => formulas.map((formula) => path.join(prefix, "opt", formula, "bin", input.name)));
  const candidates = [
    input.envPath,
    ...kegs,
    ...prefixes.map((prefix) => path.join(prefix, "bin", input.name)),
    path.join(input.cwd, "bin", input.name),
    input.staticPath ?? undefined,
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (input.exists(candidate)) return candidate;
  }
  return input.name;
}

// Vercel copies the binary into a read-only bundle and sometimes drops the executable bit.
export function prepareExecutable(file: string, input: {
  canExecute: (file: string) => boolean;
  exists: (file: string) => boolean;
  copy: (from: string, to: string) => void;
  chmod: (file: string) => void;
  tmpDir: string;
}): string {
  if (!path.isAbsolute(file)) return file;
  if (input.canExecute(file)) return file;
  const dest = path.join(input.tmpDir, path.basename(file));
  try {
    if (!input.exists(dest)) input.copy(file, dest);
    input.chmod(dest);
    return dest;
  } catch {
    return file;
  }
}
