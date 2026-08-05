export {
  useTerminal,
  TERMINAL_CONTAINER_CLASS,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  type UseTerminalOptions,
  type UseTerminalResult,
  type RunCommandFunction,
  type OnTerminalInputFunction,
  type OnTerminalOutputFunction,
  type OnSynchronizationChangeFunction,
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

export {
  TerminalMessageSchema,
  StdinSchema,
  ResizeSchema,
  GetSizeSchema,
  OutputSchema,
  SnapshotSchema,
  SizeSchema,
  MessageProcessedSchema,
  CommandFinishSchema,
  SessionExitSchema,
  ErrorSchema,
  type TerminalMessage,
  type Stdin,
  type Resize,
  type GetSize,
  type Output,
  type Snapshot,
  type Size,
  type MessageProcessed,
  type CommandFinish,
  type SessionExit,
  type Error,
} from "./generated/terminal_pb";

export type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  GetCwdResponse,
} from "./types";
