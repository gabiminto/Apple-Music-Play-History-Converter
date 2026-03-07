use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, SyncSender, TrySendError};
use std::thread;
use tauri::{Emitter, Manager, WebviewWindow};
use serde::{Deserialize, Serialize};

/// All message types the sidecar can send via stdout JSON.
/// We use `serde(tag = "type")` so the "type" field selects the variant.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum SidecarMessage {
    #[serde(rename = "ready")]
    Ready { version: String },

    #[serde(rename = "progress")]
    Progress(crate::SearchProgress),

    #[serde(rename = "fileAnalysis")]
    FileAnalysis(crate::FileInfo),

    #[serde(rename = "csvPreview")]
    CsvPreview {
        path: String,
        #[serde(default)]
        headers: Vec<String>,
        rows: Vec<Vec<String>>,
    },

    #[serde(rename = "csvLoaded")]
    CsvLoaded {
        success: bool,
        #[serde(rename = "rowCount")]
        row_count: usize,
        #[serde(rename = "fileType", default)]
        file_type: String,
    },

    #[serde(rename = "searchComplete")]
    SearchComplete {
        total: usize,
        found: usize,
        missing: usize,
        #[serde(rename = "rateLimited", default)]
        rate_limited: usize,
        provider: String,
    },

    #[serde(rename = "searchPaused")]
    SearchPaused { paused: bool },

    #[serde(rename = "searchStopped")]
    SearchStopped {
        #[serde(default)]
        success: bool,
        #[serde(default)]
        current: usize,
        #[serde(default)]
        total: usize,
        #[serde(default)]
        found: usize,
        #[serde(default)]
        missing: usize,
    },

    #[serde(rename = "exportComplete")]
    ExportComplete {
        success: bool,
        format: String,
        path: String,
        #[serde(default)]
        count: usize,
    },

    #[serde(rename = "error")]
    Error {
        error: String,
        #[serde(default)]
        context: String,
    },

    #[serde(rename = "status")]
    Status { status: String },

    #[serde(rename = "log")]
    Log {
        #[serde(default)]
        level: String,
        message: String,
    },

    #[serde(rename = "databaseStatus")]
    DatabaseStatus(crate::DatabaseStatus),

    #[serde(rename = "downloadProgress")]
    DownloadProgress {
        message: String,
        #[serde(default)]
        percent: f64,
    },

    #[serde(rename = "rateLimitWait")]
    RateLimitWait {
        active: bool,
        #[serde(default)]
        seconds: f64,
        #[serde(default)]
        skipped: bool,
    },

    #[serde(rename = "initialized")]
    Initialized { success: bool },

    #[serde(rename = "providerSet")]
    ProviderSet { provider: String },

    #[serde(rename = "settingsLoaded")]
    SettingsLoaded { settings: serde_json::Value },

    #[serde(rename = "appleMusicConfigured")]
    AppleMusicConfigured { success: bool },

    #[serde(rename = "appleMusicTestResult")]
    AppleMusicTestResult {
        success: bool,
        message: String,
    },

    #[serde(rename = "appleMusicStatus")]
    AppleMusicStatus {
        #[serde(rename = "hasBuiltin")]
        has_builtin: bool,
        #[serde(rename = "hasCustom")]
        has_custom: bool,
        #[serde(rename = "hasSharedProxy", default)]
        has_shared_proxy: bool,
        enabled: bool,
    },

    #[serde(rename = "resumeState")]
    ResumeState {
        available: bool,
        #[serde(rename = "filePath", default)]
        file_path: String,
        #[serde(rename = "fileType", default)]
        file_type: String,
        #[serde(default)]
        provider: String,
        #[serde(default)]
        current: usize,
        #[serde(default)]
        total: usize,
        #[serde(default)]
        found: usize,
        #[serde(default)]
        missing: usize,
        #[serde(rename = "rateLimited", default)]
        rate_limited: usize,
        #[serde(rename = "elapsedSeconds", default)]
        elapsed_seconds: f64,
    },

    #[serde(rename = "trackResult")]
    TrackResult {
        index: usize,
        artist: String,
        track: String,
        album: String,
        found: bool,
        #[serde(rename = "rateLimited", default)]
        rate_limited: bool,
        #[serde(default)]
        source: String,
    },

    #[serde(rename = "pong")]
    Pong,

    #[serde(other)]
    Unknown,
}

