export {
  useTerminal,
  TERMINAL_CONTAINER_CLASS,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  type UseTerminalOptions,
  type UseTerminalResult,
  type RunCommandFunction,
  type OnTerminalInputFunction,
  type KeyboardInputTransformFunction,
} from "./useTerminal";

export {
  TerminalProvider,
  useSharedTerminal,
  TerminalContext,
  type TerminalProviderProps,
} from "./TerminalProvider";

export {
  DEFAULT_BACKEND_URL,
  toWebSocketUrl,
  buildWebSocketUrl,
  createTerminalSession,
  getTerminalCwd,
} from "./api";

export type {
  StdinTerminalMessage,
  ResizeTerminalMessage,
  GetSizeTerminalMessage,
  ClientTerminalMessage,
  OutputTerminalMessage,
  SnapshotTerminalMessage,
  SizeTerminalMessage,
  CommandFinishTerminalMessage,
  ErrorTerminalMessage,
  ServerTerminalMessage,
  CreateTerminalRequest,
  CreateTerminalResponse,
  GetCwdResponse,
} from "./types";
