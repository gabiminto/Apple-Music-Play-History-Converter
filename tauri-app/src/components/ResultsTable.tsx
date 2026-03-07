import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { CheckCircle, XCircle, Warning, Spinner, ListBullets, MagnifyingGlass, X, CaretUp, CaretDown, Copy } from "@phosphor-icons/react";
import { toast } from "react-toastify";
import { SearchProgress } from "../lib/types";

interface ResultsTableProps {
    progress: SearchProgress | null;
    isSearching: boolean;
    filePath: string | null;
}

interface TrackResult {
    artist: string;
    track: string;
    album: string;
    status: "found" | "missing" | "rate_limited" | "pending";
    source: string;
}

type SortDirection = "asc" | "desc" | null;

const COLUMNS = ["", "Artist", "Track", "Album", "Source"];

export function ResultsTable({ progress, isSearching, filePath }: ResultsTableProps) {
    const [results, setResults] = useState<Map<number, TrackResult>>(new Map());
    const [totalRowCount, setTotalRowCount] = useState(0);
    const [filter, setFilter] = useState<"all" | "found" | "missing" | "rate_limited">("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [sortCol, setSortCol] = useState<number | null>(null);
    const [sortDir, setSortDir] = useState<SortDirection>(null);
    const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
    const tableRef = useRef<HTMLTableElement>(null);
    const resizingCol = useRef<number | null>(null);
    const startX = useRef(0);
    const startWidth = useRef(0);
    const pendingTrackUpdates = useRef<Map<number, TrackResult>>(new Map());
    const flushRafRef = useRef<number | null>(null);

    // Listen for individual track results from sidecar - uses Map for O(1) updates
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

        // Track result events
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
                const status: TrackResult["status"] = p.rateLimited ? "rate_limited" : p.found ? "found" : "missing";
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

        // CSV loaded - just track the row count, don't create huge arrays
        unlisteners.push(
            listen<{ rowCount: number }>("csv_loaded", (event) => {
                setTotalRowCount(event.payload.rowCount);
                setResults(new Map());
            })
        );

        return () => {
            if (flushRafRef.current !== null) {
                cancelAnimationFrame(flushRafRef.current);
                flushRafRef.current = null;
            }
            pendingTrackUpdates.current.clear();
            unlisteners.forEach(p => p.then(fn => fn()));
        };
    }, []);

    useEffect(() => {
        if (!filePath) {
            setResults(new Map());
            setTotalRowCount(0);
            setSearchQuery("");
            setFilter("all");
            setSortCol(null);
            setSortDir(null);
            pendingTrackUpdates.current.clear();
        }
    }, [filePath]);

    // Column resize
    const handleResizeStart = useCallback((colIndex: number, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        resizingCol.current = colIndex;
        startX.current = e.clientX;
        const th = tableRef.current?.querySelectorAll("th")[colIndex];
        startWidth.current = th?.offsetWidth ?? 150;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        const handleMouseMove = (ev: MouseEvent) => {
            if (resizingCol.current === null) return;
            const delta = ev.clientX - startX.current;
            const newWidth = Math.max(40, startWidth.current + delta);
            setColumnWidths(prev => ({ ...prev, [resizingCol.current!]: newWidth }));
        };
        const handleMouseUp = () => {
            resizingCol.current = null;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
    }, []);

    // Sort handler
    const handleSort = useCallback((colIndex: number) => {
        if (colIndex === 0) return; // Don't sort the status icon column
        if (sortCol === colIndex) {
            if (sortDir === "asc") setSortDir("desc");
            else if (sortDir === "desc") { setSortCol(null); setSortDir(null); }
            else setSortDir("asc");
        } else {
            setSortCol(colIndex);
            setSortDir("asc");
        }
    }, [sortCol, sortDir]);

    // If no progress or search hasn't started, show nothing
    if (!progress && !isSearching && results.size === 0 && totalRowCount === 0) {
        return null;
    }

    // Convert Map to array for display — only the entries we actually have
    const resultsArray = Array.from(results.values());

    const counts = {
        all: totalRowCount,
        found: resultsArray.filter(r => r.status === "found").length,
        missing: resultsArray.filter(r => r.status === "missing").length,
        rate_limited: resultsArray.filter(r => r.status === "rate_limited").length,
    };

    // Filter by status, then by search, then sort
    const getFieldByCol = (r: TrackResult, col: number): string => {
        switch (col) {
            case 1: return r.artist;
            case 2: return r.track;
            case 3: return r.album;
            case 4: return r.source;
            default: return r.status;
        }
    };

    let filtered = filter === "all" ? resultsArray : resultsArray.filter(r => r.status === filter);

    if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(r =>
            r.artist.toLowerCase().includes(query) ||
            r.track.toLowerCase().includes(query) ||
            r.album.toLowerCase().includes(query) ||
            r.source.toLowerCase().includes(query)
        );
    }

    if (sortCol !== null && sortDir !== null) {
        filtered = [...filtered].sort((a, b) => {
            const aVal = getFieldByCol(a, sortCol).toLowerCase();
            const bVal = getFieldByCol(b, sortCol).toLowerCase();
            const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
            return sortDir === "asc" ? cmp : -cmp;
        });
    }

    // Cap rendered rows to avoid freezing the browser with large datasets
    const MAX_VISIBLE_ROWS = 500;
    const totalFiltered = filtered.length;
    const visibleRows = totalFiltered > MAX_VISIBLE_ROWS ? filtered.slice(0, MAX_VISIBLE_ROWS) : filtered;

    const statusIcon = (status: TrackResult["status"]) => {
        switch (status) {
            case "found":
                return <CheckCircle size={14} weight="fill" className="text-success" />;
            case "missing":
                return <XCircle size={14} weight="fill" className="text-destructive" />;
            case "rate_limited":
                return <Warning size={14} weight="fill" className="text-warning" />;
            case "pending":
                return <Spinner size={14} className="text-muted-foreground animate-spin" />;
        }
    };

    return (
        <div className="h-full flex flex-col">
            {/* Filter bar + search */}
            <div className="flex-shrink-0 p-2 bg-foreground-5/30 border-b border-border flex items-center gap-2">
                <ListBullets size={14} className="text-muted-foreground flex-shrink-0" />
                <div className="flex gap-1 flex-shrink-0">
                    {(["all", "found", "missing", "rate_limited"] as const).map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                                filter === f
                                    ? "bg-accent/10 border-accent/50 text-accent font-medium"
                                    : "border-transparent text-muted-foreground hover:bg-foreground-5"
                            }`}
                        >
                            {f === "all" ? "All" : f === "found" ? "Found" : f === "missing" ? "Missing" : "Rate-Limited"}
                            {" "}
                            <span className="font-bold">{counts[f].toLocaleString()}</span>
                        </button>
                    ))}
                </div>

                <div className="flex-1" />

                {/* Inline search */}
                <div className="flex items-center gap-1.5 bg-background/60 border border-border rounded-lg px-2 py-1 max-w-[200px]">
                    <MagnifyingGlass size={12} className="text-muted-foreground flex-shrink-0" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search results..."
                        className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 min-w-0"
                    />
                    {searchQuery && (
                        <button onClick={() => setSearchQuery("")} className="text-muted-foreground hover:text-foreground">
                            <X size={10} />
                        </button>
                    )}
                </div>
                {searchQuery && (
                    <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
                        {totalFiltered}/{counts[filter]}
                    </span>
                )}

                {/* Copy to clipboard */}
                {counts.found > 0 && (
                    <button
                        onClick={async () => {
                            const found = resultsArray.filter(r => r.status === "found");
                            const csv = ["Artist,Track,Album,Source",
                                ...found.map(r =>
                                    [r.artist, r.track, r.album, r.source]
                                        .map(f => `"${(f || "").replace(/"/g, '""')}"`)
                                        .join(",")
                                )
                            ].join("\n");
                            try {
                                if (!navigator.clipboard?.writeText) {
                                    throw new Error("Clipboard API unavailable");
                                }
                                await navigator.clipboard.writeText(csv);
                                toast.success(`Copied ${found.length} tracks to clipboard`);
                            } catch (error) {
                                console.error(error);
                                toast.error("Could not copy to clipboard on this system");
                            }
                        }}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-border hover:bg-foreground-5 transition-colors flex-shrink-0"
                        title="Copy found tracks as CSV"
                    >
                        <Copy size={11} /> Copy
                    </button>
                )}
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto bg-background">
                {totalFiltered === 0 ? (
                    <div className="p-8 text-center text-muted-foreground text-sm">
                        {results.size === 0
                            ? (totalRowCount > 0
                                ? `Searching ${totalRowCount.toLocaleString()} tracks...`
                                : "Results will appear here after search starts")
                            : searchQuery
                                ? `No matches for "${searchQuery}"`
                                : `No ${filter} tracks`
                        }
                    </div>
                ) : (
                    <table ref={tableRef} className="w-full text-sm" style={{ tableLayout: Object.keys(columnWidths).length > 0 ? "fixed" : "auto" }}>
                        <thead className="sticky top-0 bg-background z-10 border-b border-border">
                            <tr>
                                {COLUMNS.map((header, i) => (
                                    <th
                                        key={i}
                                        className={`px-2 py-1.5 text-left text-xs font-semibold text-muted-foreground relative select-none group ${i === 0 ? "w-8" : ""}`}
                                        style={columnWidths[i] ? { width: columnWidths[i] } : undefined}
                                    >
                                        <div
                                            className={`flex items-center gap-1 ${i > 0 ? "cursor-pointer hover:text-foreground" : ""}`}
                                            onClick={() => handleSort(i)}
                                        >
                                            <span className="truncate">{header}</span>
                                            {i > 0 && sortCol === i && (
                                                <span className="flex-shrink-0 text-accent">
                                                    {sortDir === "asc" ? <CaretUp size={10} weight="bold" /> : <CaretDown size={10} weight="bold" />}
                                                </span>
                                            )}
                                            {i > 0 && sortCol !== i && (
                                                <span className="flex-shrink-0 opacity-0 group-hover:opacity-30">
                                                    <CaretUp size={8} />
                                                </span>
                                            )}
                                        </div>
                                        {/* Resize handle */}
                                        {i > 0 && (
                                            <div
                                                className="absolute top-0 right-0 w-[5px] h-full cursor-col-resize opacity-0 hover:opacity-100 active:opacity-100 z-20"
                                                onMouseDown={(e) => handleResizeStart(i, e)}
                                            >
                                                <div className="w-[2px] h-full mx-auto bg-accent/40" />
                                            </div>
                                        )}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {visibleRows.map((r, i) => (
                                <tr key={i} className="border-t border-border/30 hover:bg-foreground-5/30">
                                    <td className="px-2 py-1">{statusIcon(r.status)}</td>
                                    <td className="px-2 py-1 truncate" title={r.artist}>{r.artist || "-"}</td>
                                    <td className="px-2 py-1 truncate" title={r.track}>{r.track || "-"}</td>
                                    <td className="px-2 py-1 truncate" title={r.album}>{r.album || "-"}</td>
                                    <td className="px-2 py-1 text-xs text-muted-foreground truncate" title={r.source}>{r.source || "-"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                {totalFiltered > MAX_VISIBLE_ROWS && (
                    <div className="p-2 text-center text-xs text-muted-foreground bg-foreground-5/30 border-t border-border">
                        Showing {MAX_VISIBLE_ROWS.toLocaleString()} of {totalFiltered.toLocaleString()} rows. Use filters or search to narrow results.
                    </div>
                )}
            </div>
        </div>
    );
}
