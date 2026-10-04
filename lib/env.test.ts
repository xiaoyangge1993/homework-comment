import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { missingEnvMessage, readEnv } from "./env";

describe("readEnv", () => {
  const key = "HOMEWORK_TEST_ENV";

  afterEach(() => {
    delete process.env[key];
    delete process.env.VERCEL;
  });

  it("reads the current process value and treats an empty string as unset", () => {
    process.env[key] = "from-host";
    assert.equal(readEnv(key), "from-host");
    process.env[key] = "";
    assert.equal(readEnv(key), undefined);
  });

  it("tells a Vercel deploy to set the host variable, and local dev to use .env.local", () => {
    assert.match(missingEnvMessage("TEACHER_PASSWORD"), /\.env\.local/);
    process.env.VERCEL = "1";
    const message = missingEnvMessage("TEACHER_PASSWORD");
    assert.match(message, /Vercel/);
    assert.match(message, /TEACHER_PASSWORD/);
    assert.doesNotMatch(message, /请在 \.env\.local 设置/);
  });
});
