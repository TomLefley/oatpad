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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![install_mcpb, open_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
