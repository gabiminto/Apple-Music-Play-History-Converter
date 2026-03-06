import { ReactNode, useRef, useEffect, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";

interface AccordionSectionProps {
    title: string;
    expanded: boolean;
    onToggle: () => void;
    children: ReactNode;
    className?: string;
}

export function AccordionSection({
    title,
    expanded,
    onToggle,
    children,
    className = "",
}: AccordionSectionProps) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(0);

    useEffect(() => {
        if (contentRef.current) {
            setHeight(contentRef.current.scrollHeight);
        }
    }, [expanded, children]);

    return (
        <div className={`border-b border-border ${className}`}>
            <button
                onClick={onToggle}
                className={`w-full p-4 flex items-center justify-between transition-all focus:outline-none ${
                    expanded
                        ? "bg-accent/10 hover:bg-accent/15 border-l-2 border-accent"
                        : "hover:bg-foreground-5/50"
                }`}
            >
                <span className={`font-semibold text-sm ${expanded ? "text-accent" : ""}`}>
                    {title}
                </span>
                <CaretDown
                    size={18}
                    weight="bold"
                    className={`transition-transform duration-200 ${expanded ? "rotate-180 text-accent" : "text-muted-foreground"}`}
                />
            </button>
            <div
                ref={contentRef}
                style={{ maxHeight: expanded ? `${height}px` : "0px" }}
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                    expanded ? "opacity-100" : "opacity-0"
                }`}
            >
                <div className="px-4 py-3 bg-foreground-5/30">{children}</div>
            </div>
        </div>
    );
}
