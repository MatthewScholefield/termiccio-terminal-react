/**
 * REST API types for the `termiccio-terminal` backend.
 *
 * WebSocket frames are no longer JSON; they are binary Protocol Buffers
 * defined by the sibling `termiccio-terminal` repo's
 * `proto/terminal.proto`. The generated message types and schemas are
 * re-exported from `./generated/terminal_pb` (see `scripts/gen_proto.sh`).
 */

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
