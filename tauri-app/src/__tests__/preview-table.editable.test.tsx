import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PreviewTable } from "../components/PreviewTable";

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
    getCsvPreview: vi.fn(async () => []),
    setPreviewEdits: vi.fn(async () => undefined),
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

describe("PreviewTable editable parity", () => {
  beforeEach(() => {
    clearEventListeners();
    listenMock.mockClear();
    Object.values(commandMocks).forEach((mockFn) => mockFn.mockClear());
  });

  it("allows inline preview edits and applies them for search", async () => {
    render(<PreviewTable filePath="/tmp/input.csv" />);
    await waitFor(() => expect(commandMocks.getCsvPreview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listeners.size).toBeGreaterThan(0));

    act(() => {
      emitEvent("csv_preview", {
        path: "/tmp/input.csv",
        headers: ["Artist", "Track", "Album", "Timestamp", "Duration"],
        rows: [["Original Artist", "Original Track", "Original Album", "2026-02-14T00:00:00Z", "180"]],
      });
    });

    const artistInput = await screen.findByDisplayValue("Original Artist");
    fireEvent.change(artistInput, { target: { value: "Edited Artist" } });

    fireEvent.click(screen.getByRole("button", { name: /Apply Edits/ }));
    await waitFor(() => expect(commandMocks.setPreviewEdits).toHaveBeenCalledTimes(1));
  });
});
