use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Mutex;
use tauri::{Manager, State};

mod diagnostics;
mod sidecar;
use diagnostics::{resolve_log_dir, SessionDiagnostics};
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
    pub loaded_file: Mutex<Option<String>>,
    pub diagnostics: SessionDiagnostics,
    pub startup_issue: Mutex<Option<String>>,
}

fn set_startup_issue(state: &AppState, issue: Option<String>) {
    if let Ok(mut slot) = state.startup_issue.lock() {
        *slot = issue;
    }
}

fn current_startup_issue(state: &AppState) -> Option<String> {
    state.startup_issue.lock().ok().and_then(|issue| issue.clone())
}

fn format_sidecar_error(state: &AppState, action: &str, error: &str) -> String {
    let mut lines = vec![format!("The search backend failed while {}.", action), error.to_string()];

    if let Some(issue) = current_startup_issue(state) {
        if issue != error {
            lines.push(format!("Startup issue: {}", issue));
        }
    }

    lines.push(format!(
        "Session log: {}",
        state.diagnostics.session_log_path().display()
    ));

    lines.join("\n")
}

fn send_sidecar_action(
    state: &State<'_, AppState>,
    action: &'static str,
    payload: serde_json::Value,
) -> Result<(), String> {
    let mut sidecar = state
        .sidecar
        .lock()
        .map_err(|_| "Failed to lock sidecar".to_string())?;

    sidecar.send(payload).map_err(|err| {
        let detailed = format_sidecar_error(state.inner(), action, &err);
        state.diagnostics.log_event(
            "sidecar_command_failed",
            "Failed to send command to sidecar",
            json!({
                "action": action,
                "error": err,
                "startupIssue": current_startup_issue(state.inner()),
            }),
        );
        detailed
    })
}

fn ensure_sidecar_running(
    state: &State<'_, AppState>,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "No main window".to_string())?;
    let mut sidecar = state
        .sidecar
        .lock()
        .map_err(|_| "Failed to lock sidecar".to_string())?;

    if sidecar.is_alive() {
        return Ok(());
    }

    match sidecar.start(window, state.diagnostics.clone()) {
        Ok(()) => {
            set_startup_issue(state.inner(), None);
            state.diagnostics.log_event(
                "sidecar_started",
                "Started sidecar process",
                json!({ "reason": "ensure_sidecar_running" }),
            );
            Ok(())
        }
        Err(err) => {
            set_startup_issue(state.inner(), Some(err.clone()));
            state.diagnostics.log_event(
                "sidecar_start_failed",
                "Failed to start sidecar process",
                json!({
                    "reason": "ensure_sidecar_running",
                    "error": err,
                }),
            );
            Err(format_sidecar_error(
                state.inner(),
                "starting the search backend",
                &err,
            ))
        }
    }
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
    let path_clone = path.clone();

    // Run blocking file I/O on a separate thread to avoid stalling the async runtime.
    // Large CSVs (100MB+) can take seconds to count lines — this would block Tauri IPC.
    let (file_name, file_size, file_type, row_count) =
        tokio::task::spawn_blocking(move || -> Result<(String, u64, String, usize), String> {
            let path_buf = std::path::PathBuf::from(&path_clone);
            if !path_buf.exists() {
                return Err(format!("File not found: {}", path_clone));
            }

            let name = path_buf
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| path_clone.clone());
            let metadata = std::fs::metadata(&path_clone).map_err(|e| e.to_string())?;

            let file = std::fs::File::open(&path_clone).map_err(|e| e.to_string())?;
            let reader = std::io::BufReader::new(file);
            let mut lines = std::io::BufRead::lines(reader);

            let first_line = lines.next().unwrap_or(Ok(String::new())).unwrap_or_default();
            let ftype = detect_file_type(&first_line).to_string();
            let count = lines.count();

            Ok((name, metadata.len(), ftype, count))
        })
        .await
        .map_err(|e| format!("Task failed: {}", e))?
        ?;

    let info = FileInfo {
        path,
        name: file_name,
        size: file_size,
        row_count,
        file_type,
        is_converted_csv: false,
        found_count: 0,
        missing_count: 0,
    };

    state.diagnostics.log_event(
        "csv_analyzed",
        "Analyzed CSV file",
        json!({
            "path": info.path,
            "name": info.name,
            "sizeBytes": info.size,
            "rowCount": info.row_count,
            "fileType": info.file_type,
        }),
    );

    // Also tell sidecar to analyze (it will emit a fileAnalysis event with more detail)
    if let Ok(mut sidecar) = state.sidecar.lock() {
        if let Err(err) = sidecar.send(serde_json::json!({
            "action": "analyzeCSV",
            "path": info.path
        })) {
            state.diagnostics.log_event(
                "sidecar_command_failed",
                "Failed to request sidecar CSV analysis",
                json!({
                    "action": "analyzeCSV",
                    "path": info.path,
                    "error": err,
                }),
            );
        }
    }

    Ok(info)
}

