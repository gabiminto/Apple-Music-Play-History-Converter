import { useState } from "react";
import { SearchProvider, ExportFormat } from "../lib/types";
import { ServicesSection } from "./sections/ServicesSection";
import { DatabaseSection } from "./sections/DatabaseSection";
import { AdvancedSection } from "./sections/AdvancedSection";

interface SettingsSidebarProps {
    provider: SearchProvider;
    setProvider: (p: SearchProvider) => void;
    exportFormat: ExportFormat;
    setExportFormat: (f: ExportFormat) => void;
    isSearching: boolean;
}

export function SettingsSidebar({
    provider,
    setProvider,
    exportFormat,
    setExportFormat,
    isSearching,
}: SettingsSidebarProps) {
    const [expanded, setExpanded] = useState({
        services: true,
        database: false,
        advanced: false,
    });

    const toggle = (key: keyof typeof expanded) => {
        setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
    };

    return (
        <aside className="w-full h-full border-l border-border bg-foreground-5/50 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-border">
                <h2 className="text-base font-semibold">Settings</h2>
            </div>

            <div className="flex-1 overflow-y-auto scroll-smooth">
                <ServicesSection
                    expanded={expanded.services}
                    onToggle={() => toggle("services")}
                    provider={provider}
                    setProvider={setProvider}
                    exportFormat={exportFormat}
                    setExportFormat={setExportFormat}
                    isSearching={isSearching}
                />

                <DatabaseSection
                    expanded={expanded.database}
                    onToggle={() => toggle("database")}
                />

                <AdvancedSection
                    expanded={expanded.advanced}
                    onToggle={() => toggle("advanced")}
                />
            </div>
        </aside>
    );
}
