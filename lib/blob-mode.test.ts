import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { videoStorageFromEnv } from "./blob-mode";

describe("video storage mode", () => {
  it("uses presigned uploads when the store id and webhook key are set", () => {
    assert.deepEqual(videoStorageFromEnv({ storeId: "store_abc", webhookKey: "key", vercel: "1" }), {
      enabled: true,
      direct: false,
      presigned: true,
    });
  });

  it("keeps the read-write token path when no webhook key is present", () => {
    assert.deepEqual(videoStorageFromEnv({ token: "vercel_blob_rw_x" }), {
      enabled: true,
      direct: false,
      presigned: false,
    });
  });

  it("writes to disk locally and refuses multipart video on Vercel when nothing is configured", () => {
    assert.deepEqual(videoStorageFromEnv({}), { enabled: false, direct: true, presigned: false });
    assert.deepEqual(videoStorageFromEnv({ vercel: "1" }), { enabled: false, direct: false, presigned: false });
  });
});
