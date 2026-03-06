interface ProgressProps {
    value: number; // 0 to 100
    max?: number;
    className?: string;
    showLabel?: boolean;
    color?: "default" | "success" | "warning";
    elapsedSeconds?: number;
    estimatedRemainingSeconds?: number;
}

export function Progress({
    value,
    max = 100,
    className = "",
    showLabel = false,
    color = "default",
    elapsedSeconds,
    estimatedRemainingSeconds,
}: ProgressProps) {
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

    const colors = {
        default: "from-accent to-accent/80",
        success: "from-success to-success/80",
        warning: "from-warning to-warning/80",
    };

    const formatTime = (seconds: number): string => {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        if (mins < 60) return `${mins}m ${secs}s`;
        const hours = Math.floor(mins / 60);
        const remainingMins = mins % 60;
        return `${hours}h ${remainingMins}m`;
    };

    return (
        <div className={`w-full ${className}`}>
            <div className="flex justify-between text-xs mb-1">
                <div className="flex gap-3">
                    {showLabel && <span>{percentage.toFixed(0)}%</span>}
                    {elapsedSeconds !== undefined && (
                        <span className="text-muted-foreground">
                            Elapsed: {formatTime(elapsedSeconds)}
                        </span>
                    )}
                </div>
                {estimatedRemainingSeconds !== undefined && estimatedRemainingSeconds > 0 && (
                    <span className="text-muted-foreground">
                        ETA: {formatTime(estimatedRemainingSeconds)}
                    </span>
                )}
            </div>
            <div className="h-2 bg-foreground-10 rounded-full overflow-hidden">
                <div
                    className={`h-full bg-gradient-to-r ${colors[color]} transition-all duration-300 rounded-full`}
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
}