pub struct SidecarManager {
    process: Option<Child>,
    stdin_tx: Option<SyncSender<String>>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            process: None,
            stdin_tx: None,
        }
    }

    fn stop_process(&mut self) {
        // Drop sender first so writer thread exits cleanly.
        self.stdin_tx = None;
        if let Some(mut child) = self.process.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    fn parse_python_version(output: &str) -> Option<(u32, u32)> {
        let token = output
            .split_whitespace()
            .find(|part| part.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false))?;
        let mut parts = token.split('.');
        let major: u32 = parts.next()?.parse().ok()?;
        let minor: u32 = parts.next()?.parse().ok()?;
        Some((major, minor))
    }

    fn spawn_stdin_writer(stdin: ChildStdin) -> SyncSender<String> {
        let (tx, rx) = mpsc::sync_channel::<String>(1024);
        thread::spawn(move || {
            let mut writer = stdin;
            while let Ok(json_line) = rx.recv() {
                if writeln!(writer, "{json_line}")
                    .and_then(|_| writer.flush())
                    .is_err()
                {
                    break;
                }
            }
        });
        tx
    }

    pub fn start(&mut self, window: WebviewWindow) -> Result<(), String> {
        if self.process.is_some() {
            self.stop_process();
        }

        enum SidecarLaunch {
            PythonScript(std::path::PathBuf),
            BundledBinary(std::path::PathBuf),
        }

        // Detect sidecar path: dev vs production
        let launch = if cfg!(debug_assertions) {
            SidecarLaunch::PythonScript(std::path::PathBuf::from("../python-sidecar/sidecar.py"))
        } else {
            let app_handle = window.app_handle();
            let resource_path = app_handle
                .path()
                .resource_dir()
                .map_err(|e| format!("Failed to get resource dir: {}", e))?;

            let script = resource_path.join("python-sidecar").join("sidecar.py");
            let bundled_binary = if cfg!(target_os = "windows") {
                resource_path.join("python-sidecar").join("sidecar.exe")
            } else {
                resource_path.join("python-sidecar").join("sidecar")
            };

            // In production we prefer bundled binaries to avoid requiring system Python.
            if bundled_binary.exists() {
                SidecarLaunch::BundledBinary(bundled_binary)
            } else if script.exists() {
                SidecarLaunch::PythonScript(script)
            } else {
                return Err(format!(
                    "No sidecar found in production resources.\nExpected one of:\n- {}\n- {}",
                    script.display(),
                    bundled_binary.display()
                ));
            }
        };

        let sidecar_path = match &launch {
            SidecarLaunch::PythonScript(path) | SidecarLaunch::BundledBinary(path) => path,
        };

        if !sidecar_path.exists() {
            return Err(format!(
                "Sidecar not found at: {}\nCWD: {:?}\nResource dir: {:?}",
                sidecar_path.display(),
                std::env::current_dir(),
                window.app_handle().path().resource_dir()
            ));
        }

        let mut command = match &launch {
            SidecarLaunch::PythonScript(path) => {
                #[cfg(target_os = "windows")]
                let candidates: Vec<(&str, Vec<&str>)> = vec![
                    ("python", vec![]),
                    ("python3", vec![]),
                    ("py", vec!["-3"]),
                ];

                #[cfg(not(target_os = "windows"))]
                let candidates: Vec<(&str, Vec<&str>)> = vec![
                    ("python3", vec![]),
                    ("python", vec![]),
                ];

                let mut selected: Option<(String, Vec<String>)> = None;
                let mut discovered_versions: Vec<String> = Vec::new();
                for (cmd, pre_args) in candidates {
                    let mut check = Command::new(cmd);
                    for arg in &pre_args {
                        check.arg(arg);
                    }
                    check
                        .arg("--version")
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped());

                    if let Ok(output) = check.output() {
                        if !output.status.success() {
                            continue;
                        }
                        let version_output = format!(
                            "{} {}",
                            String::from_utf8_lossy(&output.stdout),
                            String::from_utf8_lossy(&output.stderr)
                        );
                        if let Some((major, minor)) = Self::parse_python_version(&version_output) {
                            discovered_versions.push(format!("{cmd} -> {major}.{minor}"));
                            if major > 3 || (major == 3 && minor >= 8) {
                                selected = Some((
                                    cmd.to_string(),
                                    pre_args.into_iter().map(|s| s.to_string()).collect(),
                                ));
                                break;
                            }
                        } else {
                            discovered_versions.push(format!(
                                "{cmd} -> unrecognized ({})",
                                version_output.trim()
                            ));
                        }
                    }
                }

                let (python_cmd, python_args) = selected.ok_or_else(|| {
                    let requirements = path.parent().unwrap_or(std::path::Path::new(".")).join("requirements.txt");
                    let discovered = if discovered_versions.is_empty() {
                        "No python interpreter was discovered in PATH.".to_string()
                    } else {
                        format!("Detected interpreters: {}", discovered_versions.join(", "))
                    };
                    format!(
                        "Python 3.8+ is required but was not found in PATH.\n{}\n\
Install Python 3.8+ and sidecar dependencies:\n\
python3 -m pip install -r {}",
                        discovered,
                        requirements.display()
                    )
                })?;

                // Auto-install Python dependencies from requirements.txt if present
                let requirements = path.parent()
                    .unwrap_or(std::path::Path::new("."))
                    .join("requirements.txt");
                if requirements.exists() {
                    println!("[Sidecar] Checking Python dependencies...");
                    let mut pip_cmd = Command::new(&python_cmd);
                    pip_cmd.args(["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "-r"]);
                    pip_cmd.arg(&requirements);
                    pip_cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
                    match pip_cmd.output() {
                        Ok(output) => {
                            if output.status.success() {
                                println!("[Sidecar] Dependencies OK");
                            } else {
                                let stderr = String::from_utf8_lossy(&output.stderr);
                                // Try with --break-system-packages for externally-managed envs (PEP 668)
                                if stderr.contains("externally-managed") {
                                    println!("[Sidecar] Retrying with --break-system-packages...");
                                    let mut pip_retry = Command::new(&python_cmd);
                                    pip_retry.args(["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--break-system-packages", "-r"]);
                                    pip_retry.arg(&requirements);
                                    pip_retry.stdout(Stdio::piped()).stderr(Stdio::piped());
                                    if let Ok(retry_out) = pip_retry.output() {
                                        if retry_out.status.success() {
                                            println!("[Sidecar] Dependencies installed (break-system-packages)");
                                        } else {
                                            eprintln!("[Sidecar] Warning: pip install failed: {}", String::from_utf8_lossy(&retry_out.stderr));
                                        }
                                    }
                                } else {
                                    eprintln!("[Sidecar] Warning: pip install failed: {}", stderr);
                                }
                            }
                        }
                        Err(e) => eprintln!("[Sidecar] Warning: Could not run pip: {}", e),
                    }
                }

                let mut cmd = Command::new(python_cmd);
                for arg in python_args {
                    cmd.arg(arg);
                }
                cmd.arg(path);
                cmd
            }
            SidecarLaunch::BundledBinary(path) => {
                let cmd = Command::new(path);
                cmd
            }
        };

        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command.spawn().map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

        let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;
        let stdin_tx = Self::spawn_stdin_writer(stdin);

        // Spawn thread to read stdout and dispatch events
        let window_clone = window.clone();
        let window_eof = window.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        if l.trim().is_empty() {
                            continue;
                        }
                        if let Ok(msg) = serde_json::from_str::<SidecarMessage>(&l) {
                            dispatch_message(&window_clone, msg);
                        } else {
                            // Check if it looks like JSON that failed to parse
                            if l.trim_start().starts_with('{') {
                                eprintln!("[Sidecar PARSE FAIL] {}", &l[..l.len().min(200)]);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Error reading sidecar stdout: {}", e);
                        let _ = window_clone.emit("sidecar_error", serde_json::json!({
                            "error": "Python sidecar process terminated unexpectedly",
                            "details": e.to_string()
                        }));
                        break;
                    }
                }
            }

            // EOF reached - sidecar died
            println!("[Sidecar] Process terminated");
            let _ = window_eof.emit("sidecar_terminated", serde_json::json!({
                "message": "Python sidecar stopped"
            }));
        });

        // Spawn thread to read stderr
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(l) = line {
                    eprintln!("[Sidecar stderr] {}", l);
                }
            }
        });

        self.stdin_tx = Some(stdin_tx);
        self.process = Some(child);
        Ok(())
    }

    pub fn send(&mut self, msg: serde_json::Value) -> Result<(), String> {
        if !self.is_alive() {
            return Err("Sidecar is not running".to_string());
        }
        let json = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        if let Some(tx) = &self.stdin_tx {
            match tx.try_send(json) {
                Ok(()) => Ok(()),
                Err(TrySendError::Full(_)) => Err(
                    "Sidecar command queue is full. Please wait and try again.".to_string(),
                ),
                Err(TrySendError::Disconnected(_)) => {
                    self.stdin_tx = None;
                    Err("Sidecar stdin channel disconnected".to_string())
                }
            }
        } else {
            Err("Sidecar stdin channel is unavailable".to_string())
        }
    }

    pub fn is_alive(&mut self) -> bool {
        let mut exited = false;
        let alive = if let Some(child) = &mut self.process {
            match child.try_wait() {
                Ok(Some(_)) => {
                    exited = true;
                    false
                }
                Ok(None) => true, // Still running
                Err(_) => {
                    exited = true;
                    false
                }
            }
        } else {
            false
        };
        if exited {
            self.process = None;
            self.stdin_tx = None;
        }
        alive
    }

    pub fn restart(&mut self, window: WebviewWindow) -> Result<(), String> {
        self.stop_process();

        // Start new process
        self.start(window)
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        self.stop_process();
    }
}

