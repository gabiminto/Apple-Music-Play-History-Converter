import { useState, useEffect, useCallback, useRef } from "react";
import { File, Spinner, X, UploadSimple } from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useTauri } from "../hooks/useTauri";
import { analyzeCsv } from "../lib/commands";
import { FileInfo } from "../lib/types";

interface FileSelectionProps {
    onFileSelect: (info: FileInfo) => void;
    onClear: () => void;
    currentFile: FileInfo | null;
    disabled?: boolean;
}

export function FileSelection({ onFileSelect, onClear, currentFile, disabled }: FileSelectionProps) {
    const isTauri = useTauri();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);

    // Ref to hold pending file info while we wait for sidecar's converted CSV analysis
    const pendingFileRef = useRef<FileInfo | null>(null);
    const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Listen for sidecar fileAnalysis event (has isConvertedCsv info)
    useEffect(() => {
        if (!isTauri) return;

        const unlisten = listen<{
            path: string;
            isConvertedCsv?: boolean;
            foundCount?: number;
            missingCount?: number;
        }>("file_analysis", (event) => {
            const p = event.payload;
            if (pendingFileRef.current && pendingFileRef.current.path === p.path) {
                // Clear the fallback timer
                if (pendingTimerRef.current) {
                    clearTimeout(pendingTimerRef.current);
                    pendingTimerRef.current = null;
                }
                const mergedInfo: FileInfo = {
                    ...pendingFileRef.current,
                    isConvertedCsv: p.isConvertedCsv ?? false,
                    foundCount: p.foundCount ?? 0,
                    missingCount: p.missingCount ?? 0,
                };
                pendingFileRef.current = null;
                onFileSelect(mergedInfo);
            }
        });

        return () => {
            if (pendingTimerRef.current) {
                clearTimeout(pendingTimerRef.current);
                pendingTimerRef.current = null;
            }
            pendingFileRef.current = null;
            unlisten.then(fn => fn());
        };
    }, [isTauri, onFileSelect]);

    const loadFile = useCallback(async (filePath: string) => {
        if (!filePath.toLowerCase().endsWith(".csv")) {
            setError("Please select a CSV file");
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const info = await analyzeCsv(filePath);
            // Store pending and wait briefly for sidecar's fileAnalysis event
            if (pendingTimerRef.current) {
                clearTimeout(pendingTimerRef.current);
                pendingTimerRef.current = null;
            }
            pendingFileRef.current = info;
            pendingTimerRef.current = setTimeout(() => {
                if (pendingFileRef.current) {
                    const pending = pendingFileRef.current;
                    pendingFileRef.current = null;
                    onFileSelect(pending);
                }
            }, 800);
        } catch (err) {
            console.error(err);
            setError(`Failed to load file: ${err}`);
        } finally {
            setLoading(false);
        }
    }, [onFileSelect]);

    // Listen for Tauri file drop events
    useEffect(() => {
        if (!isTauri || disabled) return;

        const unlisteners: Promise<() => void>[] = [];

        unlisteners.push(
            listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
                setIsDragOver(false);
                const paths = event.payload.paths;
                if (paths && paths.length > 0) {
                    loadFile(paths[0]);
                }
            })
        );

        unlisteners.push(
            listen("tauri://drag-enter", () => {
                setIsDragOver(true);
            })
        );

        unlisteners.push(
            listen("tauri://drag-leave", () => {
                setIsDragOver(false);
            })
        );

        return () => {
            unlisteners.forEach(p => p.then(fn => fn()));
        };
    }, [isTauri, disabled, loadFile]);

    const handleSelect = async () => {
        if (!isTauri) {
            setError("Please use the native Tauri app to select files.");
            return;
        }

        setError(null);

        try {
            const selected = await open({
                multiple: false,
                filters: [{ name: "CSV Files", extensions: ["csv"] }],
            });

            if (selected && typeof selected === "string") {
                await loadFile(selected);
            }
        } catch (err) {
            console.error(err);
            setError(`Failed to load file: ${err}`);
        }
    };

    if (currentFile) {
        return (
            <div className="refined-card p-5 shadow-medium hover-scale">
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        <h3 className="font-semibold text-base flex items-center gap-2 mb-3">
                            <div className="p-1.5 rounded-lg bg-accent/15 text-accent">
                                <File size={18} weight="fill" />
                            </div>
                            <span className="truncate">{currentFile.name}</span>
                        </h3>
                        <div className="flex flex-wrap gap-2 text-sm">
                            <span className="px-2.5 py-1 rounded-lg bg-foreground-5 text-foreground-80 font-medium">
                                <strong className="text-foreground">{currentFile.rowCount.toLocaleString()}</strong> tracks
                            </span>
                            <span className="px-2.5 py-1 rounded-lg bg-foreground-5 text-foreground-60">
                                {formatFileSize(currentFile.size)}
                            </span>
                            <span className="status-badge status-badge-success">
                                {currentFile.fileType}
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={onClear}
                        className="ml-3 p-2 text-foreground-50 hover:text-destructive hover:bg-destructive/10 transition-all rounded-lg"
                        disabled={disabled}
                        title="Clear file"
                    >
                        <X size={16} weight="bold" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div>
            <button
                onClick={handleSelect}
                disabled={loading || disabled || !isTauri}
                className={`w-full h-32 border-2 border-dashed rounded-xl
                   flex flex-col items-center justify-center gap-2
                   transition-all cursor-pointer
                   disabled:opacity-50 disabled:cursor-not-allowed group focus:outline-none focus:ring-2 focus:ring-accent
                   ${isDragOver
                       ? "border-accent bg-accent/10 scale-[1.02]"
                       : "border-border bg-foreground-5/40 hover:border-accent hover:bg-foreground-5/70"
                   }`}
            >
                {loading ? (
                    <Spinner size={32} className="animate-spin text-accent" />
                ) : isDragOver ? (
                    <>
                        <UploadSimple size={32} className="text-accent animate-bounce" />
                        <span className="text-base font-medium text-accent">Drop CSV File Here</span>
                    </>
                ) : (
                    <>
                        <File size={32} className="text-muted-foreground group-hover:text-accent transition-colors" />
                        <span className="text-base font-medium">Select or Drop CSV File</span>
                        <span className="text-xs text-muted-foreground">
                            Play Activity, Recently Played, or Play History Daily Tracks
                        </span>
                    </>
                )}
            </button>
            {error && <p className="mt-2 text-sm text-destructive text-center">{error}</p>}
        </div>
    );
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
