import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AppError } from "./errors";
import { tursoConfig } from "./turso-config";

describe("tursoConfig", () => {
  afterEach(() => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    delete process.env.VERCEL;
  });

  it("stays on the local file when neither Turso variable is set", () => {
    assert.equal(tursoConfig(), null);
  });

  it("requires both variables together", () => {
    process.env.TURSO_DATABASE_URL = "libsql://example.turso.io";
    assert.throws(() => tursoConfig(), (error: unknown) => error instanceof AppError && /TURSO_AUTH_TOKEN/.test(error.message));
  });

  it("requires Turso on Vercel instead of an instance-local file", () => {
    process.env.VERCEL = "1";
    assert.throws(() => tursoConfig(), (error: unknown) => error instanceof AppError && /TURSO_DATABASE_URL/.test(error.message));
  });

  it("returns the remote settings when both are set", () => {
    process.env.TURSO_DATABASE_URL = "libsql://example.turso.io";
    process.env.TURSO_AUTH_TOKEN = "token";
    assert.deepEqual(tursoConfig(), { url: "libsql://example.turso.io", authToken: "token" });
  });
});