/// Dispatch a parsed sidecar message to the appropriate Tauri event.
fn dispatch_message(window: &WebviewWindow, msg: SidecarMessage) {
    match msg {
        SidecarMessage::Progress(p) => {
            let _ = window.emit("search_progress", &p);
        }

        SidecarMessage::SearchComplete { total, found, missing, rate_limited, provider } => {
            let _ = window.emit("search_progress", crate::SearchProgress {
                current: total,
                total,
                found,
                missing,
                provider,
                status: "Complete".to_string(),
                current_track: None,
                elapsed_seconds: None,
                estimated_remaining_seconds: None,
                rate_limited: Some(rate_limited),
            });
        }

        SidecarMessage::SearchPaused { paused } => {
            let _ = window.emit("search_paused", serde_json::json!({ "paused": paused }));
        }

        SidecarMessage::SearchStopped { success, current, total, found, missing } => {
            let _ = window.emit("search_stopped", serde_json::json!({
                "success": success,
                "current": current,
                "total": total,
                "found": found,
                "missing": missing,
            }));
            // Also send a log so the user sees a "stopped" message
            let _ = window.emit("sidecar_log", serde_json::json!({
                "level": "info",
                "message": format!("Search stopped by user ({} found, {} missing out of {})", found, missing, total),
            }));
        }

        SidecarMessage::FileAnalysis(info) => {
            let _ = window.emit("file_analysis", &info);
        }

        SidecarMessage::CsvPreview { path, headers, rows } => {
            let _ = window.emit("csv_preview", serde_json::json!({
                "path": path,
                "headers": headers,
                "rows": rows,
            }));
        }

        SidecarMessage::CsvLoaded { success, row_count, file_type } => {
            let _ = window.emit("csv_loaded", serde_json::json!({
                "success": success,
                "rowCount": row_count,
                "fileType": file_type,
            }));
        }

        SidecarMessage::ExportComplete { success, format, path, count } => {
            let _ = window.emit("export_complete", serde_json::json!({
                "success": success,
                "format": format,
                "path": path,
                "count": count,
            }));
        }

        SidecarMessage::DatabaseStatus(s) => {
            let _ = window.emit("database_status", &s);
        }

        SidecarMessage::DownloadProgress { message, percent } => {
            let _ = window.emit("download_progress", serde_json::json!({
                "message": message,
                "percent": percent,
            }));
        }

        SidecarMessage::RateLimitWait { active, seconds, skipped } => {
            let _ = window.emit("rate_limit_wait", serde_json::json!({
                "active": active,
                "seconds": seconds,
                "skipped": skipped,
            }));
        }

        SidecarMessage::Error { error, context } => {
            let _ = window.emit("sidecar_error", serde_json::json!({
                "error": error,
                "context": context,
            }));
        }

        SidecarMessage::Status { status } => {
            let _ = window.emit("sidecar_status", serde_json::json!({
                "status": status,
            }));
        }

        SidecarMessage::Log { level, message } => {
            let _ = window.emit("sidecar_log", serde_json::json!({
                "level": level,
                "message": message,
            }));
        }

        SidecarMessage::Initialized { success } => {
            let _ = window.emit("sidecar_initialized", serde_json::json!({
                "success": success,
            }));
        }

        SidecarMessage::ProviderSet { provider } => {
            let _ = window.emit("provider_set", serde_json::json!({
                "provider": provider,
            }));
        }

        SidecarMessage::SettingsLoaded { settings } => {
            let _ = window.emit("settings_loaded", settings);
        }

        SidecarMessage::AppleMusicConfigured { success } => {
            let _ = window.emit("apple_music_configured", serde_json::json!({
                "success": success,
            }));
        }

        SidecarMessage::AppleMusicTestResult { success, message } => {
            let _ = window.emit("apple_music_test_result", serde_json::json!({
                "success": success,
                "message": message,
            }));
        }

        SidecarMessage::AppleMusicStatus {
            has_builtin,
            has_custom,
            has_shared_proxy,
            enabled,
        } => {
            let _ = window.emit("apple_music_status", serde_json::json!({
                "hasBuiltin": has_builtin,
                "hasCustom": has_custom,
                "hasSharedProxy": has_shared_proxy,
                "enabled": enabled,
            }));
        }

        SidecarMessage::ResumeState {
            available,
            file_path,
            file_type,
            provider,
            current,
            total,
            found,
            missing,
            rate_limited,
            elapsed_seconds,
        } => {
            let _ = window.emit("resume_state", serde_json::json!({
                "available": available,
                "filePath": file_path,
                "fileType": file_type,
                "provider": provider,
                "current": current,
                "total": total,
                "found": found,
                "missing": missing,
                "rateLimited": rate_limited,
                "elapsedSeconds": elapsed_seconds,
            }));
        }

        SidecarMessage::TrackResult { index, artist, track, album, found, rate_limited, source } => {
            let _ = window.emit("track_result", serde_json::json!({
                "index": index,
                "artist": artist,
                "track": track,
                "album": album,
                "found": found,
                "rateLimited": rate_limited,
                "source": source,
            }));
        }

        SidecarMessage::Ready { version } => {
            println!("[Sidecar] Ready v{}", version);
            let _ = window.emit("sidecar_ready", serde_json::json!({
                "version": version,
            }));
        }

        SidecarMessage::Pong => {
            let _ = window.emit("sidecar_pong", serde_json::json!({}));
        }

        SidecarMessage::Unknown => {
            // Ignore unknown messages
        }
    }
}
