import { describe, it, expect } from "vitest";
import {
    PROVIDERS,
    EXPORT_FORMATS,
    ITUNES_COUNTRIES,
} from "../lib/types";
import type {
    FileInfo,
    SearchProgress,
    DatabaseStatus,
    LogEntry,
    AppleMusicStatus,
    SearchProvider,
    ExportFormat,
} from "../lib/types";

describe("types", () => {
    describe("PROVIDERS", () => {
        it("has all 4 search providers", () => {
            const keys = Object.keys(PROVIDERS);
            expect(keys).toContain("musicbrainz");
            expect(keys).toContain("musicbrainz_api");
            expect(keys).toContain("itunes");
            expect(keys).toContain("apple_music");
            expect(keys).toHaveLength(4);
        });

        it("each provider has name and description", () => {
            for (const [, info] of Object.entries(PROVIDERS)) {
                expect(info.name).toBeTruthy();
                expect(info.description).toBeTruthy();
            }
        });

        it("musicbrainz local requires DB", () => {
            expect(PROVIDERS.musicbrainz.requiresDb).toBe(true);
        });

        it("API-based providers don't require DB", () => {
            expect(PROVIDERS.musicbrainz_api.requiresDb).toBeUndefined();
            expect(PROVIDERS.itunes.requiresDb).toBeUndefined();
            expect(PROVIDERS.apple_music.requiresDb).toBeUndefined();
        });
    });

    describe("EXPORT_FORMATS", () => {
        it("has all 5 export formats", () => {
            const keys = Object.keys(EXPORT_FORMATS);
            expect(keys).toContain("lastfm");
            expect(keys).toContain("listenbrainz");
            expect(keys).toContain("spotify");
            expect(keys).toContain("universal");
            expect(keys).toContain("itunes_xml");
            expect(keys).toHaveLength(5);
        });

        it("each format has name, ext, and description", () => {
            for (const [, info] of Object.entries(EXPORT_FORMATS)) {
                expect(info.name).toBeTruthy();
                expect(info.ext).toBeTruthy();
                expect(info.description).toBeTruthy();
            }
        });
    });

    describe("ITUNES_COUNTRIES", () => {
        it("has 21 countries", () => {
            expect(Object.keys(ITUNES_COUNTRIES)).toHaveLength(21);
        });

        it("includes common storefronts", () => {
            expect(ITUNES_COUNTRIES["us"]).toBe("United States");
            expect(ITUNES_COUNTRIES["gb"]).toBe("United Kingdom");
            expect(ITUNES_COUNTRIES["jp"]).toBe("Japan");
            expect(ITUNES_COUNTRIES["au"]).toBe("Australia");
        });
    });

    describe("type shape validation", () => {
        it("FileInfo has required fields", () => {
            const info: FileInfo = {
                path: "/test/file.csv",
                name: "file.csv",
                size: 1024,
                rowCount: 100,
                fileType: "Play Activity",
            };
            expect(info.path).toBe("/test/file.csv");
            expect(info.rowCount).toBe(100);
        });

        it("SearchProgress has required fields", () => {
            const progress: SearchProgress = {
                current: 50,
                total: 100,
                found: 30,
                missing: 15,
                provider: "musicbrainz_api",
                status: "Searching...",
                rateLimited: 5,
            };
            expect(progress.current).toBe(50);
            expect(progress.rateLimited).toBe(5);
        });

        it("DatabaseStatus has required fields", () => {
            const status: DatabaseStatus = {
                downloaded: true,
                trackCount: 500000,
                size: "2.1 GB",
                lastUpdated: "2025-01-01",
                optimized: true,
            };
            expect(status.downloaded).toBe(true);
            expect(status.trackCount).toBe(500000);
        });

        it("LogEntry supports all types", () => {
            const types: LogEntry["type"][] = ["info", "success", "error", "warning", "track"];
            types.forEach((type) => {
                const entry: LogEntry = { type, message: "test", timestamp: new Date() };
                expect(entry.type).toBe(type);
            });
        });

        it("AppleMusicStatus has required fields", () => {
            const status: AppleMusicStatus = {
                hasBuiltin: true,
                hasCustom: false,
                enabled: true,
            };
            expect(status.hasBuiltin).toBe(true);
        });

        it("SearchProvider type covers all providers", () => {
            const providers: SearchProvider[] = ["musicbrainz", "musicbrainz_api", "itunes", "apple_music"];
            expect(providers).toHaveLength(4);
        });

        it("ExportFormat type covers all formats", () => {
            const formats: ExportFormat[] = ["lastfm", "listenbrainz", "spotify", "universal", "itunes_xml"];
            expect(formats).toHaveLength(5);
        });
    });
});
