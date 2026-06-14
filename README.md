# termiccio-terminal-react

> React hooks and components for driving an interactive web terminal backed by [`termiccio-terminal`](https://github.com/MatthewScholefield/termiccio-terminal).

`termiccio-terminal-react` is the frontend companion to the `termiccio-terminal` FastAPI backend. It spins up an [xterm.js](https://xtermjs.org/) terminal, manages the WebSocket lifecycle (connect / reconnect / session creation), speaks the bidirectional message protocol, exposes a `runCommand()` that awaits exit codes, and keeps the terminal auto-fitted to its container. Drop the provider into your tree (or call the hook directly) and you have a fully interactive PTY in the browser.

## Features

- **xterm.js integration** with dark/light theme awareness and `FitAddon` auto-sizing
- **WebSocket lifecycle** handled for you — connection, reconnection, and `session_not_found` recovery
- **Session persistence** in `localStorage` so a PTY survives reloads (configurable / disableable)
- **Buffer replay** via `update_id` — no lost output when the socket drops and reconnects
- **`runCommand(command): Promise<number>`** — run a command and resolve with its exit code
- **`useOnTerminalInput(handler)`** — subscribe to raw stdin events from anywhere in the tree
- **Fully configurable** backend URL, request shape, theme, and xterm.js options

## Install

```sh
npm install termiccio-terminal-react
# peer dependencies
npm install @xterm/xterm @xterm/addon-fit react react-dom
```

## Quick start

Wrap the part of your app that needs a terminal in a `TerminalProvider`, then read the terminal state with `useSharedTerminal()`. Attach the `ref` to the DOM element that should host the terminal:

```tsx
import "termiccio-terminal-react/style.css";
import { TerminalProvider, useSharedTerminal } from "termiccio-terminal-react";

function TerminalView() {
  const { ref, status } = useSharedTerminal();
  return <div ref={ref} className="termiccio-terminal" />;
}

export function App() {
  return (
    <TerminalProvider baseUrl="http://localhost:2552">
      <TerminalView />
    </TerminalProvider>
  );
}
```

> Import `termiccio-terminal-react/style.css` once (or copy the `.termiccio-terminal` rules into your own stylesheet) to get the rounded, shadowed container styling.

## Using the hook directly

If you don't want a context, call `useTerminal()` yourself:

```tsx
import { useTerminal } from "termiccio-terminal-react";

function TerminalView() {
  const { ref, status, sessionId, runCommand } = useTerminal({
    baseUrl: "http://localhost:2552",
  });

  return (
    <>
      <div ref={ref} className="termiccio-terminal" />
      <button onClick={() => runCommand("echo hello")}>Say hello</button>
    </>
  );
}
```

## Running commands and awaiting exit codes

`runCommand()` writes `command + "\r"` to the terminal and returns a promise that resolves with the exit code when the backend reports `command_finish`. Only one command may be in flight at a time:

```tsx
const { runCommand } = useSharedTerminal();

async function build() {
  const exitCode = await runCommand("npm run build");
  if (exitCode === 0) console.log("build succeeded");
}
```

## Customizing session creation

The backend's `create_terminal_router` accepts a custom request model. Pass a `createSession` callback to control the request body and derive the `session_id` yourself:

```tsx
<TerminalProvider
  baseUrl="http://localhost:2552"
  createSession={async ({ rows, cols }) => {
    const res = await fetch("http://localhost:2552/terminals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_name: "my-project", rows, cols }),
    });
    const { session_id } = await res.json();
    return session_id;
  }}
/>
```

## Working directory helper

The backend exposes `GET /terminals/{session_id}/cwd`. Use the bundled helper to fetch it:

```tsx
import { getTerminalCwd } from "termiccio-terminal-react";

const { cwd } = await getTerminalCwd("http://localhost:2552", sessionId);
```

## API

### `useTerminal(options): UseTerminalResult`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | `http://localhost:2552` | Backend base URL |
| `createSession` | `(dims) => Promise<string>` | `POST /terminals` | Creates a session and returns its id |
| `sessionStorageKey` | `string \| false` | `termiccio-terminal:session-id` | localStorage key for persistence; `false` disables it |
| `reconnectDelayMs` | `number` | `1000` | Delay before retrying a dropped socket |
| `initialHeight` | `number` | `320` | Initial container height for auto-fit |
| `padding` | `number` | `20` | Row padding used by the auto-fit snap |
| `followColorScheme` | `boolean` | `true` | Switch dark/light theme with the OS |
| `darkTheme` / `lightTheme` | `ITheme` | built-ins | Theme color overrides |
| `terminalOptions` | `Partial<ITerminalOptions>` | `{}` | Extra xterm.js options |
| `bufferReplay` | `boolean` | `true` | Replay buffered output via `update_id` on reconnect |

Returns `{ ref, status, sessionId, runCommand, useOnTerminalInput, terminalHeight, setTerminalHeight }`.

### `TerminalProvider` / `useSharedTerminal`

`TerminalProvider` accepts the same options as `useTerminal` plus `children`. Any descendant can read the terminal state via `useSharedTerminal()`.

### Backend helpers

| Export | Description |
|--------|-------------|
| `createTerminalSession(baseUrl, body)` | `POST /terminals` |
| `getTerminalCwd(baseUrl, sessionId)` | `GET /terminals/{id}/cwd` |
| `buildWebSocketUrl(baseUrl, sessionId, updateId)` | Build the streaming WS URL |
| `toWebSocketUrl(baseUrl)` | Convert `http(s)://` → `ws(s)://` |

## WebSocket protocol

The hook speaks the `termiccio-terminal` protocol (see the backend README). The message types are typed and re-exported from this package (`ServerTerminalMessage`, `ClientTerminalMessage`, etc.).

### Client → Server

| `type` | Fields |
|--------|--------|
| `stdin` | `data` |
| `resize` | `rows`, `cols` |
| `get_size` | |

### Server → Client

| `type` | Fields |
|--------|--------|
| `output` | `data`, `update_id` |
| `size` | `rows`, `cols` |
| `command_finish` | `command_index`, `return_code` |
| `error` | `error_type`, `message` |

## Regenerating protocol types

The `src/types.ts` interfaces mirror the backend's Pydantic models. To regenerate them from the Python schemas, run `pydantic2ts` against `termiccio-terminal` and drop the output into `src/types.ts`. `WriteFileRequest` is intentionally absent — that endpoint was removed from the backend.

## Development

```sh
git clone https://github.com/MatthewScholefield/termiccio-terminal-react.git
cd termiccio-terminal-react
npm install
npm run build      # type-check + bundle with tsup
npm test           # run vitest
```

## License

MIT
