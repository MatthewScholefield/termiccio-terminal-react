import { act, renderHook, waitFor } from "@testing-library/react";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminal } from "../src/useTerminal";
import {
  CommandFinishSchema,
  ErrorSchema,
  GetSizeSchema,
  MessageProcessedSchema,
  OutputSchema,
  ResizeSchema,
  SessionExitSchema,
  SizeSchema,
  SnapshotSchema,
  StdinSchema,
  TerminalMessageSchema,
  type Resize,
  type Stdin,
  type TerminalMessage,
} from "../src/generated/terminal_pb";

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
    binaryType = "arraybuffer";
    sent: Uint8Array[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: Uint8Array }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;

    constructor(public url: string) {
      MockWebSocket.instances.push(this);
    }

    send(data: Uint8Array) {
      this.sent.push(data);
    }

    open() {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }

    receive(message: TerminalMessage) {
      this.onmessage?.({ data: toBinary(TerminalMessageSchema, message) });
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

function snapshot(data: string, updateId: number): TerminalMessage {
  return create(TerminalMessageSchema, {
    payload: {
      case: "snapshot",
      value: create(SnapshotSchema, {
        format: "xterm-serialize-v1",
        data: new TextEncoder().encode(data),
        updateId,
        rows: 24,
        cols: 80,
      }),
    },
  });
}

function output(data: string, updateId: number): TerminalMessage {
  return create(TerminalMessageSchema, {
    payload: {
      case: "output",
      value: create(OutputSchema, {
        data: new TextEncoder().encode(data),
        updateId,
      }),
    },
  });
}

function messageProcessed(messageId: number, outputUpdateId?: number): TerminalMessage {
  return create(TerminalMessageSchema, {
    payload: {
      case: "messageProcessed",
      value: create(MessageProcessedSchema, {
        messageId,
        ...(outputUpdateId !== undefined ? { outputUpdateId } : {}),
      }),
    },
  });
}

function decodeSent(socket: { sent: Uint8Array[] }): TerminalMessage[] {
  return socket.sent.map((frame) => fromBinary(TerminalMessageSchema, frame));
}

function sentStdinMessages(socket: { sent: Uint8Array[] }): Stdin[] {
  return decodeSent(socket)
    .filter(
      (frame): frame is TerminalMessage & { payload: { case: "stdin"; value: Stdin } } =>
        frame.payload.case === "stdin",
    )
    .map((frame) => frame.payload.value);
}

function sentResizeMessages(socket: { sent: Uint8Array[] }): Resize[] {
  return decodeSent(socket)
    .filter(
      (frame): frame is TerminalMessage & { payload: { case: "resize"; value: Resize } } =>
        frame.payload.case === "resize",
    )
    .map((frame) => frame.payload.value);
}

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
      socket.receive(snapshot("SNAPSHOT", 5));
      socket.receive(output("TAIL", 6));
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
      socket.receive(snapshot("saved", 6));
      socket.receive(output("hello", 7));
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
      socket.receive(snapshot("initial", 5));
      socket.receive(messageProcessed(1));
      socket.receive(messageProcessed(2, 7));
    });

    const stdinMessages = sentStdinMessages(socket);
    expect(stdinMessages).toHaveLength(1);
    expect(stdinMessages[0].messageId).toBe(2);
    expect(new TextDecoder().decode(stdinMessages[0].data)).toBe("first");
    expect(onSynchronizationChange).toHaveBeenCalledTimes(1);
    expect(onSynchronizationChange).toHaveBeenLastCalledWith(false);

    act(() => {
      socket.receive(output("complete", 7));
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
      socket.receive(output("initial", 4));
      result.current.sendInput("silent");
      socket.receive(messageProcessed(1));
      socket.receive(messageProcessed(2, 4));
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
      socket.receive(snapshot("initial", 5));
      for (const resize of sentResizeMessages(socket)) {
        socket.receive(messageProcessed(resize.messageId));
      }
    });
    expect(onSynchronizationChange).toHaveBeenLastCalledWith(true);

    act(() => terminal.resize(100, 30));
    const resize = sentResizeMessages(socket).at(-1);
    expect(resize?.cols).toBe(100);
    expect(resize?.rows).toBe(30);
    expect(resize?.messageId).toEqual(expect.any(Number));
    expect(onSynchronizationChange).toHaveBeenLastCalledWith(false);

    act(() => {
      socket.receive(messageProcessed(resize!.messageId));
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
      socket.receive(snapshot("initial", 5));
      for (const resize of sentResizeMessages(socket)) {
        socket.receive(messageProcessed(resize.messageId));
      }
      result.current.sendInput("first");
      terminal.resize(100, 30);
    });
    const sent = decodeSent(socket);
    const stdinFrame = sent.find((frame) => frame.payload.case === "stdin");
    const resizeFrame = sent.find(
      (frame) => frame.payload.case === "resize" && frame.payload.value.cols === 100,
    );
    if (stdinFrame?.payload.case !== "stdin" || resizeFrame?.payload.case !== "resize") {
      throw new Error("missing stdin/resize frames");
    }
    const stdinPayload = stdinFrame.payload.value;
    const resizePayload = resizeFrame.payload.value;
    expect(stdinPayload.messageId).not.toBe(resizePayload.messageId);

    act(() => {
      socket.receive(messageProcessed(resizePayload.messageId));
      socket.receive(messageProcessed(stdinPayload.messageId, 7));
    });
    expect(onSynchronizationChange).toHaveBeenLastCalledWith(false);

    act(() => {
      socket.receive(output("complete", 7));
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
      secondSocket.receive(snapshot("initial", 3));
      firstSocket.receive(messageProcessed(1));
      secondSocket.receive(messageProcessed(2, 3));
      for (const resize of sentResizeMessages(secondSocket)) {
        secondSocket.receive(messageProcessed(resize.messageId));
      }
    });

    expect(onSynchronizationChange).toHaveBeenLastCalledWith(true);
    unmount();
  });

  it("drops the session on session_not_found errors and does not reconnect", async () => {
    const { result, unmount } = renderHook(() =>
      useTerminal({
        createSession: async () => "session-gone",
        reconnectDelayMs: 1,
      }),
    );
    const anchor = document.createElement("div");

    await act(async () => {
      result.current.ref(anchor);
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    socket.open();

    act(() => {
      socket.receive(
        create(TerminalMessageSchema, {
          payload: {
            case: "error",
            value: create(ErrorSchema, {
              errorType: "session_not_found",
              message: "no such session",
            }),
          },
        }),
      );
    });

    expect(window.localStorage.getItem("termiccio-terminal:session-id")).toBeNull();
    expect(MockWebSocket.instances).toHaveLength(1);
    unmount();
  });

  it("resolves runCommand with the command_finish return code", async () => {
    const { result, unmount } = renderHook(() =>
      useTerminal({
        createSession: async () => "session-command",
        reconnectDelayMs: 1,
      }),
    );
    const anchor = document.createElement("div");

    await act(async () => {
      result.current.ref(anchor);
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    socket.open();

    let promise: Promise<number> | undefined;
    act(() => {
      promise = result.current.runCommand("ls");
    });
    const stdinMessages = sentStdinMessages(socket);
    expect(new TextDecoder().decode(stdinMessages.at(-1)!.data)).toBe("ls\r");

    act(() => {
      socket.receive(
        create(TerminalMessageSchema, {
          payload: {
            case: "commandFinish",
            value: create(CommandFinishSchema, { commandIndex: 0, returnCode: 42 }),
          },
        }),
      );
    });

    await expect(promise).resolves.toBe(42);
    unmount();
  });

  it("reports session_exit and stops the session", async () => {
    const onExit = vi.fn();
    const { result, unmount } = renderHook(() =>
      useTerminal({
        createSession: async () => "session-exit",
        onExit,
        reconnectDelayMs: 1,
      }),
    );
    const anchor = document.createElement("div");

    await act(async () => {
      result.current.ref(anchor);
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    socket.open();

    act(() => {
      socket.receive(
        create(TerminalMessageSchema, {
          payload: {
            case: "sessionExit",
            value: create(SessionExitSchema, { returnCode: 7 }),
          },
        }),
      );
    });

    expect(onExit).toHaveBeenCalledWith(7);
    expect(result.current.status).toBe("exited");
    expect(window.localStorage.getItem("termiccio-terminal:session-id")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(MockWebSocket.instances).toHaveLength(1);
    unmount();
  });
});

describe("protobuf encoding", () => {
  it("round-trips every message payload type through toBinary/fromBinary", () => {
    const cases: { message: TerminalMessage; check: (m: TerminalMessage) => void }[] = [
      {
        message: create(TerminalMessageSchema, {
          payload: {
            case: "stdin",
            value: create(StdinSchema, {
              data: new TextEncoder().encode("echo"),
              messageId: 7,
            }),
          },
        }),
        check: (m) => {
          if (m.payload.case !== "stdin") throw new Error("expected stdin");
          expect(new TextDecoder().decode(m.payload.value.data)).toBe("echo");
          expect(m.payload.value.messageId).toBe(7);
        },
      },
      {
        message: create(TerminalMessageSchema, {
          payload: {
            case: "resize",
            value: create(ResizeSchema, { rows: 24, cols: 80, messageId: 8 }),
          },
        }),
        check: (m) => {
          if (m.payload.case !== "resize") throw new Error("expected resize");
          expect(m.payload.value.rows).toBe(24);
          expect(m.payload.value.cols).toBe(80);
          expect(m.payload.value.messageId).toBe(8);
        },
      },
      {
        message: create(TerminalMessageSchema, {
          payload: { case: "getSize", value: create(GetSizeSchema) },
        }),
        check: (m) => {
          if (m.payload.case !== "getSize") throw new Error("expected getSize");
        },
      },
      {
        message: create(TerminalMessageSchema, {
          payload: {
            case: "output",
            value: create(OutputSchema, {
              data: new TextEncoder().encode("out"),
              updateId: 9,
            }),
          },
        }),
        check: (m) => {
          if (m.payload.case !== "output") throw new Error("expected output");
          expect(new TextDecoder().decode(m.payload.value.data)).toBe("out");
          expect(m.payload.value.updateId).toBe(9);
        },
      },
      {
        message: create(TerminalMessageSchema, {
          payload: {
            case: "snapshot",
            value: create(SnapshotSchema, {
              format: "xterm-serialize-v1",
              data: new TextEncoder().encode("snap"),
              updateId: 10,
              rows: 24,
              cols: 80,
            }),
          },
        }),
        check: (m) => {
          if (m.payload.case !== "snapshot") throw new Error("expected snapshot");
          expect(m.payload.value.format).toBe("xterm-serialize-v1");
          expect(new TextDecoder().decode(m.payload.value.data)).toBe("snap");
          expect(m.payload.value.updateId).toBe(10);
          expect(m.payload.value.rows).toBe(24);
          expect(m.payload.value.cols).toBe(80);
        },
      },
      {
        message: create(TerminalMessageSchema, {
          payload: {
            case: "size",
            value: create(SizeSchema, { rows: 24, cols: 80 }),
          },
        }),
        check: (m) => {
          if (m.payload.case !== "size") throw new Error("expected size");
          expect(m.payload.value.rows).toBe(24);
          expect(m.payload.value.cols).toBe(80);
        },
      },
      {
        message: create(TerminalMessageSchema, {
          payload: {
            case: "messageProcessed",
            value: create(MessageProcessedSchema, { messageId: 11 }),
          },
        }),
        check: (m) => {
          if (m.payload.case !== "messageProcessed") throw new Error("expected messageProcessed");
          expect(m.payload.value.messageId).toBe(11);
          expect(m.payload.value.outputUpdateId).toBeUndefined();
        },
      },
      {
        message: create(TerminalMessageSchema, {
          payload: {
            case: "messageProcessed",
            value: create(MessageProcessedSchema, { messageId: 12, outputUpdateId: 0 }),
          },
        }),
        check: (m) => {
          if (m.payload.case !== "messageProcessed") throw new Error("expected messageProcessed");
          expect(m.payload.value.messageId).toBe(12);
          expect(m.payload.value.outputUpdateId).toBe(0);
        },
      },
      {
        message: create(TerminalMessageSchema, {
          payload: {
            case: "commandFinish",
            value: create(CommandFinishSchema, { commandIndex: 3, returnCode: -1 }),
          },
        }),
        check: (m) => {
          if (m.payload.case !== "commandFinish") throw new Error("expected commandFinish");
          expect(m.payload.value.commandIndex).toBe(3);
          expect(m.payload.value.returnCode).toBe(-1);
        },
      },
      {
        message: create(TerminalMessageSchema, {
          payload: {
            case: "sessionExit",
            value: create(SessionExitSchema, { returnCode: -2 }),
          },
        }),
        check: (m) => {
          if (m.payload.case !== "sessionExit") throw new Error("expected sessionExit");
          expect(m.payload.value.returnCode).toBe(-2);
        },
      },
      {
        message: create(TerminalMessageSchema, {
          payload: {
            case: "error",
            value: create(ErrorSchema, {
              errorType: "session_not_found",
              message: "gone",
            }),
          },
        }),
        check: (m) => {
          if (m.payload.case !== "error") throw new Error("expected error");
          expect(m.payload.value.errorType).toBe("session_not_found");
          expect(m.payload.value.message).toBe("gone");
        },
      },
    ];

    for (const { message, check } of cases) {
      const decoded = fromBinary(TerminalMessageSchema, toBinary(TerminalMessageSchema, message));
      check(decoded);
    }
  });

  it("encodes lone surrogates without throwing and decodes them as U+FFFD", () => {
    expect(() => new TextEncoder().encode("\uD800")).not.toThrow();
    const frame = create(TerminalMessageSchema, {
      payload: {
        case: "stdin",
        value: create(StdinSchema, {
          data: new TextEncoder().encode("a\uD800b"),
          messageId: 1,
        }),
      },
    });
    const decoded = fromBinary(TerminalMessageSchema, toBinary(TerminalMessageSchema, frame));
    if (decoded.payload.case !== "stdin") throw new Error("expected stdin");
    expect(new TextDecoder().decode(decoded.payload.value.data)).toBe("a\uFFFDb");
  });
});
