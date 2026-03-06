use std::sync::Mutex;
use tauri::{State, Manager};
use serde::{Deserialize, Serialize};

mod sidecar;
use sidecar::SidecarManager;

// Shared Types
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    #[serde(rename = "rowCount")]
    pub row_count: usize,
    #[serde(rename = "fileType")]
    pub file_type: String,
    #[serde(rename = "isConvertedCsv", default)]
    pub is_converted_csv: bool,
    #[serde(rename = "foundCount", default)]
    pub found_count: usize,
    #[serde(rename = "missingCount", default)]
    pub missing_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchProgress {
    pub current: usize,
    pub total: usize,
    pub found: usize,
    pub missing: usize,
    pub provider: String,
    pub status: String,
    #[serde(rename = "currentTrack")]
    pub current_track: Option<String>,
    #[serde(rename = "elapsedSeconds")]
    pub elapsed_seconds: Option<f64>,
    #[serde(rename = "estimatedRemainingSeconds")]
    pub estimated_remaining_seconds: Option<f64>,
    #[serde(rename = "rateLimited")]
    pub rate_limited: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DatabaseStatus {
    pub downloaded: bool,
    #[serde(rename = "trackCount")]
    pub track_count: usize,
    pub size: String,
    #[serde(rename = "lastUpdated")]
    pub last_updated: String,
    pub optimized: bool,
}

pub struct AppState {
    pub sidecar: Mutex<SidecarManager>,
}

/// Detect CSV file type from the first line (header row).
fn detect_file_type(header: &str) -> &'static str {
    if header.contains("Play Duration Milliseconds") && header.contains("Song Name") {
        "Play Activity"
    } else if header.contains("Date Played") && header.contains("Track Description") {
        "Play History Daily Tracks"
    } else if header.contains("Last Event End Timestamp")
        || (header.contains("Track Description") && header.contains("Total plays"))
    {
        "Recently Played Tracks"
    } else if header.contains("Play Duration Milliseconds") {
        "Play Activity"
    } else if header.contains("Track Description") {
        "Recently Played Tracks"
    } else {
        "Unknown"
    }
}

#[tauri::command]
async fn analyze_csv(
    state: State<'_, AppState>,
    path: String,
) -> Result<FileInfo, String> {
    let path_buf = std::path::PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("File not found: {}", path));
    }

    let file_name = path_buf
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.clone());
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;

    // Read first line for file type detection + count rows
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(file);
    let mut lines = std::io::BufRead::lines(reader);

    let first_line = lines.next().unwrap_or(Ok(String::new())).unwrap_or_default();
    let file_type = detect_file_type(&first_line).to_string();
    let row_count = lines.count(); // remaining lines = data rows

    // Also tell sidecar to analyze (it will emit a fileAnalysis event with more detail)
    if let Ok(mut sidecar) = state.sidecar.lock() {
        let _ = sidecar.send(serde_json::json!({
            "action": "analyzeCSV",
            "path": path
        }));
    }

    Ok(FileInfo {
        path,
        name: file_name,
        size: metadata.len(),
        row_count,
        file_type,
        is_converted_csv: false,
        found_count: 0,
        missing_count: 0,
    })
}

#[tauri::command]
async fn start_search(
    state: State<'_, AppState>,
    file_path: String,
    provider: String,
) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;

    // First load csv
    sidecar.send(serde_json::json!({
        "action": "loadCSV",
        "path": file_path
    }))?;

    // Then start search
    sidecar.send(serde_json::json!({
        "action": "startSearch",
        "provider": provider
    }))?;

    Ok(())
}

#[tauri::command]
async fn stop_search(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "stopSearch" }))?;
    Ok(())
}

#[tauri::command]
async fn toggle_pause(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "pauseSearch" }))?;
    Ok(())
}

#[tauri::command]
async fn resume_search(state: State<'_, AppState>, provider: Option<String>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({
        "action": "resumeSearch",
        "provider": provider
    }))?;
    Ok(())
}

#[tauri::command]
async fn get_resume_state(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "getResumeState" }))?;
    Ok(())
}

#[tauri::command]
async fn clear_resume_state(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "clearResumeState" }))?;
    Ok(())
}

#[tauri::command]
async fn export_results(
    state: State<'_, AppState>,
    format: String,
    output_path: String,
) -> Result<String, String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({
        "action": "export",
        "format": format,
        "path": output_path
    }))?;
    Ok(output_path)
}

