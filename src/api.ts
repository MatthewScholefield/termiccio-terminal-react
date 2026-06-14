import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  GetCwdResponse,
} from "./types";

export const DEFAULT_BACKEND_URL = "http://localhost:2552";

/** Convert an http(s) base URL into the matching ws(s) base URL. */
export function toWebSocketUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/, "ws");
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function request<T>(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status >= 400) {
    throw new Error(
      `Request failed with status ${response.status}: ${await response.text()}`,
    );
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Default implementation of `POST /terminals` used to create a new PTY session.
 * Consumers with a custom request model can pass their own `createSession`
 * callback to {@link useTerminal} instead.
 */
export async function createTerminalSession(
  baseUrl: string,
  body: CreateTerminalRequest,
): Promise<CreateTerminalResponse> {
  return request<CreateTerminalResponse>(baseUrl, "POST", "/terminals", body);
}

/**
 * Fetch the live working directory for a terminal session via
 * `GET /terminals/{session_id}/cwd`.
 */
export async function getTerminalCwd(
  baseUrl: string,
  sessionId: string,
): Promise<GetCwdResponse> {
  return request<GetCwdResponse>(
    baseUrl,
    "GET",
    `/terminals/${sessionId}/cwd`,
  );
}

/**
 * Build the WebSocket URL for streaming a terminal session. When `updateId` is
 * provided the server replays any buffered output received since that id.
 */
export function buildWebSocketUrl(
  baseUrl: string,
  sessionId: string,
  updateId = 0,
): string {
  return `${toWebSocketUrl(normalizeBaseUrl(baseUrl))}/terminals/${sessionId}/ws?update_id=${updateId}`;
}
