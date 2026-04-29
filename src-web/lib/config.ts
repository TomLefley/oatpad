/*
 * App-level config persisted to `$APPDATA/dev.lefley.oatpad/config.json`.
 *
 * Today this file holds a single field — `mcpEnabled` — read by Oatpad's
 * settings UI and by the bundled MCP server before it serves any tool
 * call. The two sides agree on the path because the MCP server resolves
 * the same per-platform app-data location (see mcp/src/meetings.ts
 * appDataDir()).
 *
 * Behaviour mirrors the server's fail-open posture: a missing or
 * malformed file means "enabled". Writing a `false` flips it off until
 * the user re-enables.
 *
 * Web mode (no Tauri fs plugin) silently no-ops — there's no MCP server
 * paired with the browser tab, so the toggle has no effect there.
 */
import { BaseDirectory } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { isNative } from "./platform";

const CONFIG_FILE = "config.json";
const BASE_DIR = BaseDirectory.AppData;

export type AppConfig = {
  mcpEnabled: boolean;
  // Sticky flag flipped to true the first time the user clicks Install in
  // the settings bubble. The settings UI uses it to relabel the button
  // ("Reinstall") and show it in its active state on subsequent launches —
  // so the user can tell at a glance that the bundle has already been
  // handed to Claude Desktop at least once.
  mcpInstalled: boolean;
};

const DEFAULT_CONFIG: AppConfig = { mcpEnabled: true, mcpInstalled: false };

export async function loadConfig(): Promise<AppConfig> {
  if (!isNative) return { ...DEFAULT_CONFIG };
  try {
    if (!(await exists(CONFIG_FILE, { baseDir: BASE_DIR }))) {
      return { ...DEFAULT_CONFIG };
    }
    const text = await readTextFile(CONFIG_FILE, { baseDir: BASE_DIR });
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_CONFIG };
    const obj = parsed as { mcpEnabled?: unknown; mcpInstalled?: unknown };
    return {
      mcpEnabled: obj.mcpEnabled !== false,
      mcpInstalled: obj.mcpInstalled === true,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  if (!isNative) return;
  await writeTextFile(CONFIG_FILE, JSON.stringify(config, null, 2), {
    baseDir: BASE_DIR,
  });
}
