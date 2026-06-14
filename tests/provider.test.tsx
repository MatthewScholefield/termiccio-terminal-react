import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSharedTerminal } from "../src/TerminalProvider";

describe("useSharedTerminal", () => {
  it("throws when used outside of a TerminalProvider", () => {
    expect(() => renderHook(() => useSharedTerminal())).toThrow(
      /must be used within a <TerminalProvider>/,
    );
  });
});
