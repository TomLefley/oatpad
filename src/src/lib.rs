mod mcp_server;
mod meetings;

use std::sync::Arc;

use tauri::{Emitter, Manager, State};

// Tauri event the webview listens for so the sidebar can refresh
// after the in-app MCP server writes a new meeting. The string is
// duplicated in `src-web/App.svelte` — both ends must agree.
const MEETINGS_CHANGED_EVENT: &str = "oatpad://meetings-changed";

// Builds the callback the MCP server fires when it has just mutated
// the meetings directory. Cloning AppHandle is cheap; we capture one
// per server start so the closure outlives the calling Tauri command.
fn meetings_changed_notifier(app: tauri::AppHandle) -> mcp_server::Notifier {
    Arc::new(move || {
        // Best-effort emit — if no window is up to receive it (cold
        // start before the webview mounts), the next sidebar load
        // will pick up the file from disk anyway.
        let _ = app.emit(MEETINGS_CHANGED_EVENT, ());
    })
}

// Resolves the bundled `oatpad.mcpb` (added via `bundle.resources` in
// tauri.conf.json) and hands it to the OS's default file handler. On
// macOS that's Launch Services, which routes to Claude Desktop if it's
// the registered handler for `.mcpb`. If it isn't, the user gets the
// system "no app registered" prompt — acceptable fallback for a one-
// click install button.
#[tauri::command]
fn install_mcpb(app: tauri::AppHandle) -> Result<(), String> {
    let resource_path = app
        .path()
        .resolve("oatpad.mcpb", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("resolve resource: {e}"))?;

    if !resource_path.exists() {
        return Err(format!(
            "Bundled MCP server not found at {}",
            resource_path.display()
        ));
    }

    open_with_os_handler(&resource_path).map_err(|e| e.to_string())
}

fn open_with_os_handler(path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn()?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path.to_string_lossy()])
            .spawn()?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(path).spawn()?;
    }
    Ok(())
}

// Reports the AppKit-rendered geometry of the close traffic light so
// the frontend can centre header icons on whatever the OS actually
// drew. trafficLightPosition in tauri.conf is just a hint — macOS
// applies its own offset that differs subtly between debug and
// codesigned release builds, so a single static CSS value can't be
// right in both. Querying NSWindow at runtime sidesteps the drift
// entirely.
//
// Returns (top_y, height) in points, with origin at the top-left of
// the window's content view (i.e. matching the WebView's coordinate
// system). Errors on non-macOS targets and when the standard buttons
// aren't available (e.g. fullscreen, custom titleBarStyle).
#[cfg(target_os = "macos")]
#[tauri::command]
fn traffic_light_geometry(window: tauri::WebviewWindow) -> Result<(f64, f64), String> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_foundation::NSRect;

    let ns_window = window
        .ns_window()
        .map_err(|e| e.to_string())? as *mut AnyObject;
    if ns_window.is_null() {
        return Err("ns_window is nil".into());
    }
    unsafe {
        // NSWindowButton::NSWindowCloseButton == 0
        let close: *mut AnyObject = msg_send![ns_window, standardWindowButton: 0usize];
        if close.is_null() {
            return Err("no close button".into());
        }
        let frame: NSRect = msg_send![close, frame];

        let content: *mut AnyObject = msg_send![ns_window, contentView];
        if content.is_null() {
            return Err("no content view".into());
        }
        let content_frame: NSRect = msg_send![content, frame];

        // AppKit's content view is bottom-left origin; flip to top-left
        // so the value is directly usable as a CSS pixel offset.
        let top_y = content_frame.size.height - frame.origin.y - frame.size.height;
        Ok((top_y, frame.size.height))
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn traffic_light_geometry() -> Result<(f64, f64), String> {
    Err("traffic_light_geometry is macOS-only".into())
}

// Starts the in-app MCP server. Idempotent — calling while it's
// already running is a no-op. Bound to a Unix-domain socket inside
// the app data directory; the bundled `.mcpb` proxy connects there.
#[tauri::command]
async fn mcp_server_start(
    app: tauri::AppHandle,
    state: State<'_, Arc<mcp_server::State>>,
) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))?;
    let notifier = meetings_changed_notifier(app.clone());
    state.start(dir, Some(notifier)).await?;
    Ok(())
}

#[tauri::command]
async fn mcp_server_stop(state: State<'_, Arc<mcp_server::State>>) -> Result<(), String> {
    state.stop().await;
    Ok(())
}

// Reports whether the MCP listener is currently running. Lets the
// settings UI render the toggle's actual state instead of trusting
// the persisted flag (e.g. if the user toggled it on but the listener
// failed to bind to its socket, the flag and the reality could drift).
#[tauri::command]
async fn mcp_server_is_running(state: State<'_, Arc<mcp_server::State>>) -> Result<bool, String> {
    Ok(state.is_running().await)
}

// Reads the persisted mcpEnabled flag from `<app data>/config.json`.
// Mirrors the JS-side `loadConfig` shape but is owned by Rust so the
// startup auto-launch isn't gated on the webview being ready. Treats
// missing/malformed config as enabled to match the prior MCP server's
// fail-open semantics.
async fn mcp_enabled_on_disk(app_data_dir: &std::path::Path) -> bool {
    let path = app_data_dir.join("config.json");
    let Ok(text) = tokio::fs::read_to_string(&path).await else {
        return true;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return true;
    };
    value
        .get("mcpEnabled")
        .map(|v| v.as_bool().unwrap_or(true))
        .unwrap_or(true)
}

// Hands a URL to the OS so the user's default browser opens it.
// Same dispatch pattern as `open_with_os_handler` — `open` on macOS,
// `start` on Windows, `xdg-open` on Linux — but accepts a URL string
// since URLs aren't filesystem paths.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let result: std::io::Result<()> = (|| {
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open").arg(&url).spawn()?;
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", &url])
                .spawn()?;
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open").arg(&url).spawn()?;
        }
        Ok(())
    })();
    result.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mcp_state = Arc::new(mcp_server::State::default());
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Arc::clone(&mcp_state))
        .setup({
            let mcp_state = Arc::clone(&mcp_state);
            move |app| {
                // Auto-start the MCP listener at boot when the user has
                // it toggled on. Failure is non-fatal — surfaces in the
                // settings UI as "not running" so the user can retry.
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let Ok(dir) = app_handle.path().app_data_dir() else { return };
                    if mcp_enabled_on_disk(&dir).await {
                        let notifier = meetings_changed_notifier(app_handle.clone());
                        if let Err(err) = mcp_state.start(dir, Some(notifier)).await {
                            eprintln!("Oatpad: MCP auto-start failed: {err}");
                        }
                    }
                });
                Ok(())
            }
        })
        .on_window_event({
            let mcp_state = Arc::clone(&mcp_state);
            move |_window, event| {
                // Stop the listener when the app is closing so the
                // socket file is removed and a stale reference doesn't
                // outlive the process.
                if let tauri::WindowEvent::Destroyed = event {
                    let mcp_state = Arc::clone(&mcp_state);
                    tauri::async_runtime::spawn(async move {
                        mcp_state.stop().await;
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            install_mcpb,
            mcp_server_is_running,
            mcp_server_start,
            mcp_server_stop,
            open_url,
            traffic_light_geometry
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
