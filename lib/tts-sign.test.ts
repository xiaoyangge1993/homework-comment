import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tc3Authorization } from "./tts-sign";

describe("tc3Authorization", () => {
  it("builds a TC3 header without putting the secret in the header", () => {
    const header = tc3Authorization({
      secretId: "sid",
      secretKey: "super-secret",
      payload: JSON.stringify({ Text: "三句都读全了，可以过。" }),
      timestamp: 1_700_000_000,
    });
    assert.match(header, /^TC3-HMAC-SHA256 Credential=sid\/2023-11-14\/tts\/tc3_request, SignedHeaders=content-type;host, Signature=[0-9a-f]+$/);
    assert.equal(header.includes("super-secret"), false);
  });
});
