import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { startProxy } from "./proxy.js";

let dir: string;
let socketPath: string;
let server: Server | null = null;
const connections: Socket[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "oatpad-proxy-"));
  socketPath = join(dir, "mcp.sock");
});

afterEach(async () => {
  for (const c of connections) c.destroy();
  connections.length = 0;
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  server = null;
  await rm(dir, { recursive: true, force: true });
});

function startFakeServer(handler: (line: string) => string | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    server = createServer((socket) => {
      connections.push(socket);
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let idx = buffer.indexOf("\n");
        while (idx !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.length === 0) {
            idx = buffer.indexOf("\n");
            continue;
          }
          const reply = handler(line);
          if (reply !== undefined) socket.write(`${reply}\n`);
          idx = buffer.indexOf("\n");
        }
      });
    });
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
}

function makeStreams(): {
  input: PassThrough;
  output: PassThrough;
  collect: () => string;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  let collected = "";
  output.on("data", (chunk: Buffer) => {
    collected += chunk.toString("utf8");
  });
  return {
    input,
    output,
    collect: () => collected,
  };
}

async function nextLine(getOutput: () => string): Promise<string> {
  for (let i = 0; i < 200; i += 1) {
    const buf = getOutput();
    const idx = buf.indexOf("\n");
    if (idx !== -1) return buf.slice(0, idx);
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for output (got: ${JSON.stringify(getOutput())})`);
}

describe("startProxy", () => {
  it("forwards requests upstream and writes the reply to stdout", async () => {
    await startFakeServer((line) => {
      const req = JSON.parse(line);
      return JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { ok: true } });
    });

    const { input, output, collect } = makeStreams();
    const handle = startProxy({
      socketPath,
      input,
      output,
      reasonForUnreachable: () => "should not be called",
    });

    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" })}\n`);
    const line = await nextLine(collect);
    const parsed = JSON.parse(line);
    expect(parsed.id).toBe(7);
    expect(parsed.result).toEqual({ ok: true });

    input.end();
    await handle.done;
  });

  it("synthesises a friendly error when the socket isn't listening", async () => {
    // No fake server — connect must fail.
    const { input, output, collect } = makeStreams();
    const handle = startProxy({
      socketPath,
      input,
      output,
      reasonForUnreachable: () => "Oatpad isn't running.",
    });

    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
    const line = await nextLine(collect);
    const parsed = JSON.parse(line);
    expect(parsed.id).toBe(1);
    expect(parsed.error.code).toBe(-32603);
    expect(parsed.error.message).toBe("Oatpad isn't running.");

    input.end();
    await handle.done;
  });

  it("does not reply to notifications when the socket is unreachable", async () => {
    const { input, output, collect } = makeStreams();
    const handle = startProxy({
      socketPath,
      input,
      output,
      reasonForUnreachable: () => "unreachable",
    });

    // Notification — no `id` field, so JSON-RPC says no response.
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    // Give the proxy a beat to (incorrectly) emit something, then assert silence.
    await new Promise((r) => setTimeout(r, 50));
    expect(collect()).toBe("");

    input.end();
    await handle.done;
  });

  it("buffers a frame written before the socket is bound and flushes it on connect", async () => {
    const seen: string[] = [];
    await startFakeServer((line) => {
      seen.push(line);
      const req = JSON.parse(line);
      return JSON.stringify({ jsonrpc: "2.0", id: req.id, result: "ok" });
    });

    const { input, output, collect } = makeStreams();
    const handle = startProxy({
      socketPath,
      input,
      output,
      reasonForUnreachable: () => "should not be called",
    });

    // First write happens before ensureSocket has a chance to resolve.
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`);
    const line = await nextLine(collect);
    expect(JSON.parse(line).id).toBe(1);
    expect(seen.length).toBe(1);

    input.end();
    await handle.done;
  });
});
