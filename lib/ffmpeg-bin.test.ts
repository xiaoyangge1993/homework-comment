import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { prepareExecutable, resolveBinary } from "./ffmpeg-bin";

describe("resolveBinary", () => {
  it("prefers FFMPEG_PATH when that file exists", () => {
    const picked = resolveBinary({
      envPath: "/opt/custom/ffmpeg",
      cwd: "/app",
      name: "ffmpeg",
      staticPath: "/app/node_modules/ffmpeg-static/ffmpeg",
      exists: (file) => file === "/opt/custom/ffmpeg" || file.endsWith("ffmpeg-static/ffmpeg"),
    });
    assert.equal(picked, "/opt/custom/ffmpeg");
  });

  it("skips missing paths and uses the project bin before the static package", () => {
    const projectBin = path.join("/app", "bin", "ffmpeg");
    const picked = resolveBinary({
      envPath: "/missing/ffmpeg",
      cwd: "/app",
      name: "ffmpeg",
      staticPath: "/app/node_modules/ffmpeg-static/ffmpeg",
      exists: (file) => file === projectBin || file.endsWith("ffmpeg-static/ffmpeg"),
    });
    assert.equal(picked, projectBin);
  });

  it("uses the static package when brew and bin/ffmpeg are absent", () => {
    const staticPath = "/app/node_modules/ffmpeg-static/ffmpeg";
    const picked = resolveBinary({
      envPath: undefined,
      cwd: "/app",
      name: "ffmpeg",
      staticPath,
      exists: (file) => file === staticPath,
    });
    assert.equal(picked, staticPath);
  });

  it("falls back to the command name when nothing exists", () => {
    assert.equal(
      resolveBinary({
        envPath: undefined,
        cwd: "/app",
        name: "ffmpeg",
        staticPath: null,
        exists: () => false,
      }),
      "ffmpeg",
    );
  });
});

describe("prepareExecutable", () => {
  it("leaves an executable file in place", () => {
    assert.equal(
      prepareExecutable("/bundle/ffmpeg", {
        canExecute: () => true,
        exists: () => true,
        copy: () => {
          throw new Error("should not copy");
        },
        chmod: () => {
          throw new Error("should not chmod");
        },
        tmpDir: "/tmp/homework-comment-bin",
      }),
      "/bundle/ffmpeg",
    );
  });

  it("copies a non-executable absolute path into tmp and marks it executable", () => {
    const copied: string[] = [];
    const chmodded: string[] = [];
    const dest = prepareExecutable("/bundle/ffmpeg", {
      canExecute: (file) => file.startsWith("/tmp"),
      exists: () => false,
      copy: (from, to) => copied.push(`${from} -> ${to}`),
      chmod: (file) => chmodded.push(file),
      tmpDir: "/tmp/homework-comment-bin",
    });
    assert.equal(dest, "/tmp/homework-comment-bin/ffmpeg");
    assert.deepEqual(copied, ["/bundle/ffmpeg -> /tmp/homework-comment-bin/ffmpeg"]);
    assert.deepEqual(chmodded, ["/tmp/homework-comment-bin/ffmpeg"]);
  });

  it("does not copy a bare command name", () => {
    assert.equal(
      prepareExecutable("ffmpeg", {
        canExecute: () => false,
        exists: () => false,
        copy: () => {
          throw new Error("should not copy");
        },
        chmod: () => {
          throw new Error("should not chmod");
        },
        tmpDir: "/tmp/homework-comment-bin",
      }),
      "ffmpeg",
    );
  });
});
