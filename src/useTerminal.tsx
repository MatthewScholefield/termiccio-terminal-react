import { Terminal, type ITheme, type ITerminalOptions } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  type DependencyList,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { FitAddon } from "@xterm/addon-fit";
import {
  DEFAULT_BACKEND_URL,
  buildWebSocketUrl,
  createTerminalSession,
} from "./api";
import type { ServerTerminalMessage } from "./types";

export const TERMINAL_CONTAINER_CLASS = "termiccio-terminal";

export type RunCommandFunction = (command: string) => Promise<number>;
export type OnTerminalInputFunction = (input: string) => void;

export const DEFAULT_DARK_THEME: ITheme = {
  background: "#1e1e1e",
  foreground: "#dcdcdc",
  cursor: "#dcdcdc",
  black: "#1e1e1e",
  red: "#f87171",
  green: "#34d399",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#d946ef",
  cyan: "#3b82f6",
  white: "#dcdcdc",
  brightBlack: "#636363",
  brightRed: "#f87171",
  brightGreen: "#34d399",
  brightYellow: "#fbbf24",
  brightBlue: "#60a5fa",
  brightMagenta: "#d946ef",
  brightCyan: "#3b82f6",
  brightWhite: "#dcdcdc",
};

export const DEFAULT_LIGHT_THEME: ITheme = {
  background: "#f5f5f5",
  foreground: "#1e1e1e",
  cursor: "#1e1e1e",
  black: "#1e1e1e",
  red: "#f87171",
  green: "#34d399",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#d946ef",
  cyan: "#3b82f6",
  white: "#dcdcdc",
  brightBlack: "#636363",
  brightRed: "#f87171",
  brightGreen: "#34d399",
  brightYellow: "#fbbf24",
  brightBlue: "#60a5fa",
  brightMagenta: "#d946ef",
  brightCyan: "#3b82f6",
  brightWhite: "#dcdcdc",
};

export interface UseTerminalOptions {
  /** Base URL of the `termiccio-terminal` backend. Defaults to `http://localhost:2552`. */
  baseUrl?: string;
  /**
   * Create a new terminal session. Receives the current terminal dimensions
   * and must resolve to a `session_id`. Defaults to `POST /terminals`.
   */
  createSession?: (dimensions: { rows: number; cols: number }) => Promise<string>;
  /**
   * localStorage key used to persist the session id across reloads so a PTY can
   * be reconnected. Pass `false` to disable persistence entirely.
   */
  sessionStorageKey?: string | false;
  /** Delay before retrying a dropped WebSocket, in milliseconds. Default 1000. */
  reconnectDelayMs?: number;
  /** Initial terminal container height (px) used by the auto-fit logic. Default 320. */
  initialHeight?: number;
  /** Padding (px) around the terminal rows used by the auto-fit snap. Default 20. */
  padding?: number;
  /** Follow the OS color scheme to switch dark/light themes. Default true. */
  followColorScheme?: boolean;
  /** Override the dark theme colors. */
  darkTheme?: ITheme;
  /** Override the light theme colors. */
  lightTheme?: ITheme;
  /** Extra xterm.js options merged on top of the defaults. */
  terminalOptions?: Partial<ITerminalOptions>;
  /** Replay buffered output via `update_id` on reconnect. Default true. */
  bufferReplay?: boolean;
}

export interface UseTerminalResult {
  /** Ref callback to attach to the DOM element that should host the terminal. */
  ref: (element: HTMLDivElement | null) => void;
  /** Connection status: "disconnected" | "creating session" | "connecting" | "connected". */
  status: string;
  /** Active terminal session id, once known. */
  sessionId: string | null;
  /** Run a command and resolve with its exit code once `command_finish` arrives. */
  runCommand: RunCommandFunction;
  /** Subscribe to raw stdin input produced in the terminal. */
  useOnTerminalInput: (
    handler: OnTerminalInputFunction,
    deps: DependencyList,
  ) => void;
  /** Current computed container height (px). */
  terminalHeight: number;
  /** Set the desired container height; it snaps to whole terminal rows. */
  setTerminalHeight: (height: number) => void;
}

const DEFAULT_SESSION_STORAGE_KEY = "termiccio-terminal:session-id";

function usePrefersDarkMode(): boolean {
  const [dark, setDark] = useState(() => getPrefersDarkMode());
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => setDark(event.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);
  return dark;
}

