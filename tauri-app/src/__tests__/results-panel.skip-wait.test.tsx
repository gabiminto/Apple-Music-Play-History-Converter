import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ResultsPanel } from "../components/ResultsPanel";

const {
  listeners,
  listenMock,
  emitEvent,
  clearEventListeners,
  commandMocks,
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
    retryMissing: vi.fn(async () => undefined),
    skipRateLimitWait: vi.fn(async () => undefined),
    openFolder: vi.fn(async () => undefined),
  };

  return {
    listeners: eventListeners,
    listenMock: listen,
    emitEvent: emit,
    clearEventListeners: clear,
    commandMocks: commands,
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("../lib/commands", () => commandMocks);

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(async () => null),
}));

vi.mock("react-toastify", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const baseProgress = {
  current: 2,
  total: 10,
  found: 1,
  missing: 0,
  provider: "itunes",
  status: "Searching...",
  currentTrack: "Artist - Track",
  elapsedSeconds: 5,
  estimatedRemainingSeconds: 12,
  rateLimited: 1,
};

describe("ResultsPanel skip wait parity", () => {
  beforeEach(() => {
    clearEventListeners();
    listenMock.mockClear();
    Object.values(commandMocks).forEach((mockFn) => mockFn.mockClear());
  });

  it("shows Skip Current Wait during active rate limit wait and invokes skip command", async () => {
    render(
      <ResultsPanel
        progress={baseProgress}
        provider="itunes"
        isSearching
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
      emitEvent("rate_limit_wait", { active: true, seconds: 42 });
    });

    const skipButton = await screen.findByRole("button", { name: "Skip Current Wait" });
    fireEvent.click(skipButton);

    await waitFor(() => expect(commandMocks.skipRateLimitWait).toHaveBeenCalledTimes(1));
  });
});
