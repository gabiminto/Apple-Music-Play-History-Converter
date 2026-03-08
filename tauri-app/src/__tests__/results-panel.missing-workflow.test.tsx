import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ResultsPanel } from "../components/ResultsPanel";

const {
  listeners,
  listenMock,
  emitEvent,
  clearEventListeners,
  commandMocks,
  saveMock,
} = vi.hoisted(() => {
  const eventListeners = new Map<string, Array<(event: { payload: unknown }) => void>>();

  const listen = vi.fn((eventName: string, cb: (event: { payload: unknown }) => void) => {
    const current = eventListeners.get(eventName) ?? [];
    current.push(cb);
    eventListeners.set(eventName, current);
    return Promise.resolve(() => {
      const next = (eventListeners.get(eventName) ?? []).filter((fn) => fn !== cb);
      eventListeners.set(eventName, next);
    });
  });

  const emit = (eventName: string, payload: unknown) => {
    for (const cb of eventListeners.get(eventName) ?? []) {
      cb({ payload });
    }
  };

  const clear = () => eventListeners.clear();

  const commands = {
    startSearch: vi.fn(async () => undefined),
    stopSearch: vi.fn(async () => undefined),
    togglePause: vi.fn(async () => undefined),
    exportResults: vi.fn(async () => undefined),
    exportMissing: vi.fn(async () => undefined),
    exportRateLimited: vi.fn(async () => undefined),
    retryRateLimited: vi.fn(async () => undefined),
    skipRateLimitWait: vi.fn(async () => undefined),
    retryMissing: vi.fn(async () => undefined),
    openFolder: vi.fn(async () => undefined),
  };

  const save = vi.fn(async () => "/tmp/missing_tracks.csv");

  return {
    listeners: eventListeners,
    listenMock: listen,
    emitEvent: emit,
    clearEventListeners: clear,
    commandMocks: commands,
    saveMock: save,
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("../lib/commands", () => commandMocks);

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: saveMock,
}));

vi.mock("react-toastify", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const completedProgress = {
  current: 3,
  total: 3,
  found: 1,
  missing: 2,
  provider: "itunes",
  status: "Complete",
  currentTrack: "",
  elapsedSeconds: 8,
  estimatedRemainingSeconds: 0,
  rateLimited: 0,
};

describe("ResultsPanel missing workflow parity", () => {
  beforeEach(() => {
    clearEventListeners();
    listenMock.mockClear();
    saveMock.mockClear();
    Object.values(commandMocks).forEach((mockFn) => mockFn.mockClear());
  });

  it("opens missing review and supports retry + export actions", async () => {
    render(
      <ResultsPanel
        progress={completedProgress}
        provider="itunes"
        isSearching={false}
        isPaused={false}
        filePath="/tmp/input.csv"
        onSearchStatusChange={vi.fn()}
        exportFormat="lastfm"
        lastExportPath={null}
        onExported={vi.fn()}
      />
    );

    await waitFor(() => expect(listeners.size).toBeGreaterThan(0));
    act(() => {
      emitEvent("csv_loaded", { rowCount: 3 });
      emitEvent("track_result", { index: 0, artist: "Found Artist", track: "Found Song", album: "", found: true, rateLimited: false, source: "itunes" });
      emitEvent("track_result", { index: 1, artist: "Missing Artist 1", track: "Missing Song 1", album: "", found: false, rateLimited: false, source: "" });
      emitEvent("track_result", { index: 2, artist: "Missing Artist 2", track: "Missing Song 2", album: "", found: false, rateLimited: false, source: "" });
    });

    const reviewButton = await screen.findByRole("button", { name: /missing/i });
    fireEvent.click(reviewButton);

    await screen.findByText("Missing Song 1");
    await screen.findByText("Missing Song 2");

    fireEvent.click(screen.getByRole("button", { name: "Export Missing CSV" }));
    await waitFor(() => expect(commandMocks.exportMissing).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Retry Missing Tracks" }));
    await waitFor(() => expect(commandMocks.retryMissing).toHaveBeenCalledTimes(1));
  });
});
