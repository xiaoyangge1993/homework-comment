import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { messageFromBody, PAYLOAD_TOO_LARGE } from "./response-error";

describe("messageFromBody", () => {
  it("turns the platform 413 text into a sentence", () => {
    assert.equal(messageFromBody(413, "Request Entity Too Large", "保存失败"), PAYLOAD_TOO_LARGE);
    assert.equal(messageFromBody(413, "<html>413</html>", "保存失败"), PAYLOAD_TOO_LARGE);
    assert.equal(messageFromBody(500, "Request Entity Too Large\n", "保存失败"), PAYLOAD_TOO_LARGE);
  });

  it("keeps a JSON error and falls back otherwise", () => {
    assert.equal(
      messageFromBody(400, JSON.stringify({ error: "布置视频不能超过 200MB" }), "保存失败"),
      "布置视频不能超过 200MB",
    );
    assert.equal(messageFromBody(500, "nope", "保存失败"), "保存失败");
  });
});
