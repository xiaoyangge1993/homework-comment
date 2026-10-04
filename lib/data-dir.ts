import fs from "fs";
import path from "path";

export function directoryWritable(dir: string): boolean {
  const probe = path.join(dir, `.write-probe-${process.pid}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, "1");
    return true;
  } catch {
    return false;
  } finally {
    try {
      fs.unlinkSync(probe);
    } catch {
      // The probe is absent when the directory cannot be created.
    }
  }
}

// Vercel can read the deployment and only write /tmp. That copy disappears with the instance.
export function resolveDataDir(
  cwd: string,
  override: string | undefined,
  writable: (dir: string) => boolean = directoryWritable,
): string {
  if (override) return override;
  const preferred = path.join(cwd, "data");
  if (writable(preferred)) return preferred;
  return path.join("/tmp", "homework-comment");
}
