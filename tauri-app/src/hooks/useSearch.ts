import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { SearchProgress, LogEntry } from "../lib/types";

export function useSearch(isTauri: boolean) {
    const [progress, setProgress] = useState<SearchProgress | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    // Track the last sidecar-reported elapsed so the local timer stays in sync
    const lastSidecarElapsed = useRef<number>(0);
    const localTickOffset = useRef<number>(0);

    const addLog = useCallback((type: LogEntry["type"], message: string) => {
        setLogs(prev => [
            ...prev.slice(-499), // keep last 500 entries
            { type, message, timestamp: new Date() }
        ]);
    }, []);

    // 1-second interval to tick elapsed while searching
    useEffect(() => {
        if (!isSearching || isPaused) {
            localTickOffset.current = 0;
            return;
        }
        const id = setInterval(() => {
            localTickOffset.current += 1;
            setProgress(prev => {
                if (!prev) return prev;
                return { ...prev, elapsedSeconds: lastSidecarElapsed.current + localTickOffset.current };
            });
        }, 1000);
        return () => clearInterval(id);
    }, [isSearching, isPaused]);

    useEffect(() => {
        if (!isTauri) return;

        const unlisteners: Promise<() => void>[] = [];

        // Search progress
        unlisteners.push(
            listen<SearchProgress>("search_progress", (event) => {
                // Sync the sidecar's authoritative elapsed and reset local offset
                lastSidecarElapsed.current = event.payload.elapsedSeconds ?? 0;
                localTickOffset.current = 0;
                setProgress(event.payload);
                // Also add to log so it's visible in the log panel
                if (event.payload?.status && event.payload.status !== "Complete") {
                    addLog("info", `[Progress] ${event.payload.status} (${event.payload.current}/${event.payload.total})`);
                }
                if (event.payload.status === "Complete") {
                    setIsSearching(false);
                    setIsPaused(false);
                }
            })
        );

        // Search paused
        unlisteners.push(
            listen<{ paused: boolean }>("search_paused", (event) => {
                setIsPaused(event.payload.paused);
            })
        );

        // Search stopped
        unlisteners.push(
            listen("search_stopped", () => {
                setIsSearching(false);
                setIsPaused(false);
            })
        );

        // Log messages
        unlisteners.push(
            listen<{ level: string; message: string }>("sidecar_log", (event) => {
                const level = event.payload.level;
                const logType: LogEntry["type"] =
                    level === "error" ? "error" :
                    level === "warning" ? "warning" :
                    level === "success" ? "success" : "info";
                addLog(logType, event.payload.message);
            })
        );

        // Status messages (from sidecar) — skip API status checks (shown as badges)
        unlisteners.push(
            listen<{ status: string }>("sidecar_status", (event) => {
                const s = event.payload.status;
                if (s.startsWith("iTunes API:") || s.startsWith("MusicBrainz API:") || s.startsWith("Apple Music API:")) return;
                addLog("info", s);
            })
        );

        // Sidecar errors
        unlisteners.push(
            listen<{ error: string; context?: string }>("sidecar_error", (event) => {
                addLog("error", `${event.payload.error}${event.payload.context ? ` (${event.payload.context})` : ""}`);
            })
        );

        // Export complete
        unlisteners.push(
            listen<{ success: boolean; format: string; path: string }>("export_complete", (event) => {
                if (event.payload.success) {
                    addLog("success", `Export complete: ${event.payload.path}`);
                } else {
                    addLog("error", `Export failed for format: ${event.payload.format}`);
                }
            })
        );

        return () => {
            unlisteners.forEach(p => p.then(fn => fn()));
        };
    }, [isTauri, addLog]);

    const handleStatusChange = (searching: boolean, paused: boolean) => {
        setIsSearching(searching);
        setIsPaused(paused);
    };

    const resetProgress = () => {
        setProgress(null);
        setIsSearching(false);
        setIsPaused(false);
    };

    const clearLogs = () => {
        setLogs([]);
    };

    return {
        progress,
        isSearching,
        isPaused,
        logs,
        handleStatusChange,
        resetProgress,
        clearLogs,
        addLog,
        setProgress,
    };
}
