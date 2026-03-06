import { useState, useEffect } from "react";

export function useTauri() {
    const [isTauri, setIsTauri] = useState(false);

    useEffect(() => {
        if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined) {
            setIsTauri(true);
        }
    }, []);

    return isTauri;
}
