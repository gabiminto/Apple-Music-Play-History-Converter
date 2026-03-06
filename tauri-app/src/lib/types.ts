export interface FileInfo {
    path: string;
    name: string;
    size: number;
    rowCount: number;
    fileType: string;
    isConvertedCsv?: boolean;
    foundCount?: number;
    missingCount?: number;
}

export interface SearchProgress {
    current: number;
    total: number;
    found: number;
    missing: number;
    provider: string;
    status: string;
    currentTrack?: string;
    elapsedSeconds?: number;
    estimatedRemainingSeconds?: number;
    rateLimited?: number;
}

export interface DatabaseStatus {
    downloaded: boolean;
    trackCount: number;
    size: string;
    lastUpdated: string;
    optimized: boolean;
}

export interface LogEntry {
    type: "info" | "success" | "error" | "warning" | "track";
    message: string;
    timestamp: Date;
}

export interface AppleMusicStatus {
    hasBuiltin: boolean;
    hasCustom: boolean;
    hasSharedProxy?: boolean;
    enabled: boolean;
}

export interface AppleMusicTestResult {
    success: boolean;
    message: string;
}

export interface ResumeState {
    available: boolean;
    filePath: string;
    fileType: string;
    provider: string;
    current: number;
    total: number;
    found: number;
    missing: number;
    rateLimited: number;
    elapsedSeconds: number;
}

export type SearchProvider = "musicbrainz" | "musicbrainz_api" | "itunes" | "apple_music";
export type ExportFormat = "lastfm" | "listenbrainz" | "spotify" | "universal" | "itunes_xml";

export const EXPORT_FORMATS: Record<ExportFormat, { name: string; ext: string; description: string }> = {
    lastfm: { name: "Last.fm CSV", ext: ".csv", description: "Compatible with Universal Scrobbler" },
    listenbrainz: { name: "ListenBrainz JSON", ext: ".json", description: "Direct import to ListenBrainz" },
    spotify: { name: "Spotify CSV", ext: ".csv", description: "Spotify-compatible format" },
    universal: { name: "Universal CSV", ext: ".csv", description: "All data preserved" },
    itunes_xml: { name: "iTunes XML", ext: ".xml", description: "iTunes Library XML (plist)" },
};

export const PROVIDERS: Record<SearchProvider, { name: string; description: string; requiresDb?: boolean }> = {
    musicbrainz: { name: "MusicBrainz (Local DB)", description: "Offline database, ~2GB download", requiresDb: true },
    musicbrainz_api: { name: "MusicBrainz API", description: "Online, 1 request/second limit" },
    itunes: { name: "iTunes API", description: "Online, good for Apple Music tracks" },
    apple_music: { name: "Apple Music API", description: "Best accuracy, works out of the box (rate limited)" },
};

export const ITUNES_COUNTRIES: Record<string, string> = {
    us: "United States",
    gb: "United Kingdom",
    au: "Australia",
    ca: "Canada",
    de: "Germany",
    fr: "France",
    jp: "Japan",
    kr: "South Korea",
    br: "Brazil",
    mx: "Mexico",
    it: "Italy",
    es: "Spain",
    nl: "Netherlands",
    se: "Sweden",
    no: "Norway",
    dk: "Denmark",
    fi: "Finland",
    nz: "New Zealand",
    in: "India",
    sg: "Singapore",
    za: "South Africa",
};