#[tauri::command]
async fn start_search(
    state: State<'_, AppState>,
    file_path: String,
    provider: String,
) -> Result<(), String> {
    // Only reload CSV if the file changed
    let mut loaded = state.loaded_file.lock().map_err(|_| "Failed to lock loaded_file")?;
    let needs_load = loaded.as_deref() != Some(&file_path);
    if needs_load {
        send_sidecar_action(&state, "loading the selected CSV", serde_json::json!({
            "action": "loadCSV",
            "path": file_path
        }))?;
        *loaded = Some(file_path);
    }

    state.diagnostics.log_event(
        "search_requested",
        "Requested track search",
        json!({
            "filePath": loaded.as_deref(),
            "provider": provider,
        }),
    );

    // Start search
    send_sidecar_action(&state, "starting a search", serde_json::json!({
        "action": "startSearch",
        "provider": provider
    }))?;

    Ok(())
}

#[tauri::command]
async fn stop_search(state: State<'_, AppState>) -> Result<(), String> {
    state.diagnostics.log_event("search_stop_requested", "Requested search stop", json!({}));
    send_sidecar_action(&state, "stopping the current search", serde_json::json!({ "action": "stopSearch" }))?;
    Ok(())
}

#[tauri::command]
async fn toggle_pause(state: State<'_, AppState>) -> Result<(), String> {
    state.diagnostics.log_event("search_pause_toggled", "Toggled search pause state", json!({}));
    send_sidecar_action(&state, "toggling search pause", serde_json::json!({ "action": "pauseSearch" }))?;
    Ok(())
}

#[tauri::command]
async fn resume_search(state: State<'_, AppState>, provider: Option<String>) -> Result<(), String> {
    state.diagnostics.log_event(
        "search_resume_requested",
        "Requested search resume",
        json!({ "provider": provider }),
    );
    send_sidecar_action(&state, "resuming a saved search", serde_json::json!({
        "action": "resumeSearch",
        "provider": provider
    }))?;
    Ok(())
}

#[tauri::command]
async fn get_resume_state(state: State<'_, AppState>) -> Result<(), String> {
    send_sidecar_action(&state, "loading saved search state", serde_json::json!({ "action": "getResumeState" }))?;
    Ok(())
}

#[tauri::command]
async fn clear_resume_state(state: State<'_, AppState>) -> Result<(), String> {
    state.diagnostics.log_event("resume_state_cleared", "Requested clearing saved search state", json!({}));
    send_sidecar_action(&state, "clearing saved search state", serde_json::json!({ "action": "clearResumeState" }))?;
    Ok(())
}

