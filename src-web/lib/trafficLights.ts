import { invoke } from "@tauri-apps/api/core";
import { isNative } from "./platform";

// Asks the Rust side for the OS-rendered traffic-light geometry and
// publishes the cluster's vertical centre as `--traffic-light-center`
// on <html>. The header reads this var to size itself so its content
// centres against whatever AppKit actually drew — sidesteps the few-px
// drift between debug and codesigned release builds where a single
// trafficLightPosition value can't satisfy both.
//
// Non-macOS native (Windows / Linux) returns Err and we leave the
// var unset; the header's CSS fallback (26px → 52px) keeps the
// existing layout. Web is gated out before invoking.
export async function alignWithTrafficLights(): Promise<void> {
  if (!isNative) return;
  try {
    const [topY, height] = await invoke<[number, number]>(
      "traffic_light_geometry",
    );
    const center = topY + height / 2;
    document.documentElement.style.setProperty(
      "--traffic-light-center",
      `${center}px`,
    );
  } catch {
    // Non-macOS native or chrome unavailable — keep the CSS default.
  }
}