#[tauri::command]
async fn export_missing(
    state: State<'_, AppState>,
    output_path: String,
) -> Result<String, String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({
        "action": "exportMissing",
        "path": output_path
    }))?;
    Ok(output_path)
}

#[tauri::command]
async fn export_rate_limited(
    state: State<'_, AppState>,
    output_path: String,
) -> Result<String, String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({
        "action": "exportRateLimited",
        "path": output_path
    }))?;
    Ok(output_path)
}

#[tauri::command]
async fn retry_rate_limited(
    state: State<'_, AppState>,
    provider: String,
) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({
        "action": "retryRateLimited",
        "provider": provider
    }))?;
    Ok(())
}

#[tauri::command]
async fn retry_missing(
    state: State<'_, AppState>,
    provider: String,
) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({
        "action": "retryMissing",
        "provider": provider
    }))?;
    Ok(())
}

#[tauri::command]
async fn skip_rate_limit_wait(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "skipRateLimitWait" }))?;
    Ok(())
}

#[tauri::command]
async fn get_database_status(state: State<'_, AppState>) -> Result<DatabaseStatus, String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "getDatabaseStatus" }))?;

    // Return a placeholder; the real data comes via the database_status event
    Ok(DatabaseStatus {
        downloaded: false,
        track_count: 0,
        size: "0 B".into(),
        last_updated: "Never".into(),
        optimized: false
    })
}

#[tauri::command]
async fn set_settings(state: State<'_, AppState>, settings: serde_json::Value) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({
        "action": "setSettings",
        "settings": settings
    }))?;
    Ok(())
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "getSettings" }))?;
    Ok(())
}

#[tauri::command]
async fn download_database(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "downloadDatabase" }))?;
    Ok(())
}

#[tauri::command]
async fn delete_database(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "deleteDatabase" }))?;
    Ok(())
}

#[tauri::command]
async fn check_database_updates(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "checkDatabaseUpdates" }))?;
    Ok(())
}

#[tauri::command]
async fn show_database_location(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "showDatabaseLocation" }))?;
    Ok(())
}

#[tauri::command]
async fn optimize_database(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "optimizeDatabase" }))?;
    Ok(())
}

#[tauri::command]
async fn import_database(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({
        "action": "importDatabase",
        "path": path
    }))?;
    Ok(())
}

#[tauri::command]
async fn check_itunes_status(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "checkItunesStatus" }))?;
    Ok(())
}

#[tauri::command]
async fn check_musicbrainz_api_status(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "checkMusicBrainzApiStatus" }))?;
    Ok(())
}

#[tauri::command]
async fn configure_apple_music(
    state: State<'_, AppState>,
    team_id: String,
    key_id: String,
    key_path: String,
    proxy_url: Option<String>,
    proxy_key: Option<String>,
) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({
        "action": "configureAppleMusic",
        "teamId": team_id,
        "keyId": key_id,
        "keyPath": key_path,
        "proxyUrl": proxy_url.unwrap_or_default(),
        "proxyKey": proxy_key.unwrap_or_default()
    }))?;
    Ok(())
}

#[tauri::command]
async fn test_apple_music_credentials(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "testAppleMusicCredentials" }))?;
    Ok(())
}

#[tauri::command]
async fn get_apple_music_status(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "getAppleMusicStatus" }))?;
    Ok(())
}

