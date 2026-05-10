use tauri::Manager;

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
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            install_mcpb,
            open_url,
            traffic_light_geometry
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
