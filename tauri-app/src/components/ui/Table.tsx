import { ReactNode, useState, useRef, useCallback, useMemo } from "react";
import { CaretUp, CaretDown, MagnifyingGlass, X } from "@phosphor-icons/react";

type SortDirection = "asc" | "desc" | null;

interface TableProps {
    headers: string[];
    data: ReactNode[][];
    className?: string;
    emptyMessage?: string;
    searchable?: boolean;
    sortable?: boolean;
    resizableColumns?: boolean;
}

export function Table({
    headers,
    data,
    className = "",
    emptyMessage = "No data available",
    searchable = true,
    sortable = true,
    resizableColumns = true,
}: TableProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [sortCol, setSortCol] = useState<number | null>(null);
    const [sortDir, setSortDir] = useState<SortDirection>(null);
    const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
    const tableRef = useRef<HTMLTableElement>(null);
    const resizingCol = useRef<number | null>(null);
    const startX = useRef(0);
    const startWidth = useRef(0);

    // Column resize handlers
    const handleResizeStart = useCallback((colIndex: number, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        resizingCol.current = colIndex;
        startX.current = e.clientX;

        // Get current column width
        const th = tableRef.current?.querySelectorAll("th")[colIndex];
        startWidth.current = th?.offsetWidth ?? 150;

        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        const handleMouseMove = (ev: MouseEvent) => {
            if (resizingCol.current === null) return;
            const delta = ev.clientX - startX.current;
            const newWidth = Math.max(60, startWidth.current + delta);
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
        if (!sortable) return;
        if (sortCol === colIndex) {
            // Cycle: asc -> desc -> none
            if (sortDir === "asc") setSortDir("desc");
            else if (sortDir === "desc") { setSortCol(null); setSortDir(null); }
            else setSortDir("asc");
        } else {
            setSortCol(colIndex);
            setSortDir("asc");
        }
    }, [sortable, sortCol, sortDir]);

    // Filter + sort data
    const processedData = useMemo(() => {
        let result = data;

        // Search filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            result = result.filter(row =>
                row.some(cell => {
                    const text = typeof cell === "string" ? cell : String(cell ?? "");
                    return text.toLowerCase().includes(query);
                })
            );
        }

        // Sort
        if (sortCol !== null && sortDir !== null) {
            result = [...result].sort((a, b) => {
                const aVal = String(a[sortCol] ?? "").toLowerCase();
                const bVal = String(b[sortCol] ?? "").toLowerCase();
                const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
                return sortDir === "asc" ? cmp : -cmp;
            });
        }

        return result;
    }, [data, searchQuery, sortCol, sortDir]);

    return (
        <div className={`w-full overflow-hidden flex flex-col h-full ${className}`}>
            {/* Search bar */}
            {searchable && (
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-foreground-5/30 flex-shrink-0">
                    <MagnifyingGlass size={14} className="text-muted-foreground flex-shrink-0" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Filter rows..."
                        className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery("")}
                            className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                        >
                            <X size={12} />
                        </button>
                    )}
                    {searchQuery && (
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                            {processedData.length}/{data.length}
                        </span>
                    )}
                </div>
            )}

            {/* Table */}
            <div className="flex-1 overflow-auto">
                <table ref={tableRef} className="w-full text-sm text-left" style={{ tableLayout: Object.keys(columnWidths).length > 0 ? "fixed" : "auto" }}>
                    <thead className="text-xs text-muted-foreground uppercase bg-foreground-5 border-b border-border sticky top-0 z-10">
                        <tr>
                            {headers.map((header, i) => (
                                <th
                                    key={i}
                                    className="px-4 py-2.5 font-medium whitespace-nowrap relative select-none group"
                                    style={columnWidths[i] ? { width: columnWidths[i] } : undefined}
                                >
                                    <div
                                        className={`flex items-center gap-1 ${sortable ? "cursor-pointer hover:text-foreground" : ""}`}
                                        onClick={() => handleSort(i)}
                                    >
                                        <span className="truncate">{header}</span>
                                        {sortable && sortCol === i && (
                                            <span className="flex-shrink-0 text-accent">
                                                {sortDir === "asc" ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}
                                            </span>
                                        )}
                                        {sortable && sortCol !== i && (
                                            <span className="flex-shrink-0 opacity-0 group-hover:opacity-30">
                                                <CaretUp size={10} />
                                            </span>
                                        )}
                                    </div>
                                    {/* Resize handle */}
                                    {resizableColumns && (
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
                    <tbody className="divide-y divide-border/50 bg-background">
                        {processedData.length > 0 ? (
                            processedData.map((row, rowIndex) => (
                                <tr key={rowIndex} className="hover:bg-foreground-5/30">
                                    {row.map((cell, cellIndex) => (
                                        <td
                                            key={cellIndex}
                                            className="px-4 py-1.5 text-foreground truncate"
                                            title={typeof cell === "string" ? cell : undefined}
                                        >
                                            {cell}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={headers.length} className="px-4 py-8 text-center text-muted-foreground">
                                    {searchQuery ? `No matches for "${searchQuery}"` : emptyMessage}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