#[tauri::command]
async fn export_results(
    state: State<'_, AppState>,
    format: String,
    output_path: String,
) -> Result<String, String> {
    state.diagnostics.log_event(
        "export_requested",
        "Requested export of matched results",
        json!({
            "format": format,
            "outputPath": output_path,
        }),
    );
    send_sidecar_action(&state, "exporting matched results", serde_json::json!({
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
    state.diagnostics.log_event(
        "export_missing_requested",
        "Requested export of missing tracks",
        json!({ "outputPath": output_path }),
    );
    send_sidecar_action(&state, "exporting missing tracks", serde_json::json!({
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
    state.diagnostics.log_event(
        "export_rate_limited_requested",
        "Requested export of rate-limited tracks",
        json!({ "outputPath": output_path }),
    );
    send_sidecar_action(&state, "exporting rate-limited tracks", serde_json::json!({
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
    state.diagnostics.log_event(
        "retry_rate_limited_requested",
        "Requested retry of rate-limited tracks",
        json!({ "provider": provider }),
    );
    send_sidecar_action(&state, "retrying rate-limited tracks", serde_json::json!({
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
    state.diagnostics.log_event(
        "retry_missing_requested",
        "Requested retry of missing tracks",
        json!({ "provider": provider }),
    );
    send_sidecar_action(&state, "retrying missing tracks", serde_json::json!({
        "action": "retryMissing",
        "provider": provider
    }))?;
    Ok(())
}

#[tauri::command]
async fn skip_rate_limit_wait(state: State<'_, AppState>) -> Result<(), String> {
    state.diagnostics.log_event("skip_rate_limit_requested", "Requested skip of current rate-limit wait", json!({}));
    send_sidecar_action(&state, "skipping the current rate-limit wait", serde_json::json!({ "action": "skipRateLimitWait" }))?;
    Ok(())
}

#[tauri::command]
async fn get_database_status(state: State<'_, AppState>) -> Result<DatabaseStatus, String> {
    send_sidecar_action(&state, "loading MusicBrainz database status", serde_json::json!({ "action": "getDatabaseStatus" }))?;

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
    state.diagnostics.log_event(
        "settings_update_requested",
        "Requested settings update",
        json!({ "settings": settings }),
    );
    send_sidecar_action(&state, "saving settings", serde_json::json!({
        "action": "setSettings",
        "settings": settings
    }))?;
    Ok(())
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<(), String> {
    send_sidecar_action(&state, "loading settings", serde_json::json!({ "action": "getSettings" }))?;
    Ok(())
}

#[tauri::command]
async fn download_database(state: State<'_, AppState>) -> Result<(), String> {
    state.diagnostics.log_event("database_download_requested", "Requested MusicBrainz database download", json!({}));
    send_sidecar_action(&state, "starting the MusicBrainz database download", serde_json::json!({ "action": "downloadDatabase" }))?;
    Ok(())
}

#[tauri::command]
async fn delete_database(state: State<'_, AppState>) -> Result<(), String> {
    state.diagnostics.log_event("database_delete_requested", "Requested MusicBrainz database deletion", json!({}));
    send_sidecar_action(&state, "deleting the MusicBrainz database", serde_json::json!({ "action": "deleteDatabase" }))?;
    Ok(())
}

#[tauri::command]
async fn check_database_updates(state: State<'_, AppState>) -> Result<(), String> {
    send_sidecar_action(&state, "checking for MusicBrainz database updates", serde_json::json!({ "action": "checkDatabaseUpdates" }))?;
    Ok(())
}

#[tauri::command]
async fn show_database_location(state: State<'_, AppState>) -> Result<(), String> {
    send_sidecar_action(&state, "opening the MusicBrainz database folder", serde_json::json!({ "action": "showDatabaseLocation" }))?;
    Ok(())
}

#[tauri::command]
async fn optimize_database(state: State<'_, AppState>) -> Result<(), String> {
    state.diagnostics.log_event("database_optimize_requested", "Requested MusicBrainz optimization", json!({}));
    send_sidecar_action(&state, "starting MusicBrainz optimization", serde_json::json!({ "action": "optimizeDatabase" }))?;
    Ok(())
}

#[tauri::command]
async fn import_database(state: State<'_, AppState>, path: String) -> Result<(), String> {
    state.diagnostics.log_event(
        "database_import_requested",
        "Requested MusicBrainz database import",
        json!({ "path": path }),
    );
    send_sidecar_action(&state, "importing a MusicBrainz database", serde_json::json!({
        "action": "importDatabase",
        "path": path
    }))?;
    Ok(())
}

#[tauri::command]
async fn check_itunes_status(state: State<'_, AppState>) -> Result<(), String> {
    send_sidecar_action(&state, "checking iTunes API status", serde_json::json!({ "action": "checkItunesStatus" }))?;
    Ok(())
}

#[tauri::command]
async fn check_musicbrainz_api_status(state: State<'_, AppState>) -> Result<(), String> {
    send_sidecar_action(&state, "checking MusicBrainz API status", serde_json::json!({ "action": "checkMusicBrainzApiStatus" }))?;
    Ok(())
}

#[tauri::command]
async fn check_apple_music_api_status(state: State<'_, AppState>) -> Result<(), String> {
    send_sidecar_action(&state, "checking Apple Music API status", serde_json::json!({ "action": "checkAppleMusicApiStatus" }))?;
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
    state.diagnostics.log_event(
        "apple_music_config_requested",
        "Requested Apple Music configuration update",
        json!({
            "hasTeamId": !team_id.is_empty(),
            "hasKeyId": !key_id.is_empty(),
            "hasKeyPath": !key_path.is_empty(),
            "proxyUrl": proxy_url,
            "hasProxyKey": proxy_key.as_deref().map(|value| !value.is_empty()).unwrap_or(false),
        }),
    );
    send_sidecar_action(&state, "saving Apple Music settings", serde_json::json!({
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
    state.diagnostics.log_event("apple_music_test_requested", "Requested Apple Music credential test", json!({}));
    send_sidecar_action(&state, "testing Apple Music credentials", serde_json::json!({ "action": "testAppleMusicCredentials" }))?;
    Ok(())
}

#[tauri::command]
async fn get_apple_music_status(state: State<'_, AppState>) -> Result<(), String> {
    send_sidecar_action(&state, "loading Apple Music status", serde_json::json!({ "action": "getAppleMusicStatus" }))?;
    Ok(())
}

#[tauri::command]
async fn get_log_dir(_app: tauri::AppHandle) -> Result<String, String> {
    let log_dir = resolve_log_dir()?;
    Ok(log_dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn open_log_dir() -> Result<(), String> {
    let log_dir = resolve_log_dir()?;

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
    state.diagnostics.log_event("cache_clear_requested", "Requested clearing search cache", json!({}));
    send_sidecar_action(&state, "clearing the search cache", serde_json::json!({ "action": "clearCache" }))?;
    Ok(())
}

#[tauri::command]
async fn initialize_sidecar(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    ensure_sidecar_running(&state, &app)?;
    send_sidecar_action(&state, "initializing the search backend", serde_json::json!({ "action": "initialize" }))?;
    Ok(())
}

#[tauri::command]
async fn get_csv_preview(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<Vec<String>>, String> {
    // Delegate to sidecar for proper encoding detection and column normalization
    send_sidecar_action(&state, "loading the CSV preview", serde_json::json!({
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
    send_sidecar_action(&state, "saving preview edits", serde_json::json!({
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
    state.diagnostics.log_event(
        "load_exported_csv_requested",
        "Requested loading of exported CSV",
        json!({ "path": path }),
    );
    send_sidecar_action(&state, "loading an exported CSV", serde_json::json!({
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
    state.diagnostics.log_event(
        "search_missing_only_requested",
        "Requested search for missing tracks only",
        json!({ "provider": provider }),
    );
    send_sidecar_action(&state, "searching only missing tracks", serde_json::json!({
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
    match sidecar.restart(window, state.diagnostics.clone()) {
        Ok(()) => {
            set_startup_issue(state.inner(), None);
            state.diagnostics.log_event("sidecar_restarted", "Restarted sidecar process", json!({}));
        }
        Err(err) => {
            set_startup_issue(state.inner(), Some(err.clone()));
            state.diagnostics.log_event(
                "sidecar_restart_failed",
                "Failed to restart sidecar process",
                json!({ "error": err }),
            );
            return Err(format_sidecar_error(
                state.inner(),
                "restarting the search backend",
                &err,
            ));
        }
    }

    send_sidecar_action(&state, "re-initializing the search backend", serde_json::json!({ "action": "initialize" }))?;
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
            loaded_file: Mutex::new(None),
            diagnostics: SessionDiagnostics::new(env!("CARGO_PKG_VERSION"))
                .expect("failed to initialize session diagnostics"),
            startup_issue: Mutex::new(None),
        })
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .ok_or("No main window available")?;
            let state = app.state::<AppState>();
            let bundle_type = tauri::utils::platform::bundle_type()
                .map(|kind| format!("{kind:?}"))
                .unwrap_or_else(|| "unknown".to_string());
            state.diagnostics.log_event(
                "bundle_type_detected",
                "Detected runtime bundle type",
                json!({ "bundleType": bundle_type }),
            );
            let mut sidecar = state
                .sidecar
                .lock()
                .map_err(|_| "Failed to lock sidecar state during setup")?;

            // Start the sidecar
            if let Err(e) = sidecar.start(window, state.diagnostics.clone()) {
                set_startup_issue(state.inner(), Some(e.clone()));
                state.diagnostics.log_event(
                    "sidecar_start_failed",
                    "Failed to start sidecar during app setup",
                    json!({ "error": e }),
                );
                eprintln!("Failed to start sidecar: {}", e);
            } else {
                set_startup_issue(state.inner(), None);
                state.diagnostics.log_event(
                    "sidecar_started",
                    "Started sidecar during app setup",
                    json!({ "reason": "app_setup" }),
                );
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
            check_apple_music_api_status,
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