function getPrefersDarkMode(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function useAutoFitAddon(initialHeight: number, padding: number) {
  const [terminalRowHeight, setTerminalRowHeight] = useState(0);
  const [terminalHeight, setTerminalHeightInternal] = useState(0);
  const currentDimensionsRef = useRef<[number, number]>([80, 24]);

  const setTerminalHeight = useCallback(
    (height: number) => {
      setTerminalRowHeight((rowHeight) => {
        if (!rowHeight) return rowHeight;
        return (
          Math.floor((height + rowHeight / 2 - 2 * padding) / rowHeight) *
            rowHeight +
          2 * padding
        );
      });
    },
    [padding],
  );

  useEffect(() => {
    if (terminalRowHeight && terminalHeight === 0) {
      setTerminalHeightInternal(
        Math.floor((initialHeight + terminalRowHeight / 2 - 2 * padding) / terminalRowHeight) *
          terminalRowHeight +
          2 * padding,
      );
    }
  }, [terminalRowHeight, terminalHeight, initialHeight, padding]);

  const openAutofitTerminal = useCallback(
    (term: Terminal, anchorElem: HTMLDivElement) => {
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(anchorElem);
      const cellHeight =
        (
          term as unknown as {
            _core?: { _renderService?: { dimensions?: { css?: { cell?: { height: number } } } } };
          }
        )._core?._renderService?.dimensions?.css?.cell?.height ?? 0;
      if (cellHeight) setTerminalRowHeight(cellHeight);
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        currentDimensionsRef.current = [dims.cols, dims.rows];
      }
      const observer = new ResizeObserver(() => fitAddon.fit());
      observer.observe(anchorElem);
      return () => observer.disconnect();
    },
    [],
  );

  return { terminalHeight, setTerminalHeight, openAutofitTerminal, currentDimensionsRef };
}

