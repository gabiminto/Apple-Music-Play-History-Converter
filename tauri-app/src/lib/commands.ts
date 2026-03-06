import { invoke } from "@tauri-apps/api/core";
import { FileInfo, DatabaseStatus } from "./types";

export interface PreviewEditRow {
    index: number;
    artist?: string;
    track?: string;
    album?: string;
}

// --- CSV Operations ---

export async function analyzeCsv(path: string): Promise<FileInfo> {
    return await invoke<FileInfo>("analyze_csv", { path });
}

export async function getCsvPreview(path: string): Promise<string[][]> {
    return await invoke<string[][]>("get_csv_preview", { path });
}

export async function setPreviewEdits(path: string, rows: PreviewEditRow[]): Promise<void> {
    return await invoke("set_preview_edits", { path, rows });
}

// --- Search Operations ---

export async function startSearch(filePath: string, provider: string): Promise<void> {
    return await invoke("start_search", { filePath, provider });
}

export async function stopSearch(): Promise<void> {
    return await invoke("stop_search");
}

export async function togglePause(): Promise<void> {
    return await invoke("toggle_pause");
}

export async function resumeSearch(provider?: string): Promise<void> {
    return await invoke("resume_search", { provider });
}

export async function getResumeState(): Promise<void> {
    return await invoke("get_resume_state");
}

export async function clearResumeState(): Promise<void> {
    return await invoke("clear_resume_state");
}

// --- Export Operations ---

export async function exportResults(format: string, outputPath: string): Promise<string> {
    return await invoke("export_results", { format, outputPath });
}

export async function exportMissing(outputPath: string): Promise<string> {
    return await invoke("export_missing", { outputPath });
}

export async function exportRateLimited(outputPath: string): Promise<string> {
    return await invoke("export_rate_limited", { outputPath });
}

export async function retryRateLimited(provider: string): Promise<void> {
    return await invoke("retry_rate_limited", { provider });
}

export async function retryMissing(provider: string): Promise<void> {
    return await invoke("retry_missing", { provider });
}

export async function skipRateLimitWait(): Promise<void> {
    return await invoke("skip_rate_limit_wait");
}

export async function loadExportedCsv(path: string): Promise<void> {
    return await invoke("load_exported_csv", { path });
}

export async function startSearchMissingOnly(provider: string): Promise<void> {
    return await invoke("start_search_missing_only", { provider });
}

// --- Database Operations ---

export async function getDatabaseStatus(): Promise<DatabaseStatus> {
    return await invoke("get_database_status");
}

export async function downloadDatabase(): Promise<void> {
    return await invoke("download_database");
}

export async function deleteDatabase(): Promise<void> {
    return await invoke("delete_database");
}

export async function checkDatabaseUpdates(): Promise<void> {
    return await invoke("check_database_updates");
}

export async function importDatabase(path: string): Promise<void> {
    return await invoke("import_database", { path });
}

export async function showDatabaseLocation(): Promise<void> {
    return await invoke("show_database_location");
}

export async function optimizeDatabase(): Promise<void> {
    return await invoke("optimize_database");
}

// --- Settings ---

export async function initializeSidecar(): Promise<void> {
    return await invoke("initialize_sidecar");
}

export async function setSettings(settings: Record<string, unknown>): Promise<void> {
    return await invoke("set_settings", { settings });
}

export async function getSettings(): Promise<void> {
    return await invoke("get_settings");
}

// --- API Status Checks ---

export async function checkItunesStatus(): Promise<void> {
    return await invoke("check_itunes_status");
}

export async function checkMusicBrainzApiStatus(): Promise<void> {
    return await invoke("check_musicbrainz_api_status");
}

// --- Apple Music API ---

export async function configureAppleMusic(
    teamId: string,
    keyId: string,
    keyPath: string,
    proxyUrl?: string,
    proxyKey?: string,
): Promise<void> {
    return await invoke("configure_apple_music", {
        teamId,
        keyId,
        keyPath,
        proxyUrl,
        proxyKey,
    });
}

export async function testAppleMusicCredentials(): Promise<void> {
    return await invoke("test_apple_music_credentials");
}

export async function getAppleMusicStatus(): Promise<void> {
    return await invoke("get_apple_music_status");
}

// --- System ---

export async function getLogDir(): Promise<string> {
    return await invoke<string>("get_log_dir");
}

export async function openLogDir(): Promise<void> {
    return await invoke("open_log_dir");
}

export async function openFolder(path: string): Promise<void> {
    return await invoke("open_folder", { path });
}

export async function clearCache(): Promise<void> {
    return await invoke("clear_cache");
}

export async function restartSidecar(): Promise<void> {
    return await invoke("restart_sidecar");
}
