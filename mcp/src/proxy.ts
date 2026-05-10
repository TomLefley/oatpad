/*
 * Stdio↔Unix-socket proxy core.
 *
 * Exported as a function so tests can drive it with a temp socket
 * path, an in-memory readable for stdin, and an in-memory writable
 * for stdout. The runnable entry point in index.ts wraps this with
 * process.stdin / process.stdout / appDataDir().
 */
import { connect, type Socket } from "node:net";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export type UnreachableReasonResolver = () => Promise<string> | string;

export type ProxyOptions = {
  socketPath: string;
  input: Readable;
  output: Writable;
  // Resolves the message attached to synthesised JSON-RPC errors when
  // the server can't be reached. The proxy doesn't know *why* the
  // socket is gone — that's the caller's policy (toggle off vs app not
  // running) — so the reason is supplied as a callback.
  reasonForUnreachable: UnreachableReasonResolver;
};

export type ProxyHandle = {
  // Resolves once stdin closes and the upstream socket has been told
  // to end. Used by tests to await graceful shutdown.
  done: Promise<void>;
};

export function startProxy(options: ProxyOptions): ProxyHandle {
  const { socketPath, input, output, reasonForUnreachable } = options;

  let socket: Socket | null = null;
  let reconnecting = false;
  // Frames that arrived from stdin while the socket was connecting are
  // queued here, then flushed when binding completes. Avoids dropping
  // the very first request when the proxy boots faster than the OS can
  // open the socket.
  const pendingFrames: string[] = [];

  function writeLine(line: string): void {
    output.write(`${line}\n`);
  }

  async function replyUnreachable(line: string): Promise<void> {
    let id: unknown = null;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === "object") {
        const maybeId = (parsed as { id?: unknown }).id;
        // Notifications have no id and expect no response.
        if (maybeId === undefined) return;
        id = maybeId;
      }
    } catch {
      // Unparseable input — emit a parse error with no id.
    }
    const message = await reasonForUnreachable();
    writeLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message },
      }),
    );
  }

  function bindSocket(s: Socket): void {
    socket = s;
    let buffer = "";
    s.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let idx = buffer.indexOf("\n");
      while (idx !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (frame.length > 0) writeLine(frame);
        idx = buffer.indexOf("\n");
      }
    });
    s.on("error", () => {
      // Errors trigger close; close handles the reconnect logic.
    });
    s.on("close", () => {
      socket = null;
    });
    while (pendingFrames.length > 0) {
      const frame = pendingFrames.shift()!;
      s.write(`${frame}\n`);
    }
  }

  function tryConnect(): Promise<Socket | null> {
    return new Promise((resolve) => {
      const s = connect(socketPath);
      s.once("connect", () => {
        s.removeAllListeners("error");
        resolve(s);
      });
      s.once("error", () => {
        resolve(null);
      });
    });
  }

  async function ensureSocket(): Promise<Socket | null> {
    if (socket) return socket;
    if (reconnecting) return null;
    reconnecting = true;
    try {
      const s = await tryConnect();
      if (s) bindSocket(s);
      return s;
    } finally {
      reconnecting = false;
    }
  }

  async function forward(line: string): Promise<void> {
    const s = await ensureSocket();
    if (!s) {
      await replyUnreachable(line);
      return;
    }
    if (socket) {
      socket.write(`${line}\n`);
    } else {
      pendingFrames.push(line);
    }
  }

  const rl = createInterface({ input });

  let resolveDone: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  rl.on("line", (line) => {
    if (line.length === 0) return;
    void forward(line);
  });
  rl.on("close", () => {
    if (socket) socket.end();
    resolveDone();
  });

  return { done };
}
