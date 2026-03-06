import { useState } from "react";
import { AccordionSection } from "../ui/Accordion";
import { Button } from "../ui/Button";
import { FolderOpen, Broom, Info } from "@phosphor-icons/react";
import { openLogDir, clearCache } from "../../lib/commands";
import { toast } from "react-toastify";

interface AdvancedSectionProps {
    expanded: boolean;
    onToggle: () => void;
}

export function AdvancedSection({ expanded, onToggle }: AdvancedSectionProps) {
    const [clearing, setClearing] = useState(false);

    const handleOpenLogs = async () => {
        try {
            await openLogDir();
            toast.success("Opened logs folder");
        } catch (err) {
            console.error(err);
            toast.error(`Failed to open logs folder: ${err}`);
        }
    };

    const handleClearCache = async () => {
        if (!confirm("Are you sure you want to clear the search cache? This will remove all cached search results.")) {
            return;
        }

        setClearing(true);
        try {
            await clearCache();
            toast.success("Cache cleared successfully");
        } catch (err) {
            console.error(err);
            toast.error("Failed to clear cache");
        } finally {
            setClearing(false);
        }
    };

    return (
        <AccordionSection title="Advanced" expanded={expanded} onToggle={onToggle}>
            <div className="space-y-3">
                <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                        System
                    </div>
                    <Button
                        variant="ghost"
                        className="w-full justify-start"
                        icon={<FolderOpen size={16} />}
                        onClick={handleOpenLogs}
                    >
                        Open Logs Folder
                    </Button>
                </div>

                <div className="border-t border-border" />

                <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                        Maintenance
                        <span
                            className="cursor-help"
                            title="The search cache stores previously matched track results locally so repeat searches are instant. Clearing it forces fresh API lookups for all tracks."
                        >
                            <Info size={12} className="text-muted-foreground/60" />
                        </span>
                    </div>
                    <Button
                        variant="ghost"
                        className="w-full justify-start text-warning hover:text-warning"
                        icon={<Broom size={16} />}
                        onClick={handleClearCache}
                        disabled={clearing}
                    >
                        {clearing ? "Clearing..." : "Clear Search Cache"}
                    </Button>
                    <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug px-1">
                        Removes cached search results. Next search will re-query all tracks from the API.
                    </p>
                </div>
            </div>
        </AccordionSection>
    );
}
