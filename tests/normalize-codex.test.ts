import { describe, expect, it } from "vitest";
import { normalizeCodexRecord } from "../src/mine/normalize/codex.js";

describe("normalizeCodexRecord", () => {
  it("marks rejected tool outputs as user rejections", () => {
    const normalized = normalizeCodexRecord({
      type: "response_item",
      timestamp: "2026-05-07T12:00:00.000Z",
      payload: {
        type: "function_call_output",
        output: "Command was rejected: user doesn't want to proceed",
      },
    });

    expect(normalized.message).toMatchObject({
      role: "user",
      isToolResult: true,
      isRejection: true,
    });
  });
});
