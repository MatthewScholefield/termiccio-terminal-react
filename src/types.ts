/**
 * WebSocket protocol types for the `termiccio-terminal` backend.
 *
 * These mirror the Pydantic models exported by the backend library and are
 * discriminated by a `type` field. They can be regenerated from the backend's
 * Python schemas with `pydantic2ts`; see the README for details.
 */

// ---- Client -> Server -------------------------------------------------------

export interface StdinTerminalMessage {
  type: "stdin";
  data: string;
}

export interface ResizeTerminalMessage {
  type: "resize";
  rows: number;
  cols: number;
}

export interface GetSizeTerminalMessage {
  type: "get_size";
}

export type ClientTerminalMessage =
  | StdinTerminalMessage
  | ResizeTerminalMessage
  | GetSizeTerminalMessage;

// ---- Server -> Client -------------------------------------------------------

export interface OutputTerminalMessage {
  type: "output";
  data: string;
  update_id: number;
}

export interface SizeTerminalMessage {
  type: "size";
  rows: number;
  cols: number;
}

export interface CommandFinishTerminalMessage {
  type: "command_finish";
  command_index: number;
  return_code: number;
}

export interface SessionExitTerminalMessage {
  type: "session_exit";
  return_code: number;
}

export interface ErrorTerminalMessage {
  type: "error";
  error_type: string;
  message: string;
}

export type ServerTerminalMessage =
  | OutputTerminalMessage
  | SizeTerminalMessage
  | CommandFinishTerminalMessage
  | SessionExitTerminalMessage
  | ErrorTerminalMessage;

// ---- REST -------------------------------------------------------------------

export interface CreateTerminalRequest {
  project_name?: string | null;
  rows?: number;
  cols?: number;
  [key: string]: unknown;
}

export interface CreateTerminalResponse {
  session_id: string;
}

export interface GetCwdResponse {
  cwd: string;
}