export function useTerminal(options: UseTerminalOptions = {}): UseTerminalResult {
  const {
    baseUrl = DEFAULT_BACKEND_URL,
    createSession,
    sessionStorageKey = DEFAULT_SESSION_STORAGE_KEY,
    reconnectDelayMs = 1000,
    initialHeight = 320,
    padding = 20,
    followColorScheme = true,
    darkTheme = DEFAULT_DARK_THEME,
    lightTheme = DEFAULT_LIGHT_THEME,
    terminalOptions = {},
    bufferReplay = true,
  } = options;

  const [anchorElem, setAnchorElem] = useState<HTMLDivElement | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState("disconnected");
  const [runCommand, setRunCommand] = useState<RunCommandFunction>(() => () => {
    throw new Error("runCommand not initialized");
  });

  const terminalInputHandlersRef = useRef<OnTerminalInputFunction[]>([]);

  // Keep latest config in refs so changing them doesn't tear down an active session.
  const baseUrlRef = useRef(baseUrl);
  baseUrlRef.current = baseUrl;
  const createSessionRef = useRef(createSession);
  createSessionRef.current = createSession;
  const reconnectDelayRef = useRef(reconnectDelayMs);
  reconnectDelayRef.current = reconnectDelayMs;
  const bufferReplayRef = useRef(bufferReplay);
  bufferReplayRef.current = bufferReplay;

  const resolveSession = useCallback(async (dimensions: {
    rows: number;
    cols: number;
  }) => {
    const custom = createSessionRef.current;
    if (custom) return custom(dimensions);
    return (await createTerminalSession(baseUrlRef.current, dimensions)).session_id;
  }, []);

  const useOnTerminalInput = useCallback(
    (handler: OnTerminalInputFunction, deps: DependencyList) => {
      const memoizedHandler = useCallback(handler, deps);
      useEffect(() => {
        terminalInputHandlersRef.current.push(memoizedHandler);
        return () => {
          terminalInputHandlersRef.current = terminalInputHandlersRef.current.filter(
            (existing) => existing !== memoizedHandler,
          );
        };
      }, [memoizedHandler]);
    },
    [],
  );

  const { terminalHeight, setTerminalHeight, openAutofitTerminal, currentDimensionsRef } =
    useAutoFitAddon(initialHeight, padding);
  const isDarkMode = usePrefersDarkMode();
  const activeTheme = followColorScheme
    ? isDarkMode
      ? darkTheme
      : lightTheme
    : darkTheme;

  useEffect(() => {
    if (!anchorElem) return;

    let ws: WebSocket | null = null;
    const term = createTerminal({
      theme: activeTheme,
      ...terminalOptions,
    });
    const disposeAutofit = openAutofitTerminal(term, anchorElem);
    const lastUpdateIdRef = { current: 0 };
    const isDisposedRef = { current: false };

    function sendData(data: string) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "stdin", data }));
        for (const handler of terminalInputHandlersRef.current) {
          handler(data);
        }
      }
    }
    term.onData(sendData);

    let onCommandComplete: ((statusCode: number) => void) | null = null;
    setRunCommand(
      () =>
        (command: string) => {
          sendData(`${command}\r`);
          return new Promise<number>((resolve, reject) => {
            if (onCommandComplete) {
              reject(new Error("Another command is already running"));
            } else {
              onCommandComplete = resolve;
            }
          });
        },
    );

    term.onResize((size) => {
      currentDimensionsRef.current = [size.cols, size.rows];
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: size.cols, rows: size.rows }));
      }
    });

    let connectRetryTimeoutId: ReturnType<typeof setTimeout> | null = null;

    function readStoredSessionId(): string | null {
      if (sessionStorageKey === false) return null;
      try {
        return JSON.parse(window.localStorage.getItem(sessionStorageKey) ?? "null");
      } catch {
        return null;
      }
    }

    function storeSessionId(id: string | null) {
      if (sessionStorageKey === false) return;
      if (id === null) {
        window.localStorage.removeItem(sessionStorageKey);
      } else {
        window.localStorage.setItem(sessionStorageKey, JSON.stringify(id));
      }
    }

    async function connectSession() {
      if (isDisposedRef.current) return;
      if (connectRetryTimeoutId) {
        clearTimeout(connectRetryTimeoutId);
        connectRetryTimeoutId = null;
      }

      function scheduleReconnect() {
        if (isDisposedRef.current || connectRetryTimeoutId) return;
        connectRetryTimeoutId = setTimeout(connectSession, reconnectDelayRef.current);
      }

      let activeSessionId = readStoredSessionId();
      if (!activeSessionId) {
        setStatus("creating session");
        term.reset();
        lastUpdateIdRef.current = 0;
        try {
          activeSessionId = await resolveSession({
            cols: currentDimensionsRef.current[0],
            rows: currentDimensionsRef.current[1],
          });
        } catch (error) {
          console.error("Failed to create terminal session:", error);
          scheduleReconnect();
          return;
        }
        storeSessionId(activeSessionId);
      }
      if (isDisposedRef.current) return;

      setSessionId(activeSessionId);
      setStatus("connecting");

      const updateId = bufferReplayRef.current ? lastUpdateIdRef.current : 0;
      ws = new WebSocket(buildWebSocketUrl(baseUrlRef.current, activeSessionId, updateId));

      ws.onopen = () => {
        if (!isDisposedRef.current) setStatus("connected");
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerTerminalMessage;
        switch (message.type) {
          case "error": {
            if (message.error_type === "session_not_found") {
              storeSessionId(null);
              ws?.close();
            } else {
              console.error("WebSocket error from server:", message);
            }
            break;
          }
          case "output": {
            if (message.update_id > lastUpdateIdRef.current) {
              lastUpdateIdRef.current = message.update_id;
            }
            term.write(message.data);
            break;
          }
          case "command_finish": {
            if (onCommandComplete) {
              onCommandComplete(message.return_code);
              onCommandComplete = null;
            }
            break;
          }
          case "size":
            break;
        }
      };

      ws.onclose = () => {
        if (isDisposedRef.current) return;
        setStatus("disconnected");
        ws = null;
        scheduleReconnect();
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };
    }

    connectSession();

    return () => {
      isDisposedRef.current = true;
      if (connectRetryTimeoutId) clearTimeout(connectRetryTimeoutId);
      term.dispose();
      disposeAutofit();
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    anchorElem,
    openAutofitTerminal,
    currentDimensionsRef,
    activeTheme,
    resolveSession,
    sessionStorageKey,
  ]);

  return {
    ref: setAnchorElem,
    status,
    sessionId,
    runCommand,
    useOnTerminalInput,
    terminalHeight,
    setTerminalHeight,
  };
}

function createTerminal(options: ITerminalOptions): Terminal {
  return new Terminal({
    cursorBlink: true,
    cursorStyle: "block",
    fontFamily: "monospace",
    cols: 80,
    rows: 24,
    fontSize: 14,
    ...options,
  });
}
