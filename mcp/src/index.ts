#!/usr/bin/env node
/*
 * Oatpad MCP entry point.
 *
 * The actual MCP server runs inside the Tauri app (Rust, see
 * src/src/mcp_server.rs). It listens on a Unix-domain socket inside
 * the app data directory. This file is what Claude Desktop loads
 * from the .mcpb bundle: it shovels JSON-RPC bytes between stdio and
 * that socket via the small proxy in `./proxy.ts` so the running app
 * handles every request directly.
 *
 * If the socket isn't there (Oatpad isn't running, or the user has
 * the MCP toggle off), the proxy synthesises a friendly error
 * response for each incoming request so Claude Desktop reports
 * something more useful than a connection drop.
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { startProxy } from "./proxy.js";

const APP_ID = "dev.lefley.oatpad";
const SOCKET_FILENAME = "mcp.sock";

function appDataDir(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_ID);
  }
  if (process.platform === "win32") {
    const base = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(base, APP_ID);
  }
  const base = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(base, APP_ID);
}

const dir = appDataDir();
const socketPath = join(dir, SOCKET_FILENAME);

async function reasonForUnreachable(): Promise<string> {
  // Distinguishes "user explicitly disabled it" from "app isn't open"
  // so Claude Desktop's error message can point the user at the right
  // place.
  let disabled = false;
  try {
    const text = await readFile(join(dir, "config.json"), "utf8");
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      disabled = (parsed as { mcpEnabled?: unknown }).mcpEnabled === false;
    }
  } catch {
    // Missing/unreadable config means the user hasn't toggled it off
    // — so "app not running" is the better explanation.
  }
  return disabled
    ? "Oatpad's MCP server is disabled. Enable it from the settings cog in the Oatpad app."
    : "Oatpad isn't running, or its MCP server hasn't started yet. Open the Oatpad app and enable the MCP toggle.";
}

const handle = startProxy({
  socketPath,
  input: process.stdin,
  output: process.stdout,
  reasonForUnreachable,
});

void handle.done.then(() => process.exit(0));
