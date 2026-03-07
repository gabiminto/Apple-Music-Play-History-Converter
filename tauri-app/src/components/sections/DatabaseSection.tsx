import { useState, useEffect } from "react";
import { AccordionSection } from "../ui/Accordion";
import { Button } from "../ui/Button";
import { DatabaseStatus } from "../../lib/types";
import { getDatabaseStatus, downloadDatabase, deleteDatabase, checkDatabaseUpdates, importDatabase, showDatabaseLocation, optimizeDatabase } from "../../lib/commands";
import { Database, DownloadSimple, Trash, ArrowCounterClockwise, FileArrowUp, Lightning, Clock, HardDrive } from "@phosphor-icons/react";
import { toast } from "react-toastify";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";

interface DatabaseSectionProps {
    expanded: boolean;
    onToggle: () => void;
}

export function DatabaseSection({ expanded, onToggle }: DatabaseSectionProps) {
    const [status, setStatus] = useState<DatabaseStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [showingLocation, setShowingLocation] = useState(false);
    const [optimizing, setOptimizing] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState<{ message: string; percent: number } | null>(null);

    useEffect(() => {
        if (expanded && !status) {
            loadStatus();
        }
    }, [expanded]);

    // Listen for real-time database status and download progress events
    useEffect(() => {
        const unlisteners: Promise<() => void>[] = [];

        unlisteners.push(
            listen<DatabaseStatus>("database_status", (event) => {
                setStatus(event.payload);
            })
        );

        unlisteners.push(
            listen<{ message: string; percent: number }>("download_progress", (event) => {
                setDownloadProgress(event.payload);
                if (event.payload.percent >= 100) {
                    setDownloading(false);
                    setDownloadProgress(null);
                    loadStatus();
                    toast.success("Database download complete");
                }
            })
        );

        return () => {
            unlisteners.forEach(p => p.then(fn => fn()));
        };
    }, []);

    const loadStatus = async () => {
        try {
            const s = await getDatabaseStatus();
            setStatus(s);
        } catch (e) {
            console.error(e);
        }
    };

    const handleDownload = async () => {
        if (!confirm("Download ~2GB MusicBrainz database? This may take several minutes.")) {
            return;
        }

        setDownloading(true);
        setDownloadProgress({ message: "Starting download...", percent: 0 });
        try {
            await downloadDatabase();
        } catch (err) {
            console.error(err);
            toast.error("Failed to start database download");
            setDownloading(false);
            setDownloadProgress(null);
        }
    };

    const handleDelete = async () => {
        if (!confirm("Are you sure you want to delete the MusicBrainz database? This will free up ~2GB of space.")) {
            return;
        }

        setDeleting(true);
        try {
            await deleteDatabase();
            toast.success("Database deleted");
            await loadStatus();
        } catch (err) {
            console.error(err);
            toast.error("Failed to delete database");
        } finally {
            setDeleting(false);
        }
    };

    const handleCheckUpdates = async () => {
        setLoading(true);
        try {
            await checkDatabaseUpdates();
            await loadStatus();
            toast.success("Checked for updates");
        } catch (err) {
            console.error(err);
            toast.error("Failed to check for updates");
        } finally {
            setLoading(false);
        }
    };

    const handleImport = async () => {
        try {
            const path = await open({
                multiple: false,
                directory: false,
                filters: [{
                    name: "MusicBrainz Database",
                    extensions: ["duckdb", "db"]
                }]
            });

            if (path) {
                await importDatabase(path as string);
                toast.success("Database imported successfully");
                await loadStatus();
            }
        } catch (err) {
            console.error(err);
            toast.error("Failed to import database");
        }
    };

    const handleShowLocation = async () => {
        setShowingLocation(true);
        try {
            await showDatabaseLocation();
        } catch (err) {
            console.error(err);
            toast.error("Failed to open database location");
        } finally {
            setShowingLocation(false);
        }
    };

    const handleOptimize = async () => {
        setOptimizing(true);
        try {
            await optimizeDatabase();
            toast.info("Database optimization started");
            await loadStatus();
        } catch (err) {
            console.error(err);
            toast.error("Failed to start optimization");
        } finally {
            setOptimizing(false);
        }
    };

    return (
        <AccordionSection title="Database & MusicBrainz" expanded={expanded} onToggle={onToggle}>
            <div className="space-y-4">
                <div className="p-3 rounded-lg bg-foreground-5/50 border border-border">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium flex items-center gap-2">
                            <Database size={16} /> Status
                        </span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${status?.downloaded ? "bg-success/20 text-success" : "bg-muted/20 text-muted-foreground"
                            }`}>
                            {status?.downloaded ? "Ready" : "Not Downloaded"}
                        </span>
                    </div>

                    {status?.downloaded && (
                        <div className="text-xs text-muted-foreground space-y-1 ml-6">
                            <div>Size: {status.size}</div>
                            <div>Tracks: {status.trackCount.toLocaleString()}</div>
                            {status.optimized && <div className="text-success">Optimized</div>}
                        </div>
                    )}
                </div>

                {/* Download progress */}
                {downloading && downloadProgress && (
                    <DownloadProgressCard message={downloadProgress.message} percent={downloadProgress.percent} />
                )}

                <Button
                    className="w-full"
                    variant={status?.downloaded ? "secondary" : "primary"}
                    icon={<DownloadSimple size={16} />}
                    onClick={handleDownload}
                    disabled={downloading}
                >
                    {downloading ? "Downloading..." : status?.downloaded ? "Re-download Database" : "Download Database (~2GB)"}
                </Button>

                <Button
                    className="w-full"
                    variant="ghost"
                    icon={<FileArrowUp size={16} />}
                    onClick={handleImport}
                >
                    Import Existing Database
                </Button>

                <div className="grid grid-cols-2 gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCheckUpdates}
                        disabled={loading}
                        icon={<ArrowCounterClockwise />}
                    >
                        {loading ? "Checking..." : "Check Updates"}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleShowLocation}
                        disabled={showingLocation}
                    >
                        {showingLocation ? "Opening..." : "Show Location"}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleOptimize}
                        disabled={optimizing || !status?.downloaded}
                    >
                        {optimizing ? "Starting..." : "Optimize DB"}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={!status?.downloaded || deleting}
                        icon={<Trash />}
                        onClick={handleDelete}
                    >
                        {deleting ? "Deleting..." : "Delete DB"}
                    </Button>
                </div>
            </div>
        </AccordionSection>
    );
}

/** Parse structured download progress from sidecar message string. */
function parseDownloadMessage(message: string) {
    const stepMatch = message.match(/\[Step (\d+)\/(\d+)\]\s*(.*)/);
    const step = stepMatch ? parseInt(stepMatch[1]) : null;
    const totalSteps = stepMatch ? parseInt(stepMatch[2]) : null;
    const remainder = stepMatch ? stepMatch[3] : message;

    const sizeMatch = remainder.match(/([\d.]+)\/([\d.]+)\s*(GB|MB|KB)/);
    const downloaded = sizeMatch ? sizeMatch[1] : null;
    const totalSize = sizeMatch ? `${sizeMatch[2]} ${sizeMatch[3]}` : null;
    const sizeUnit = sizeMatch ? sizeMatch[3] : null;

    const speedMatch = remainder.match(/([\d.]+\s*(?:MB|KB|GB)\/s)/);
    const speed = speedMatch ? speedMatch[1] : null;

    const etaMatch = remainder.match(/ETA:\s*([^)]+)/);
    const eta = etaMatch ? etaMatch[1].trim() : null;

    // Extract the step label (e.g., "Download", "Extract", "Build")
    const labelMatch = remainder.match(/^(\w[\w\s]*?):/);
    const label = labelMatch ? labelMatch[1].trim() : remainder.split(":")[0]?.trim() || "Processing";

    return { step, totalSteps, label, downloaded, totalSize, sizeUnit, speed, eta };
}

function DownloadProgressCard({ message, percent }: { message: string; percent: number }) {
    const info = parseDownloadMessage(message);

    return (
        <div className="rounded-lg border border-accent/20 bg-accent/5 overflow-hidden">
            {/* Header row with step pill and label */}
            <div className="flex items-center gap-2 px-3 pt-3 pb-2">
                {info.step && info.totalSteps && (
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-accent/15 text-accent px-2 py-0.5 rounded-full whitespace-nowrap">
                        Step {info.step}/{info.totalSteps}
                    </span>
                )}
                <span className="text-xs font-semibold text-foreground truncate">
                    {info.label}
                </span>
            </div>

            {/* Progress bar */}
            <div className="px-3 pb-2">
                <div className="h-1.5 bg-foreground-10 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-gradient-to-r from-accent to-accent/70 transition-all duration-500 rounded-full"
                        style={{ width: `${Math.min(percent, 100)}%` }}
                    />
                </div>
            </div>

            {/* Stats pills row */}
            <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
                <span className="text-[10px] font-bold text-accent tabular-nums">
                    {percent.toFixed(0)}%
                </span>

                {info.downloaded && info.totalSize && (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-foreground-5 px-1.5 py-0.5 rounded">
                        <HardDrive size={10} />
                        <span className="tabular-nums">{info.downloaded}</span>
                        <span className="opacity-50">/</span>
                        <span className="tabular-nums">{info.totalSize}</span>
                    </span>
                )}

                {info.speed && (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-foreground-5 px-1.5 py-0.5 rounded">
                        <Lightning size={10} />
                        <span className="tabular-nums">{info.speed}</span>
                    </span>
                )}

                {info.eta && (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-foreground-5 px-1.5 py-0.5 rounded">
                        <Clock size={10} />
                        <span className="tabular-nums">{info.eta}</span>
                    </span>
                )}
            </div>
        </div>
    );
}
