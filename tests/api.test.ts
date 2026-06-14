import { describe, expect, it } from "vitest";
import {
  DEFAULT_BACKEND_URL,
  buildWebSocketUrl,
  toWebSocketUrl,
} from "../src/api";

describe("toWebSocketUrl", () => {
  it("converts http to ws", () => {
    expect(toWebSocketUrl("http://localhost:2552")).toBe("ws://localhost:2552");
  });

  it("converts https to wss", () => {
    expect(toWebSocketUrl("https://example.com")).toBe("wss://example.com");
  });

  it("has a sensible default backend url", () => {
    expect(DEFAULT_BACKEND_URL).toMatch(/^http/);
  });
});

describe("buildWebSocketUrl", () => {
  it("builds a ws url with update_id", () => {
    expect(buildWebSocketUrl("http://localhost:2552", "abc", 5)).toBe(
      "ws://localhost:2552/terminals/abc/ws?update_id=5",
    );
  });

  it("defaults update_id to 0", () => {
    expect(buildWebSocketUrl("http://localhost:2552", "abc")).toBe(
      "ws://localhost:2552/terminals/abc/ws?update_id=0",
    );
  });

  it("strips a trailing slash from the base url", () => {
    expect(buildWebSocketUrl("http://localhost:2552/", "abc", 0)).toBe(
      "ws://localhost:2552/terminals/abc/ws?update_id=0",
    );
  });
});
