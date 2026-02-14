import { useRef, useEffect, useState, useMemo } from "react";
import { LogEntry } from "../lib/types";
import { Terminal, MagnifyingGlass, X } from "@phosphor-icons/react";

interface LogPanelProps {
    logs: LogEntry[];
    onClear: () => void;
}

export function LogPanel({ logs, onClear }: LogPanelProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        if (containerRef.current && !searchQuery) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [logs, searchQuery]);

    const filteredLogs = useMemo(() => {
        if (!searchQuery.trim()) return logs;
        const query = searchQuery.toLowerCase();
        return logs.filter(log => log.message.toLowerCase().includes(query));
    }, [logs, searchQuery]);

    if (logs.length === 0) {
        return (
            <div className="p-4 text-center text-muted-foreground text-sm">
                <Terminal size={24} className="mx-auto mb-2 opacity-50" />
                Log messages will appear here during operations.
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-foreground-5/30 gap-2">
                <span className="text-xs font-medium text-muted-foreground flex-shrink-0">Log ({logs.length})</span>

                {/* Search */}
                <div className="flex items-center gap-1.5 bg-background/60 border border-border rounded px-2 py-0.5 flex-1 max-w-[180px]">
                    <MagnifyingGlass size={10} className="text-muted-foreground flex-shrink-0" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Filter logs..."
                        className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/50 min-w-0"
                    />
                    {searchQuery && (
                        <button onClick={() => setSearchQuery("")} className="text-muted-foreground hover:text-foreground">
                            <X size={8} />
                        </button>
                    )}
                </div>

                {searchQuery && (
                    <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
                        {filteredLogs.length}/{logs.length}
                    </span>
                )}

                <button
                    onClick={onClear}
                    className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-foreground-5 flex-shrink-0"
                >
                    Clear
                </button>
            </div>
            <div
                ref={containerRef}
                className="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-0.5"
            >
                {filteredLogs.map((log, i) => (
                    <div
                        key={i}
                        className={`leading-relaxed ${
                            log.type === "error" ? "text-destructive" :
                            log.type === "warning" ? "text-warning" :
                            log.type === "success" ? "text-success" :
                            "text-muted-foreground"
                        }`}
                    >
                        <span className="opacity-50 inline-block w-[96px] tabular-nums whitespace-nowrap">
                            {log.timestamp.toLocaleTimeString()}
                        </span>
                        {" "}
                        {log.type === "error" && "[ERR] "}
                        {log.type === "warning" && "[WARN] "}
                        {log.type === "success" && "[OK] "}
                        {log.message}
                    </div>
                ))}
                {searchQuery && filteredLogs.length === 0 && (
                    <div className="text-center text-muted-foreground py-4">
                        No logs matching "{searchQuery}"
                    </div>
                )}
            </div>
        </div>
    );
}
