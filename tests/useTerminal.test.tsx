import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminal } from "../src/useTerminal";

const mocks = vi.hoisted(() => {
  class MockTerminal {
    static instances: MockTerminal[] = [];

    writes: string[] = [];
    resetCount = 0;
    textarea = undefined;
    options: unknown;

    constructor(options: unknown) {
      this.options = options;
      MockTerminal.instances.push(this);
    }

    open() {}

    loadAddon() {}

    write(data: string) {
      this.writes.push(data);
    }

    reset() {
      this.resetCount += 1;
    }

    dispose() {}

    onData() {}

    onResize() {}

    attachCustomKeyEventHandler() {}
  }

  class MockFitAddon {
    fit() {}

    proposeDimensions() {
      return { cols: 80, rows: 24 };
    }
  }

  class MockResizeObserver {
    observe() {}

    disconnect() {}
  }

  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    static instances: MockWebSocket[] = [];

    readyState = MockWebSocket.CONNECTING;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;

    constructor(public url: string) {
      MockWebSocket.instances.push(this);
    }

    send(data: string) {
      this.sent.push(data);
    }

    open() {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }

    receive(message: unknown) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }

    close() {
      if (this.readyState === MockWebSocket.CLOSED) return;
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.();
    }
  }

  return { MockFitAddon, MockResizeObserver, MockTerminal, MockWebSocket };
});

const { MockResizeObserver, MockTerminal, MockWebSocket } = mocks;

vi.mock("@xterm/xterm", () => ({ Terminal: mocks.MockTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: mocks.MockFitAddon }));

describe("useTerminal snapshot reconnect", () => {
  beforeEach(() => {
    MockTerminal.instances = [];
    MockWebSocket.instances = [];
    window.localStorage.clear();
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  it("restores snapshots and reconnects from the latest update id", async () => {
    const { result, unmount } = renderHook(() =>
      useTerminal({
        createSession: async () => "session-1",
        reconnectDelayMs: 1,
      }),
    );
    const anchor = document.createElement("div");

    await act(async () => {
      result.current.ref(anchor);
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const terminal = MockTerminal.instances[0];
    const socket = MockWebSocket.instances[0];

    act(() => {
      socket.open();
    });
    terminal.resetCount = 0;

    act(() => {
      socket.receive({
        type: "snapshot",
        format: "xterm-serialize-v1",
        data: "SNAPSHOT",
        update_id: 5,
        rows: 24,
        cols: 80,
      });
      socket.receive({ type: "output", data: "TAIL", update_id: 6 });
    });

    expect(terminal.resetCount).toBe(1);
    expect(terminal.writes).toEqual(["SNAPSHOT", "TAIL"]);

    act(() => {
      socket.close();
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));

    expect(MockWebSocket.instances[1].url).toContain("update_id=6");

    unmount();
  });
});
