import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const { grokCliChat, grokCliIsAvailable } = await import("../src/llm/grok-cli.js");

const config = {
  provider: "grok-cli" as const,
  baseUrl: "",
  model: "grok-default",
  timeout: 60_000,
  maxRetries: 1,
};

function makeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return {
    child,
    emitStdout: (t: string) => child.stdout.emit("data", Buffer.from(t)),
    emitStderr: (t: string) => child.stderr.emit("data", Buffer.from(t)),
    close: (code: number) => child.emit("close", code),
  };
}

/** The availability probe spawns --version, then a completion; wait for both. */
async function waitForSpawns(count: number): Promise<void> {
  for (let i = 0; i < 200 && spawnMock.mock.calls.length < count; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  spawnMock.mockReset();
});

describe("grokCliChat", () => {
  it("runs a single headless turn and returns stdout", async () => {
    const h = makeChild();
    spawnMock.mockReturnValueOnce(h.child as unknown as ChildProcess);

    const promise = grokCliChat(config, {
      messages: [
        { role: "system", content: "be terse" },
        { role: "user", content: "hello" },
      ],
    });
    h.emitStdout("world\n");
    h.close(0);

    expect((await promise).content).toBe("world");
    const [bin, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(bin).toBe("grok");
    expect(args).toContain("-p");
    const prompt = args[args.indexOf("-p") + 1]!;
    expect(prompt).toContain("be terse");
    expect(prompt).toContain("hello");
  });

  it("omits --model when left at the CLI default", async () => {
    const h = makeChild();
    spawnMock.mockReturnValueOnce(h.child as unknown as ChildProcess);
    const p = grokCliChat(config, { messages: [{ role: "user", content: "x" }] });
    h.emitStdout("y");
    h.close(0);
    await p;
    expect(spawnMock.mock.calls[0]![1] as string[]).not.toContain("--model");
  });

  it("rejects on a non-zero exit", async () => {
    const h = makeChild();
    spawnMock.mockReturnValueOnce(h.child as unknown as ChildProcess);
    const p = grokCliChat(config, { messages: [{ role: "user", content: "x" }] });
    h.emitStderr("not logged in");
    h.close(1);
    await expect(p).rejects.toThrow();
  });
});

describe("grokCliIsAvailable", () => {
  it("reports unreachable when installed but signed out", async () => {
    const version = makeChild();
    const completion = makeChild();
    spawnMock
      .mockReturnValueOnce(version.child as unknown as ChildProcess)
      .mockReturnValueOnce(completion.child as unknown as ChildProcess);

    const promise = grokCliIsAvailable(config);
    version.emitStdout("grok 1.0.0\n");
    version.close(0);
    await waitForSpawns(2);
    completion.emitStderr("please sign in");
    completion.close(1);

    expect((await promise).reachable).toBe(false);
  });

  it("reports reachable only after a completion succeeds", async () => {
    const version = makeChild();
    const completion = makeChild();
    spawnMock
      .mockReturnValueOnce(version.child as unknown as ChildProcess)
      .mockReturnValueOnce(completion.child as unknown as ChildProcess);

    const promise = grokCliIsAvailable(config);
    version.emitStdout("grok 1.0.0\n");
    version.close(0);
    await waitForSpawns(2);
    completion.emitStdout("ok\n");
    completion.close(0);

    const result = await promise;
    expect(result.reachable).toBe(true);
    expect(result.modelPresent).toBe(true);
  });
});
