import { useEffect, useRef, useState, useCallback } from "react";
import { getCsvPreview, setPreviewEdits } from "../lib/commands";
import { listen } from "@tauri-apps/api/event";
import { ChartBar, Spinner } from "@phosphor-icons/react";

interface PreviewTableProps {
    filePath: string | null;
}

interface PreviewRow {
    artist: string;
    track: string;
    album: string;
    timestamp: string;
    duration: string;
}

interface CsvPreviewPayload {
    path: string;
    headers?: string[];
    rows: string[][];
}

function mapPreviewRows(rows: string[][]): PreviewRow[] {
    return rows.map((row) => ({
        artist: row[0] ?? "",
        track: row[1] ?? "",
        album: row[2] ?? "",
        timestamp: row[3] ?? "",
        duration: row[4] ?? "",
    }));
}

export function PreviewTable({ filePath }: PreviewTableProps) {
    const [headers, setHeaders] = useState<string[]>(["Artist", "Track", "Album", "Timestamp", "Duration"]);
    const [rows, setRows] = useState<PreviewRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingSlow, setLoadingSlow] = useState(false);
    const [applying, setApplying] = useState(false);
    const [editedIndexes, setEditedIndexes] = useState<Set<number>>(new Set());
    const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
    const tableRef = useRef<HTMLTableElement>(null);
    const resizingCol = useRef<number | null>(null);
    const startX = useRef(0);
    const startWidth = useRef(0);
    const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    const clearLoadingTimer = () => {
        if (loadingTimerRef.current) {
            clearTimeout(loadingTimerRef.current);
            loadingTimerRef.current = null;
        }
    };

    useEffect(() => {
        if (filePath) {
            void loadPreview(filePath);
        } else {
            clearLoadingTimer();
            setRows([]);
            setEditedIndexes(new Set());
            setColumnWidths({});
            setLoading(false);
            setLoadingSlow(false);
        }
        return () => {
            clearLoadingTimer();
        };
    }, [filePath]);

    // Listen for csv_preview events from sidecar (normalized data)
    useEffect(() => {
        const unlisten = listen<CsvPreviewPayload>("csv_preview", (event) => {
            const payload = event.payload;
            if (filePath && payload.path && payload.path !== filePath) {
                return;
            }
            if (payload.headers && payload.headers.length > 0) {
                setHeaders(payload.headers);
            }
            setRows(mapPreviewRows(payload.rows));
            setEditedIndexes(new Set());
            clearLoadingTimer();
            setLoading(false);
            setLoadingSlow(false);
        });

        return () => {
            clearLoadingTimer();
            unlisten.then((fn) => fn());
        };
    }, [filePath]);

    const loadPreview = async (path: string) => {
        clearLoadingTimer();
        setLoading(true);
        setLoadingSlow(false);
        try {
            // This triggers the sidecar to send a csv_preview event.
            await getCsvPreview(path);
            // Show "taking longer" message after 10s, but don't auto-dismiss.
            loadingTimerRef.current = setTimeout(() => setLoadingSlow(true), 10000);
        } catch (e) {
            console.error(e);
            clearLoadingTimer();
            setLoading(false);
            setLoadingSlow(false);
        }
    };

    const handleCellChange = (index: number, field: "artist" | "track" | "album", value: string) => {
        setRows((prev) =>
            prev.map((row, rowIndex) =>
                rowIndex === index ? { ...row, [field]: value } : row
            )
        );
        setEditedIndexes((prev) => {
            const next = new Set(prev);
            next.add(index);
            return next;
        });
    };

    const handleApplyEdits = async () => {
        if (!filePath || editedIndexes.size === 0) {
            return;
        }

        setApplying(true);
        try {
            const payload = Array.from(editedIndexes)
                .sort((a, b) => a - b)
                .map((index) => ({
                    index,
                    artist: rows[index]?.artist ?? "",
                    track: rows[index]?.track ?? "",
                    album: rows[index]?.album ?? "",
                }));
            await setPreviewEdits(filePath, payload);
            setEditedIndexes(new Set());
        } catch (e) {
            console.error(e);
        } finally {
            setApplying(false);
        }
    };

    if (!filePath) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
                <ChartBar size={48} className="mb-4 opacity-20" />
                <p>Select a CSV file to see a preview of the tracks</p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-3">
                <Spinner size={32} className="animate-spin text-accent" />
                {loadingSlow && (
                    <p className="text-xs text-muted-foreground">
                        Preview is taking longer than expected...
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-foreground-5/30">
                <p className="text-xs text-muted-foreground">
                    Edit Artist/Track/Album values before search.
                </p>
                {editedIndexes.size > 0 && (
                    <button
                        onClick={handleApplyEdits}
                        disabled={applying}
                        className="px-3 py-1.5 text-xs font-semibold rounded-md bg-accent text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {applying ? "Applying..." : `Apply Edits (${editedIndexes.size})`}
                    </button>
                )}

            </div>

            <div className="flex-1 overflow-auto">
                <table ref={tableRef} className="w-full text-sm text-left" style={{ tableLayout: Object.keys(columnWidths).length > 0 ? "fixed" : "auto" }}>
                    <thead className="text-xs text-muted-foreground uppercase bg-background border-b border-border sticky top-0 z-10">
                        <tr>
                            {headers.map((header, i) => (
                                <th
                                    key={i}
                                    className="px-4 py-2.5 font-medium whitespace-nowrap relative select-none group"
                                    style={columnWidths[i] ? { width: columnWidths[i] } : undefined}
                                >
                                    <span className="truncate">{header}</span>
                                    <div
                                        className="absolute top-0 right-0 w-[5px] h-full cursor-col-resize opacity-0 hover:opacity-100 active:opacity-100 z-20"
                                        onMouseDown={(e) => handleResizeStart(i, e)}
                                    >
                                        <div className="w-[2px] h-full mx-auto bg-accent/40" />
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50 bg-background">
                        {rows.length > 0 ? (
                            rows.map((row, rowIndex) => (
                                <tr key={rowIndex} className="hover:bg-foreground-5/30">
                                    <td className="px-4 py-1.5">
                                        <input
                                            type="text"
                                            value={row.artist}
                                            onChange={(event) => handleCellChange(rowIndex, "artist", event.target.value)}
                                            className="w-full bg-transparent border border-transparent focus:border-accent/50 rounded px-1 py-0.5 outline-none"
                                        />
                                    </td>
                                    <td className="px-4 py-1.5">
                                        <input
                                            type="text"
                                            value={row.track}
                                            onChange={(event) => handleCellChange(rowIndex, "track", event.target.value)}
                                            className="w-full bg-transparent border border-transparent focus:border-accent/50 rounded px-1 py-0.5 outline-none"
                                        />
                                    </td>
                                    <td className="px-4 py-1.5">
                                        <input
                                            type="text"
                                            value={row.album}
                                            onChange={(event) => handleCellChange(rowIndex, "album", event.target.value)}
                                            className="w-full bg-transparent border border-transparent focus:border-accent/50 rounded px-1 py-0.5 outline-none"
                                        />
                                    </td>
                                    <td className="px-4 py-1.5 text-foreground truncate" title={row.timestamp}>
                                        {row.timestamp}
                                    </td>
                                    <td className="px-4 py-1.5 text-foreground truncate" title={row.duration}>
                                        {row.duration}
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={headers.length} className="px-4 py-8 text-center text-muted-foreground">
                                    No preview data available
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
