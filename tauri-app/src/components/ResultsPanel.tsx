import { useEffect, useRef, useState } from "react";
import { MagnifyingGlass, Play, Pause, Stop, CheckCircle, XCircle, ArrowClockwise, Export, Copy, FolderOpen, FloppyDisk } from "@phosphor-icons/react";
import { Button } from "./ui/Button";

import { Dialog } from "./ui/Dialog";
import { SearchProgress, PROVIDERS, EXPORT_FORMATS, SearchProvider, ExportFormat } from "../lib/types";
import { startSearch, stopSearch, togglePause, exportResults, exportMissing, retryRateLimited, retryMissing, skipRateLimitWait, openFolder } from "../lib/commands";
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
    const [results, setResults] = useState<Map<number, TrackResult>>(new Map());
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
                const next = new Map(prev);
                updates.forEach((value, index) => {
                    next.set(index, value);
                });
                return next;
            });
        };

        unlisteners.push(
            listen<{ rowCount: number }>("csv_loaded", () => {
                setResults(new Map());
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
        setResults(new Map());
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

    const handleSaveProgress = async () => {
        setExporting(true);
        try {
            const dateSuffix = formatDateForFilename();
            const outputPath = await save({
                filters: [{ name: "Universal CSV", extensions: ["csv"] }],
                defaultPath: `progress_${dateSuffix}.csv`,
            });
            if (outputPath) {
                await exportResults("universal", outputPath);
                onExported(outputPath);
                toast.success("Progress saved. You can re-open this file later to continue searching.");
            }
        } catch (err) {
            console.error(err);
        } finally {
            setExporting(false);
        }
    };

    if (!isSearching && !progress) {
        return (
            <div className="px-4 py-3 border-b border-border">
                <button
                    onClick={handleStart}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-accent rounded-lg hover:bg-accent/90 transition-colors"
                >
                    <MagnifyingGlass size={15} weight="bold" />
                    Search with {PROVIDERS[provider].name}
                </button>
                {provider === "apple_music" && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground/70 leading-relaxed max-w-lg">
                        Uses album &amp; ISRC batch-matching before individual search — significantly faster for large libraries.
                    </p>
                )}
            </div>
        );
    }

    const rateLimited = progress?.rateLimited ?? 0;
    const isAppleMusic = provider === "apple_music";
    const isPrepPhase = progress ? progress.current === 0 && isSearching : false;
    const phaseNumber = progress?.status?.match(/Phase (\d)\/3/)?.[1];
    const resultsArray = Array.from(results.values());
    const foundTracks = resultsArray.filter((r) => r.status === "found").length;
    const missingRows = resultsArray.filter((r) => r.status === "missing");
    const missingCount = missingRows.length > 0 ? missingRows.length : (progress?.missing ?? 0);
    const filteredMissingRows = missingQuery.trim()
        ? missingRows.filter((row) => {
            const q = missingQuery.toLowerCase();
            return row.artist.toLowerCase().includes(q)
                || row.track.toLowerCase().includes(q)
                || row.album.toLowerCase().includes(q);
        })
        : missingRows;
    const isComplete = progress?.status === "Complete";
    const wasStopped = !isSearching && progress && !isComplete;
    const pct = progress && progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

    // Derive a clean display status (never show stale "Searching..." after stop)
    const displayStatus = (() => {
        if (isComplete) return "Complete";
        if (wasStopped) return `Stopped · ${progress?.found ?? 0} found`;
        if (isPaused) return "Paused";
        return progress?.status || "";
    })();

    return (
        <div className="px-4 py-3 border-b border-border space-y-2">
            {/* Export success banner */}
            {lastExportPath && (
                <div className="flex items-center gap-2 text-[11px] text-success-text bg-success/5 border border-success/15 rounded-md px-2.5 py-1.5">
                    <CheckCircle size={13} weight="fill" className="text-success flex-shrink-0" />
                    <span className="truncate flex-1 font-mono text-[10px]" title={lastExportPath}>{lastExportPath}</span>
                    <button
                        onClick={async () => {
                            try {
                                if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
                                await navigator.clipboard.writeText(lastExportPath);
                                toast.success("Path copied");
                            } catch { toast.error("Could not copy path"); }
                        }}
                        className="text-muted-foreground hover:text-foreground transition-colors px-1"
                        title="Copy path"
                    >
                        <Copy size={11} />
                    </button>
                    <button
                        onClick={async () => { try { await openFolder(lastExportPath); } catch { /* */ } }}
                        className="text-muted-foreground hover:text-foreground transition-colors px-1"
                        title="Show in folder"
                    >
                        <FolderOpen size={11} />
                    </button>
                </div>
            )}

            {/* ── TOP ROW: status left, actions right ── */}
            <div className="flex items-center justify-between gap-2">
                {/* Left: status text */}
                <span className="text-xs text-muted-foreground truncate">
                    {displayStatus}
                </span>

                {/* Right: action buttons */}
                <div className="flex items-center gap-1 flex-shrink-0">
                    {isSearching && (
                        <>
                            <button
                                onClick={handleTogglePause}
                                title={isPaused ? "Resume the search" : "Pause the search temporarily"}
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border border-border hover:bg-foreground-10 active:scale-95 transition-all"
                            >
                                {isPaused ? <Play size={11} weight="fill" /> : <Pause size={11} weight="fill" />}
                                {isPaused ? "Resume" : "Pause"}
                            </button>
                            <button
                                onClick={handleStop}
                                title="Stop the search — you can export what's been found so far"
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-muted-foreground rounded hover:bg-destructive/10 hover:text-destructive active:scale-95 transition-all"
                            >
                                <Stop size={11} weight="fill" />
                                Stop
                            </button>
                            {rateLimitWait.active && (
                                <button
                                    onClick={handleSkipCurrentWait}
                                    disabled={skipPending}
                                    title="Skip the current rate-limit cooldown and continue searching"
                                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-warning rounded border border-warning/20 bg-warning/5 hover:bg-warning/15 active:scale-95 transition-all disabled:opacity-40"
                                >
                                    Skip ({Math.ceil(rateLimitWait.seconds)}s)
                                </button>
                            )}
                        </>
                    )}
                    {!isSearching && (
                        <>
                            <button
                                onClick={handleStart}
                                title={`Restart the search using ${PROVIDERS[provider].name}`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border border-border hover:bg-foreground-10 active:scale-95 transition-all"
                            >
                                <ArrowClockwise size={11} />
                                Search Again
                            </button>
                            {foundTracks > 0 && (
                                <button
                                    onClick={handleExport}
                                    disabled={exporting}
                                    title={`Export ${foundTracks.toLocaleString()} matched tracks as ${EXPORT_FORMATS[exportFormat].name}`}
                                    className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-medium text-white bg-accent rounded hover:bg-accent/85 hover:shadow-sm active:scale-95 transition-all disabled:opacity-40"
                                >
                                    <Export size={11} />
                                    Export {foundTracks.toLocaleString()} · {EXPORT_FORMATS[exportFormat].name}
                                </button>
                            )}
                            {foundTracks > 0 && wasStopped && (
                                <button
                                    onClick={handleSaveProgress}
                                    disabled={exporting}
                                    title="Save a CSV with current results — re-open it later to search only the missing tracks"
                                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-muted-foreground rounded border border-border/60 hover:bg-foreground-10 hover:text-foreground active:scale-95 transition-all disabled:opacity-40"
                                >
                                    <FloppyDisk size={11} />
                                    Save for Later
                                </button>
                            )}
                            {missingCount > 0 && (
                                <button
                                    onClick={() => setMissingReviewOpen(true)}
                                    title={`Review ${missingCount} tracks that couldn't be matched — you can retry or export them`}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-muted-foreground rounded hover:bg-foreground-10 hover:text-foreground active:scale-95 transition-all"
                                >
                                    <XCircle size={11} />
                                    {missingCount} missing
                                </button>
                            )}
                            {rateLimited > 0 && (
                                <button
                                    onClick={handleRetryRateLimited}
                                    title={`Retry ${rateLimited} tracks that were skipped due to API rate limits`}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-warning rounded hover:bg-warning/10 active:scale-95 transition-all"
                                >
                                    <ArrowClockwise size={11} />
                                    Retry {rateLimited}
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* ── CENTER: current track (hero element) ── */}
            {progress?.currentTrack && isSearching && (
                <div className="text-center py-1">
                    <p className="text-sm font-medium truncate">{progress.currentTrack}</p>
                </div>
            )}

            {/* ── PROGRESS BAR + STATS ── */}
            {progress && (
                <div className="space-y-1">
                    {progress.current > 0 ? (
                        <>
                            <div className="h-1 bg-foreground-5 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                            <div className="flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground/70">
                                <span>{pct.toFixed(0)}%</span>
                                <span>{progress.current.toLocaleString()}/{progress.total.toLocaleString()}</span>
                                <span className="text-border">·</span>
                                <span className="text-success">{progress.found.toLocaleString()} found</span>
                                {progress.missing > 0 && (
                                    <>
                                        <span className="text-border">·</span>
                                        <span className="text-destructive">{progress.missing.toLocaleString()} missing</span>
                                    </>
                                )}
                                {rateLimited > 0 && (
                                    <>
                                        <span className="text-border">·</span>
                                        <span className="text-warning">{rateLimited.toLocaleString()} rate-limited</span>
                                    </>
                                )}
                                <span className="ml-auto flex items-center gap-2">
                                    {(progress.elapsedSeconds ?? 0) > 0 && (
                                        <span>Elapsed {formatTime(progress.elapsedSeconds ?? 0)}</span>
                                    )}
                                    {(progress.estimatedRemainingSeconds ?? 0) > 0 && (
                                        <span>ETA {formatTime(progress.estimatedRemainingSeconds ?? 0)}</span>
                                    )}
                                </span>
                            </div>
                        </>
                    ) : (
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
                            {(progress.elapsedSeconds ?? 0) > 0 && (
                                <span className="tabular-nums">Elapsed {formatTime(progress.elapsedSeconds ?? 0)}</span>
                            )}
                            {(progress.estimatedRemainingSeconds ?? 0) > 0 && (
                                <>
                                    <span className="text-border">·</span>
                                    <span className="tabular-nums">ETA {formatTime(progress.estimatedRemainingSeconds ?? 0)}</span>
                                </>
                            )}
                            {isPrepPhase && isAppleMusic && (
                                <>
                                    <span className="text-border">·</span>
                                    <span>
                                        {phaseNumber === "1" && "Album lookups cache all tracks — unavailable albums matched later"}
                                        {phaseNumber === "2" && "ISRCs looked up in batches of 25"}
                                        {!phaseNumber && "3-phase batch matching"}
                                    </span>
                                </>
                            )}
                        </div>
                    )}

                    {progress.current > 0 && progress.current <= 3 && isAppleMusic && isSearching && phaseNumber === "3" && (
                        <p className="text-[10px] text-muted-foreground/50">
                            Searching individually for remaining unmatched tracks
                        </p>
                    )}
                </div>
            )}

            {/* Inline stopped guidance */}
            {wasStopped && foundTracks === 0 && (
                <p className="text-[11px] text-muted-foreground/50 text-center">
                    Stopped before matching any tracks — click Search Again to restart
                </p>
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
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
}
