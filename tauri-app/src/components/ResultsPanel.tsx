import { useEffect, useRef, useState } from "react";
import { MagnifyingGlass, Play, Pause, Stop, CheckCircle, XCircle, Clock, Warning, ArrowClockwise, Export, Copy, FolderOpen } from "@phosphor-icons/react";
import { Button } from "./ui/Button";
import { Progress } from "./ui/Progress";
import { Dialog } from "./ui/Dialog";
import { SearchProgress, PROVIDERS, EXPORT_FORMATS, SearchProvider, ExportFormat } from "../lib/types";
import { startSearch, stopSearch, togglePause, exportResults, exportMissing, exportRateLimited, retryRateLimited, retryMissing, skipRateLimitWait, openFolder } from "../lib/commands";
import { save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { toast } from "react-toastify";

interface ResultsPanelProps {
    progress: SearchProgress | null;
    provider: SearchProvider;
    isSearching: boolean;
    isPaused: boolean;
    filePath: string;
    onSearchStatusChange: (searching: boolean, paused: boolean) => void;
    exportFormat: ExportFormat;
    lastExportPath: string | null;
    onExported: (path: string) => void;
}

interface TrackResult {
    artist: string;
    track: string;
    album: string;
    status: "found" | "missing" | "rate_limited" | "pending";
    source: string;
}

export function ResultsPanel({
    progress,
    provider,
    isSearching,
    isPaused,
    filePath,
    onSearchStatusChange,
    exportFormat,
    lastExportPath,
    onExported
}: ResultsPanelProps) {
    const [exporting, setExporting] = useState(false);
    const [skipPending, setSkipPending] = useState(false);
    const [rateLimitWait, setRateLimitWait] = useState({ active: false, seconds: 0 });
    const [results, setResults] = useState<TrackResult[]>([]);
    const [missingReviewOpen, setMissingReviewOpen] = useState(false);
    const [missingQuery, setMissingQuery] = useState("");
    const [retryMissingPending, setRetryMissingPending] = useState(false);
    const pendingTrackUpdates = useRef<Map<number, TrackResult>>(new Map());
    const flushRafRef = useRef<number | null>(null);

    useEffect(() => {
        let cleanup: (() => void) | null = null;
        let disposed = false;

        listen<{ active?: boolean; seconds?: number }>("rate_limit_wait", (event) => {
            const active = Boolean(event.payload.active);
            const seconds = Math.max(0, Number(event.payload.seconds ?? 0));
            setRateLimitWait({ active, seconds });
            if (!active) {
                setSkipPending(false);
            }
        }).then((unlisten) => {
            if (disposed) {
                unlisten();
            } else {
                cleanup = unlisten;
            }
        }).catch(() => {
            // Browser mode/non-Tauri environment.
        });

        return () => {
            disposed = true;
            if (cleanup) cleanup();
        };
    }, []);

    useEffect(() => {
        const unlisteners: Promise<() => void>[] = [];
        const flushPending = () => {
            flushRafRef.current = null;
            if (pendingTrackUpdates.current.size === 0) {
                return;
            }
            const updates = pendingTrackUpdates.current;
            pendingTrackUpdates.current = new Map();
            setResults((prev) => {
                const next = [...prev];
                updates.forEach((value, index) => {
                    next[index] = value;
                });
                return next;
            });
        };

        unlisteners.push(
            listen<{ rowCount: number }>("csv_loaded", (event) => {
                setResults(
                    new Array(event.payload.rowCount).fill(null).map(() => ({
                        artist: "",
                        track: "",
                        album: "",
                        status: "pending" as const,
                        source: "",
                    }))
                );
                setMissingReviewOpen(false);
                setMissingQuery("");
            })
        );

        unlisteners.push(
            listen<{
                index: number;
                artist: string;
                track: string;
                album: string;
                found: boolean;
                rateLimited: boolean;
                source: string;
            }>("track_result", (event) => {
                const p = event.payload;
                const status: TrackResult["status"] = p.rateLimited
                    ? "rate_limited"
                    : p.found
                        ? "found"
                        : "missing";
                pendingTrackUpdates.current.set(p.index, {
                    artist: p.artist,
                    track: p.track,
                    album: p.album,
                    status,
                    source: p.source || "",
                });
                if (flushRafRef.current === null) {
                    flushRafRef.current = requestAnimationFrame(flushPending);
                }
            })
        );

        return () => {
            if (flushRafRef.current !== null) {
                cancelAnimationFrame(flushRafRef.current);
                flushRafRef.current = null;
            }
            pendingTrackUpdates.current.clear();
            unlisteners.forEach((p) => p.then((fn) => fn()));
        };
    }, []);

    useEffect(() => {
        setResults([]);
        setMissingReviewOpen(false);
        setMissingQuery("");
        pendingTrackUpdates.current.clear();
    }, [filePath]);

    const handleStart = async () => {
        onSearchStatusChange(true, false);
        try {
            await startSearch(filePath, provider);
        } catch (err) {
            console.error(err);
            onSearchStatusChange(false, false);
        }
    };

    const handleTogglePause = async () => {
        // Don't update UI state here - the sidecar will emit a search_paused event
        // with the actual state, which useSearch listens for
        await togglePause();
    };

    const handleStop = async () => {
        await stopSearch();
        onSearchStatusChange(false, false);
    };

    const formatDateForFilename = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const handleExport = async () => {
        if (!progress || progress.found === 0) return;
        setExporting(true);
        try {
            const formatInfo = EXPORT_FORMATS[exportFormat];
            const ext = formatInfo.ext.replace(".", "");
            const dateSuffix = formatDateForFilename();
            const outputPath = await save({
                filters: [{
                    name: formatInfo.name,
                    extensions: [ext]
                }],
                defaultPath: `converted_history_${dateSuffix}${formatInfo.ext}`
            });

            if (outputPath) {
                await exportResults(exportFormat, outputPath);
                onExported(outputPath);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setExporting(false);
        }
    };

    const handleExportMissing = async () => {
        try {
            const dateSuffix = formatDateForFilename();
            const outputPath = await save({
                filters: [{ name: "CSV Files", extensions: ["csv"] }],
                defaultPath: `missing_tracks_${dateSuffix}.csv`
            });
            if (outputPath) {
                await exportMissing(outputPath);
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleExportRateLimited = async () => {
        try {
            const dateSuffix = formatDateForFilename();
            const outputPath = await save({
                filters: [{ name: "CSV Files", extensions: ["csv"] }],
                defaultPath: `rate_limited_tracks_${dateSuffix}.csv`
            });
            if (outputPath) {
                await exportRateLimited(outputPath);
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleRetryRateLimited = async () => {
        onSearchStatusChange(true, false);
        try {
            await retryRateLimited(provider);
        } catch (err) {
            console.error(err);
            onSearchStatusChange(false, false);
        }
    };

    const handleRetryMissing = async () => {
        onSearchStatusChange(true, false);
        setRetryMissingPending(true);
        try {
            await retryMissing(provider);
            setMissingReviewOpen(false);
        } catch (err) {
            console.error(err);
            onSearchStatusChange(false, false);
            toast.error("Failed to retry missing tracks");
        } finally {
            setRetryMissingPending(false);
        }
    };

    const handleSkipCurrentWait = async () => {
        setSkipPending(true);
        try {
            await skipRateLimitWait();
        } catch (err) {
            console.error(err);
            setSkipPending(false);
            toast.error("Failed to skip current wait");
        }
    };

    if (!isSearching && !progress) {
        return (
            <div className="p-4 border-b border-border bg-foreground-5/30">
                <Button onClick={handleStart} icon={<MagnifyingGlass size={18} />}>
                    Search with {PROVIDERS[provider].name}
                </Button>
            </div>
        );
    }

    const rateLimited = progress?.rateLimited ?? 0;
    const missingRows = results.filter((r) => r.status === "missing");
    const missingCount = missingRows.length > 0 ? missingRows.length : (progress?.missing ?? 0);
    const filteredMissingRows = missingQuery.trim()
        ? missingRows.filter((row) => {
            const q = missingQuery.toLowerCase();
            return row.artist.toLowerCase().includes(q)
                || row.track.toLowerCase().includes(q)
                || row.album.toLowerCase().includes(q);
        })
        : missingRows;

    return (
        <div className="p-4 border-b border-border bg-foreground-5/30 space-y-4">
            {lastExportPath && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-success/5 border border-success/20 rounded-lg p-2">
                    <CheckCircle size={14} weight="fill" className="text-success flex-shrink-0" />
                    <span className="truncate flex-1 font-mono" title={lastExportPath}>{lastExportPath}</span>
                    <button
                        onClick={async () => {
                            try {
                                if (!navigator.clipboard?.writeText) {
                                    throw new Error("Clipboard API unavailable");
                                }
                                await navigator.clipboard.writeText(lastExportPath);
                                toast.success("Path copied to clipboard");
                            } catch (error) {
                                console.error(error);
                                toast.error("Could not copy path to clipboard on this system");
                            }
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded border border-border hover:bg-foreground-5 flex-shrink-0"
                        title="Copy path to clipboard"
                    >
                        <Copy size={12} /> Copy
                    </button>
                    <button
                        onClick={async () => {
                            try {
                                await openFolder(lastExportPath);
                            } catch { /* ignore */ }
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded border border-border hover:bg-foreground-5 flex-shrink-0"
                        title="Show in Finder"
                    >
                        <FolderOpen size={12} /> Show
                    </button>
                </div>
            )}

            {/* Search controls */}
            <div className="flex items-center gap-2">
                {!isSearching && !progress && (
                    <Button onClick={handleStart} icon={<MagnifyingGlass size={18} />}>
                        Search with {PROVIDERS[provider].name}
                    </Button>
                )}
                {isSearching && (
                    <>
                        <Button
                            variant="secondary"
                            onClick={handleTogglePause}
                            icon={isPaused ? <Play size={18} /> : <Pause size={18} />}
                        >
                            {isPaused ? "Resume" : "Pause"}
                        </Button>
                        <Button variant="ghost" onClick={handleStop} icon={<Stop size={18} />}>
                            Stop
                        </Button>
                        {rateLimitWait.active && (
                            <Button
                                variant="secondary"
                                onClick={handleSkipCurrentWait}
                                loading={skipPending}
                            >
                                Skip Current Wait
                            </Button>
                        )}
                    </>
                )}
            </div>

            {isSearching && rateLimitWait.active && (
                <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-lg px-2.5 py-1.5 inline-flex items-center gap-1.5">
                    <Warning size={12} weight="fill" />
                    Waiting on iTunes rate limit ({Math.ceil(rateLimitWait.seconds)}s)
                </div>
            )}

            {/* Progress display */}
            {progress && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                    <div className="flex justify-between text-sm">
                        <span className="font-medium text-muted-foreground">{progress.status}</span>
                        <span className="font-bold">
                            {progress.current.toLocaleString()} / {progress.total.toLocaleString()}
                        </span>
                    </div>

                    <Progress
                        value={(progress.current / progress.total) * 100}
                        showLabel
                        elapsedSeconds={progress.elapsedSeconds}
                        estimatedRemainingSeconds={progress.estimatedRemainingSeconds}
                    />

                    <div className="flex flex-wrap gap-4 text-sm mt-2">
                        <span className="flex items-center gap-1 text-success">
                            <CheckCircle size={16} weight="fill" />
                            <strong>{progress.found.toLocaleString()}</strong> found
                        </span>
                        <span className="flex items-center gap-1 text-destructive">
                            <XCircle size={16} weight="fill" />
                            <strong>{progress.missing.toLocaleString()}</strong> missing
                        </span>
                        {rateLimited > 0 && (
                            <span className="flex items-center gap-1 text-warning">
                                <Warning size={16} weight="fill" />
                                <strong>{rateLimited.toLocaleString()}</strong> rate-limited
                            </span>
                        )}
                        {progress.estimatedRemainingSeconds !== undefined && progress.estimatedRemainingSeconds > 0 && (
                            <span className="flex items-center gap-1 text-muted-foreground ml-auto">
                                <Clock size={16} />
                                ETA: {formatTime(progress.estimatedRemainingSeconds)}
                            </span>
                        )}
                    </div>

                    {progress.currentTrack && (
                        <div className="text-xs text-muted-foreground truncate font-mono bg-background/50 p-1 rounded">
                            {progress.currentTrack}
                        </div>
                    )}
                </div>
            )}

            {/* Post-search actions */}
            {progress && !isSearching && (
                <div className="pt-2 border-t border-border/50 space-y-2">
                    {/* Export found tracks */}
                    {progress.found > 0 && (
                        <Button
                            onClick={handleExport}
                            loading={exporting}
                            className="w-full"
                            icon={<Export size={18} />}
                        >
                            Export {progress.found.toLocaleString()} Tracks as {EXPORT_FORMATS[exportFormat].name}
                        </Button>
                    )}

                    {/* Secondary actions row */}
                    <div className="flex flex-wrap gap-2">
                        {missingCount > 0 && (
                            <Button
                                variant="secondary"
                                onClick={() => setMissingReviewOpen(true)}
                                className="text-xs"
                                icon={<MagnifyingGlass size={14} />}
                            >
                                Review Missing Tracks
                            </Button>
                        )}

                        {/* Export missing */}
                        {missingCount > 0 && (
                            <Button
                                variant="secondary"
                                onClick={handleExportMissing}
                                className="text-xs"
                                icon={<XCircle size={14} />}
                            >
                                Export {missingCount} Missing
                            </Button>
                        )}

                        {/* Rate limited controls */}
                        {rateLimited > 0 && (
                            <>
                                <Button
                                    variant="secondary"
                                    onClick={handleRetryRateLimited}
                                    className="text-xs"
                                    icon={<ArrowClockwise size={14} />}
                                >
                                    Retry {rateLimited} Rate-Limited
                                </Button>
                                <Button
                                    variant="ghost"
                                    onClick={handleExportRateLimited}
                                    className="text-xs"
                                    icon={<Export size={14} />}
                                >
                                    Export Rate-Limited
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            )}

            <Dialog
                open={missingReviewOpen}
                onClose={() => setMissingReviewOpen(false)}
                title={`Missing Tracks (${missingCount})`}
                width="xl"
                footer={(
                    <>
                        <Button variant="ghost" onClick={() => setMissingReviewOpen(false)}>
                            Close
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={handleRetryMissing}
                            loading={retryMissingPending}
                            disabled={missingRows.length === 0}
                        >
                            Retry Missing Tracks
                        </Button>
                        <Button onClick={handleExportMissing} disabled={missingCount === 0}>
                            Export Missing CSV
                        </Button>
                    </>
                )}
            >
                <div className="space-y-3">
                    <div className="flex items-center gap-2 bg-background border border-border rounded-lg px-2.5 py-1.5">
                        <MagnifyingGlass size={14} className="text-muted-foreground" />
                        <input
                            value={missingQuery}
                            onChange={(e) => setMissingQuery(e.target.value)}
                            placeholder="Filter missing tracks..."
                            className="w-full bg-transparent outline-none text-sm placeholder:text-muted-foreground/50"
                        />
                    </div>

                    {filteredMissingRows.length === 0 ? (
                        <div className="text-sm text-muted-foreground py-8 text-center">
                            {missingRows.length === 0
                                ? "No missing rows captured yet."
                                : `No missing rows match "${missingQuery}".`}
                        </div>
                    ) : (
                        <div className="max-h-[340px] overflow-auto border border-border rounded-lg divide-y divide-border/50">
                            {filteredMissingRows.map((row, index) => (
                                <div key={`${row.artist}-${row.track}-${index}`} className="p-2.5">
                                    <div className="text-sm font-medium truncate">{row.track || "-"}</div>
                                    <div className="text-xs text-muted-foreground truncate">
                                        {row.artist || "Unknown Artist"}
                                    </div>
                                    {row.album && (
                                        <div className="text-[11px] text-muted-foreground/80 truncate">{row.album}</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </Dialog>
        </div>
    );
}

function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}