#[tauri::command]
async fn get_log_dir(_app: tauri::AppHandle) -> Result<String, String> {
    // Keep logs under a stable app-specific directory per platform.
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot determine home directory".to_string())?;
    let home = std::path::PathBuf::from(home);

    let log_dir = if cfg!(target_os = "macos") {
        home.join("Library").join("Logs").join("AppleMusicConverter")
    } else if cfg!(target_os = "windows") {
        let local = std::env::var("LOCALAPPDATA")
            .unwrap_or_else(|_| home.join("AppData").join("Local").to_string_lossy().to_string());
        std::path::PathBuf::from(local).join("AppleMusicConverter").join("Logs")
    } else {
        home.join(".apple_music_converter").join("logs")
    };

    // Create the directory if it doesn't exist
    std::fs::create_dir_all(&log_dir).map_err(|e| format!("Failed to create log dir: {}", e))?;

    Ok(log_dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn open_log_dir() -> Result<(), String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot determine home directory".to_string())?;
    let home = std::path::PathBuf::from(home);

    let log_dir = if cfg!(target_os = "macos") {
        home.join("Library").join("Logs").join("AppleMusicConverter")
    } else if cfg!(target_os = "windows") {
        let local = std::env::var("LOCALAPPDATA")
            .unwrap_or_else(|_| home.join("AppData").join("Local").to_string_lossy().to_string());
        std::path::PathBuf::from(local).join("AppleMusicConverter").join("Logs")
    } else {
        home.join(".apple_music_converter").join("logs")
    };

    std::fs::create_dir_all(&log_dir).map_err(|e| format!("Failed to create log dir: {}", e))?;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(log_dir.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(log_dir.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(log_dir.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
async fn open_folder(path: String) -> Result<(), String> {
    let dir = std::path::PathBuf::from(&path);

    // If it's a file, open its parent directory
    let target = if dir.is_file() {
        dir.parent().map(|p| p.to_path_buf()).unwrap_or(dir)
    } else {
        dir
    };

    if !target.exists() {
        return Err(format!("Path does not exist: {}", target.display()));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(target.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(target.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
async fn clear_cache(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "clearCache" }))?;
    Ok(())
}

#[tauri::command]
async fn initialize_sidecar(state: State<'_, AppState>) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({ "action": "initialize" }))?;
    Ok(())
}

#[tauri::command]
async fn get_csv_preview(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<Vec<String>>, String> {
    // Delegate to sidecar for proper encoding detection and column normalization
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({
        "action": "getPreview",
        "path": path
    }))?;

    // The actual preview data comes via the csv_preview event.
    // Return empty for the command; frontend should listen to the event.
    Ok(vec![])
}

#[tauri::command]
async fn set_preview_edits(
    state: State<'_, AppState>,
    path: String,
    rows: serde_json::Value,
) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({
        "action": "setPreviewEdits",
        "path": path,
        "rows": rows
    }))?;
    Ok(())
}

#[tauri::command]
async fn load_exported_csv(
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({
        "action": "loadExportedCSV",
        "path": path
    }))?;
    Ok(())
}

#[tauri::command]
async fn start_search_missing_only(
    state: State<'_, AppState>,
    provider: String,
) -> Result<(), String> {
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.send(serde_json::json!({
        "action": "startSearchMissingOnly",
        "provider": provider
    }))?;
    Ok(())
}

#[tauri::command]
async fn restart_sidecar(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;
    let mut sidecar = state.sidecar.lock().map_err(|_| "Failed to lock sidecar")?;
    sidecar.restart(window)?;

    // Re-initialize after restart
    sidecar.send(serde_json::json!({ "action": "initialize" }))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init());

    #[cfg(feature = "dev-debug")]
    {
        builder = builder.plugin(
            tauri_plugin_mcp::init_with_config(
                tauri_plugin_mcp::PluginConfig::new("apple-music-converter".to_string())
                    .start_socket_server(true)
                    .socket_path("/tmp/tauri-mcp-amhc.sock".into()),
            ),
        );
    }

    builder
        .manage(AppState {
            sidecar: Mutex::new(SidecarManager::new()),
        })
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .ok_or("No main window available")?;
            let state = app.state::<AppState>();
            let mut sidecar = state
                .sidecar
                .lock()
                .map_err(|_| "Failed to lock sidecar state during setup")?;

            // Start the sidecar
            if let Err(e) = sidecar.start(window) {
                eprintln!("Failed to start sidecar: {}", e);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            analyze_csv,
            start_search,
            stop_search,
            toggle_pause,
            resume_search,
            get_resume_state,
            clear_resume_state,
            export_results,
            export_missing,
            export_rate_limited,
            retry_rate_limited,
            retry_missing,
            skip_rate_limit_wait,
            get_database_status,
            get_csv_preview,
            set_preview_edits,
            initialize_sidecar,
            set_settings,
            get_settings,
            download_database,
            delete_database,
            check_database_updates,
            show_database_location,
            optimize_database,
            import_database,
            check_itunes_status,
            check_musicbrainz_api_status,
            configure_apple_music,
            test_apple_music_credentials,
            get_apple_music_status,
            get_log_dir,
            open_log_dir,
            open_folder,
            clear_cache,
            load_exported_csv,
            start_search_missing_only,
            restart_sidecar
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
