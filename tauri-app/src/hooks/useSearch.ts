import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { SearchProgress, LogEntry } from "../lib/types";

export function useSearch(isTauri: boolean) {
    const [progress, setProgress] = useState<SearchProgress | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);

    const addLog = useCallback((type: LogEntry["type"], message: string) => {
        setLogs(prev => [
            ...prev.slice(-499), // keep last 500 entries
            { type, message, timestamp: new Date() }
        ]);
    }, []);

    useEffect(() => {
        if (!isTauri) return;

        const unlisteners: Promise<() => void>[] = [];

        // Search progress
        unlisteners.push(
            listen<SearchProgress>("search_progress", (event) => {
                setProgress(event.payload);
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

        // Status messages (from sidecar)
        unlisteners.push(
            listen<{ status: string }>("sidecar_status", (event) => {
                addLog("info", event.payload.status);
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
