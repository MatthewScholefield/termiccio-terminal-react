import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminal } from "../src/useTerminal";

const mocks = vi.hoisted(() => {
  class MockTerminal {
    static instances: MockTerminal[] = [];

    writes: string[] = [];
    pastes: string[] = [];
    resetCount = 0;
    textarea = undefined;
    options: unknown;

    constructor(options: unknown) {
      this.options = options;
      MockTerminal.instances.push(this);
    }

    open() {}

    loadAddon() {}

    write(data: string, callback?: () => void) {
      this.writes.push(data);
      callback?.();
    }

    paste(data: string) {
      this.pastes.push(data);
    }

    reset() {
      this.resetCount += 1;
    }

    dispose() {}

    onData() {}

    resizeHandler: ((size: { cols: number; rows: number }) => void) | undefined;

    onResize(handler: (size: { cols: number; rows: number }) => void) {
      this.resizeHandler = handler;
    }

    resize(cols: number, rows: number) {
      this.resizeHandler?.({ cols, rows });
    }

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

  it("notifies extensions when the terminal is ready and cleans them up", async () => {
    const cleanup = vi.fn();
    const onTerminalReady = vi.fn(() => cleanup);
    const { result, unmount } = renderHook(() =>
      useTerminal({
        createSession: async () => "session-1",
        onTerminalReady,
      }),
    );
    const anchor = document.createElement("div");

    await act(async () => {
      result.current.ref(anchor);
    });

    expect(onTerminalReady).toHaveBeenCalledWith(MockTerminal.instances[0]);

    unmount();

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("pastes through xterm paste handling", async () => {
    const { result, unmount } = renderHook(() =>
      useTerminal({ createSession: async () => "session-paste" }),
    );
    const anchor = document.createElement("div");

    await act(async () => {
      result.current.ref(anchor);
    });

    act(() => result.current.paste("alpha\nbeta"));

    expect(MockTerminal.instances[0].pastes).toEqual(["alpha\nbeta"]);
    unmount();
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
  it("reports rendered output update ids, including snapshots", async () => {
    const onOutput = vi.fn();
    const { result, unmount } = renderHook(() =>
      useTerminal({
        createSession: async () => "session-output",
        onOutput,
      }),
    );
    const anchor = document.createElement("div");

    await act(async () => {
      result.current.ref(anchor);
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];

    act(() => {
      socket.open();
      socket.receive({ type: "snapshot", format: "xterm-serialize-v1", data: "saved", update_id: 6, rows: 24, cols: 80 });
      socket.receive({ type: "output", data: "hello", update_id: 7 });
    });

    expect(onOutput).toHaveBeenNthCalledWith(1, 6);
    expect(onOutput).toHaveBeenNthCalledWith(2, 7);
    unmount();
  });

  it("tracks synchronization through acknowledged input output watermarks", async () => {
    const onSynchronizationChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useTerminal({
        createSession: async () => "session-sync",
        onSynchronizationChange,
      }),
    );
    const anchor = document.createElement("div");

    await act(async () => {
      result.current.ref(anchor);
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];

    act(() => {
      result.current.sendInput("ignored while connecting");
      socket.open();
      result.current.sendInput("first");
      socket.receive({ type: "snapshot", format: "xterm-serialize-v1", data: "initial", update_id: 5, rows: 24, cols: 80 });
      socket.receive({ type: "message_processed", message_id: 1, output_update_id: null });
      socket.receive({ type: "message_processed", message_id: 2, output_update_id: 7 });
    });

    expect(socket.sent.map((message) => JSON.parse(message))).toContainEqual({
      type: "stdin",
      data: "first",
      message_id: 2,
    });
    expect(onSynchronizationChange).toHaveBeenCalledTimes(1);
    expect(onSynchronizationChange).toHaveBeenLastCalledWith(false);

    act(() => {
      socket.receive({ type: "output", data: "complete", update_id: 7 });
    });

    expect(onSynchronizationChange).toHaveBeenLastCalledWith(true);
    unmount();
  });

  it("clears silent input at an already rendered watermark", async () => {
    const onSynchronizationChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useTerminal({
        createSession: async () => "session-silent-sync",
        onSynchronizationChange,
      }),
    );
    const anchor = document.createElement("div");

    await act(async () => {
      result.current.ref(anchor);
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];

    act(() => {
      socket.open();
      socket.receive({ type: "output", data: "initial", update_id: 4 });
      result.current.sendInput("silent");
      socket.receive({ type: "message_processed", message_id: 1, output_update_id: null });
      socket.receive({ type: "message_processed", message_id: 2, output_update_id: 4 });
    });

    expect(onSynchronizationChange).toHaveBeenLastCalledWith(true);
    unmount();
  });

  it("tracks resize synchronization through its message acknowledgement", async () => {
    const onSynchronizationChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useTerminal({
        createSession: async () => "session-resize-sync",
        onSynchronizationChange,
      }),
    );
    const anchor = document.createElement("div");

    await act(async () => {
      result.current.ref(anchor);
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    const terminal = MockTerminal.instances[0];

    act(() => {
      socket.open();
      socket.receive({ type: "snapshot", format: "xterm-serialize-v1", data: "initial", update_id: 5, rows: 24, cols: 80 });
      for (const message of socket.sent.map((sent) => JSON.parse(sent)).filter((message) => message.type === "resize")) {
        socket.receive({ type: "message_processed", message_id: message.message_id, output_update_id: null });
      }
    });
    expect(onSynchronizationChange).toHaveBeenLastCalledWith(true);

    act(() => terminal.resize(100, 30));
    const resize = socket.sent.map((sent) => JSON.parse(sent)).at(-1);
    expect(resize).toEqual({ type: "resize", cols: 100, rows: 30, message_id: expect.any(Number) });
    expect(onSynchronizationChange).toHaveBeenLastCalledWith(false);

    act(() => {
      socket.receive({ type: "message_processed", message_id: resize.message_id, output_update_id: null });
    });
    expect(onSynchronizationChange).toHaveBeenLastCalledWith(true);
    unmount();
  });

  it("keeps stdin pending after an independent resize acknowledgement", async () => {
    const onSynchronizationChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useTerminal({
        createSession: async () => "session-concurrent-sync",
        onSynchronizationChange,
      }),
    );
    const anchor = document.createElement("div");

    await act(async () => {
      result.current.ref(anchor);
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    const terminal = MockTerminal.instances[0];

    act(() => {
      socket.open();
      socket.receive({ type: "snapshot", format: "xterm-serialize-v1", data: "initial", update_id: 5, rows: 24, cols: 80 });
      for (const message of socket.sent.map((sent) => JSON.parse(sent)).filter((message) => message.type === "resize")) {
        socket.receive({ type: "message_processed", message_id: message.message_id, output_update_id: null });
      }
      result.current.sendInput("first");
      terminal.resize(100, 30);
    });
    const [stdin, resize] = socket.sent
      .map((sent) => JSON.parse(sent))
      .filter((message) => message.type === "stdin" || (message.type === "resize" && message.cols === 100));
    expect(stdin.message_id).not.toBe(resize.message_id);

    act(() => {
      socket.receive({ type: "message_processed", message_id: resize.message_id, output_update_id: null });
      socket.receive({ type: "message_processed", message_id: stdin.message_id, output_update_id: 7 });
    });
    expect(onSynchronizationChange).toHaveBeenLastCalledWith(false);

    act(() => {
      socket.receive({ type: "output", data: "complete", update_id: 7 });
    });
    expect(onSynchronizationChange).toHaveBeenLastCalledWith(true);
    unmount();
  });

  it("preserves pending synchronization across reconnects", async () => {
    const onSynchronizationChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useTerminal({
        createSession: async () => "session-reconnect-sync",
        onSynchronizationChange,
        reconnectDelayMs: 1,
      }),
    );
    const anchor = document.createElement("div");

    await act(async () => {
      result.current.ref(anchor);
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const firstSocket = MockWebSocket.instances[0];

    act(() => {
      firstSocket.open();
      result.current.sendInput("pending");
      firstSocket.close();
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    const secondSocket = MockWebSocket.instances[1];

    act(() => {
      secondSocket.open();
      secondSocket.receive({ type: "snapshot", format: "xterm-serialize-v1", data: "initial", update_id: 3, rows: 24, cols: 80 });
      firstSocket.receive({ type: "message_processed", message_id: 1, output_update_id: null });
      secondSocket.receive({ type: "message_processed", message_id: 2, output_update_id: 3 });
      for (const message of secondSocket.sent.map((sent) => JSON.parse(sent)).filter((message) => message.type === "resize")) {
        secondSocket.receive({ type: "message_processed", message_id: message.message_id, output_update_id: null });
      }
    });

    expect(onSynchronizationChange).toHaveBeenLastCalledWith(true);
    unmount();
  });

});
