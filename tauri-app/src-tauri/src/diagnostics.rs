use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use time::format_description::well_known::Rfc3339;
use time::macros::format_description;
use time::OffsetDateTime;

#[derive(Clone, Debug)]
pub struct SessionDiagnostics {
    session_id: String,
    launch_at: String,
    log_dir: PathBuf,
    session_log_path: PathBuf,
    app_version: String,
    os_name: String,
    os_version: String,
    arch: String,
}

pub fn resolve_log_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot determine home directory".to_string())?;
    let home = PathBuf::from(home);

    let log_dir = if cfg!(target_os = "macos") {
        home.join("Library").join("Logs").join("AppleMusicConverter")
    } else if cfg!(target_os = "windows") {
        let local = std::env::var("LOCALAPPDATA")
            .unwrap_or_else(|_| home.join("AppData").join("Local").to_string_lossy().to_string());
        PathBuf::from(local).join("AppleMusicConverter").join("Logs")
    } else {
        home.join(".apple_music_converter").join("logs")
    };

    fs::create_dir_all(&log_dir).map_err(|e| format!("Failed to create log dir: {}", e))?;
    Ok(log_dir)
}

impl SessionDiagnostics {
    pub fn new(app_version: &str) -> Result<Self, String> {
        let log_dir = resolve_log_dir()?;
        let now = now_local_or_utc();
        let launch_at = format_timestamp(now);
        let stamp = now
            .format(&format_description!("[year][month][day]-[hour][minute][second]"))
            .unwrap_or_else(|_| now.unix_timestamp().to_string());
        let session_id = format!("session-{}-{}", stamp, std::process::id());
        let session_log_path = log_dir.join(format!("{session_id}.jsonl"));

        let os = os_info::get();
        let diagnostics = Self {
            session_id,
            launch_at,
            log_dir,
            session_log_path,
            app_version: app_version.to_string(),
            os_name: os.os_type().to_string(),
            os_version: os.version().to_string(),
            arch: std::env::consts::ARCH.to_string(),
        };

        let _ = fs::write(
            diagnostics.log_dir.join("latest-session-path.txt"),
            format!("{}\n", diagnostics.session_log_path.display()),
        );

        diagnostics.log_event(
            "session_start",
            "App launched",
            json!({
                "pid": std::process::id(),
                "logDir": diagnostics.log_dir.display().to_string(),
                "sessionLogPath": diagnostics.session_log_path.display().to_string(),
            }),
        );

        Ok(diagnostics)
    }

    pub fn session_log_path(&self) -> &Path {
        &self.session_log_path
    }

    pub fn log_dir(&self) -> &Path {
        &self.log_dir
    }

    pub fn log_event(&self, kind: &str, message: &str, data: Value) {
        let entry = json!({
            "timestamp": format_timestamp(now_local_or_utc()),
            "session": {
                "id": self.session_id,
                "launchedAt": self.launch_at,
            },
            "app": {
                "version": self.app_version,
            },
            "os": {
                "name": self.os_name,
                "version": self.os_version,
                "arch": self.arch,
            },
            "kind": kind,
            "message": message,
            "data": data,
        });

        match OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.session_log_path)
        {
            Ok(mut file) => {
                let _ = writeln!(file, "{}", entry);
            }
            Err(err) => {
                eprintln!(
                    "[diagnostics] Failed to write {}: {}",
                    self.session_log_path.display(),
                    err
                );
            }
        }
    }
}

fn now_local_or_utc() -> OffsetDateTime {
    OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc())
}

fn format_timestamp(time: OffsetDateTime) -> String {
    time.format(&Rfc3339)
        .unwrap_or_else(|_| time.unix_timestamp().to_string())
}
