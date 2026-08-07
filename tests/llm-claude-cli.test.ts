import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { Writable, Readable } from "node:stream";
import type { ChildProcess } from "node:child_process";

interface FakeChild extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  stdin: Writable;
  kill: () => void;
}

function makeChild(): {
  child: FakeChild;
  emitStdout: (s: string) => void;
  emitStderr: (s: string) => void;
  close: (code: number | null) => void;
  error: (err: Error & { code?: string }) => void;
} {
  const ee = new EventEmitter() as FakeChild;
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdin = new Writable({ write(_c, _e, cb) { cb(); } });
  ee.stdout = stdout;
  ee.stderr = stderr;
  ee.stdin = stdin;
  ee.kill = () => {};
  return {
    child: ee,
    emitStdout: (s: string) => stdout.emit("data", Buffer.from(s)),
    emitStderr: (s: string) => stderr.emit("data", Buffer.from(s)),
    close: (code: number | null) => ee.emit("close", code),
    error: (err: Error & { code?: string }) => ee.emit("error", err),
  };
}

const spawnMock = vi.fn();

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process"
  );
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnMock(...args),
  };
});

const { claudeCliChat, claudeCliIsAvailable } = await import(
  "../src/llm/claude-cli.js"
);
const { defaultLLMConfig } = await import("../src/llm/client.js");

const config = defaultLLMConfig({
  provider: "claude-cli",
  model: "claude-sonnet-4-6",
  timeout: 1000,
  maxRetries: 1,
});

beforeEach(() => {
  spawnMock.mockReset();
});

afterEach(() => {
  spawnMock.mockReset();
});

describe("claudeCliChat", () => {
  it("returns stdout on exit 0", async () => {
    const handles = makeChild();
    spawnMock.mockReturnValueOnce(handles.child as unknown as ChildProcess);
    const promise = claudeCliChat(config, {
      messages: [{ role: "user", content: "hello" }],
    });
    handles.emitStdout("hi there\n");
    handles.close(0);
    const result = await promise;
    expect(result.content).toBe("hi there");
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("classifies auth failure from stderr", async () => {
    const handles = makeChild();
    spawnMock.mockReturnValueOnce(handles.child as unknown as ChildProcess);
    const promise = claudeCliChat(config, {
      messages: [{ role: "user", content: "hi" }],
    });
    handles.emitStderr("Error: please sign in via `claude login`\n");
    handles.close(1);
    await expect(promise).rejects.toThrow(/not logged in/);
  });

  it("classifies rate limit from stderr", async () => {
    const handles = makeChild();
    spawnMock.mockReturnValueOnce(handles.child as unknown as ChildProcess);
    const promise = claudeCliChat(config, {
      messages: [{ role: "user", content: "hi" }],
    });
    handles.emitStderr("429 Too Many Requests\n");
    handles.close(1);
    await expect(promise).rejects.toThrow(/rate limited/);
  });

  it("classifies subscription exhaustion", async () => {
    const handles = makeChild();
    spawnMock.mockReturnValueOnce(handles.child as unknown as ChildProcess);
    const promise = claudeCliChat(config, {
      messages: [{ role: "user", content: "hi" }],
    });
    handles.emitStderr("Your usage limit has been reached.\n");
    handles.close(1);
    await expect(promise).rejects.toThrow(/subscription limit/);
  });

  it("surfaces ENOENT as error with spawn `error` event", async () => {
    const handles = makeChild();
    spawnMock.mockReturnValueOnce(handles.child as unknown as ChildProcess);
    const promise = claudeCliChat(config, {
      messages: [{ role: "user", content: "hi" }],
    });
    const err = new Error("spawn claude ENOENT") as Error & { code?: string };
    err.code = "ENOENT";
    handles.error(err);
    await expect(promise).rejects.toThrow(/ENOENT/);
  });

  it("always delivers the prompt on stdin (argv never includes prompt text)", async () => {
    const handles = makeChild();
    let writtenPrompt = "";
    (handles.child.stdin as Writable)._write = (chunk, _enc, cb) => {
      writtenPrompt += chunk.toString();
      cb();
    };
    spawnMock.mockReturnValueOnce(handles.child as unknown as ChildProcess);

    const promptWithNewlines = "line1\nline2\n\"quoted\"\n";
    const promise = claudeCliChat(config, {
      messages: [{ role: "user", content: promptWithNewlines }],
    });
    handles.emitStdout("ok");
    handles.close(0);
    await promise;

    const args = spawnMock.mock.calls[0]![1] as string[];
    expect(args[0]).toBe("-p");
    // argv must not include the prompt body — stdin-only path
    expect(args.some((a) => a.includes("line1"))).toBe(false);
    expect(args.some((a) => a.includes("line2"))).toBe(false);
    expect(writtenPrompt).toContain("line1");
    expect(writtenPrompt).toContain("line2");
  });

  it("stdin path used for short prompts too (avoid Windows cmd.exe mangling)", async () => {
    const handles = makeChild();
    let writtenPrompt = "";
    (handles.child.stdin as Writable)._write = (chunk, _enc, cb) => {
      writtenPrompt += chunk.toString();
      cb();
    };
    spawnMock.mockReturnValueOnce(handles.child as unknown as ChildProcess);
    const promise = claudeCliChat(config, {
      messages: [{ role: "user", content: "short" }],
    });
    handles.emitStdout("ok");
    handles.close(0);
    await promise;
    const args = spawnMock.mock.calls[0]![1] as string[];
    expect(args).toContain("-p");
    expect(args.some((a) => a === "short" || a.includes("short"))).toBe(false);
    expect(writtenPrompt).toContain("short");
  });
});

describe("claudeCliIsAvailable", () => {
  it("returns reachable=false when ENOENT", async () => {
    const handles = makeChild();
    spawnMock.mockReturnValueOnce(handles.child as unknown as ChildProcess);
    const promise = claudeCliIsAvailable(config);
    const err = new Error("spawn claude ENOENT") as Error & { code?: string };
    err.code = "ENOENT";
    handles.error(err);
    const result = await promise;
    expect(result.reachable).toBe(false);
    expect(result.reason).toMatch(/not installed/);
  });

  it("returns reachable=true only after a real completion succeeds", async () => {
    // An installed-but-signed-out CLI answers --version fine and fails every
    // completion, so --version alone must not be treated as reachable.
    const version = makeChild();
    const completion = makeChild();
    spawnMock
      .mockReturnValueOnce(version.child as unknown as ChildProcess)
      .mockReturnValueOnce(completion.child as unknown as ChildProcess);

    const promise = claudeCliIsAvailable(config);
    version.emitStdout("claude-code 1.2.3\n");
    version.close(0);
    for (let i = 0; i < 200 && spawnMock.mock.calls.length < 2; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    completion.emitStdout("ok\n");
    completion.close(0);

    const result = await promise;
    expect(result.reachable).toBe(true);
    expect(result.modelPresent).toBe(true);
  });
});
