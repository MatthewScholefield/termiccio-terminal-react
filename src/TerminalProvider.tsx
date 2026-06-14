import { createContext, useContext } from "react";
import { useTerminal, type UseTerminalOptions, type UseTerminalResult } from "./useTerminal";

export const TerminalContext = createContext<UseTerminalResult | null>(null);

export interface TerminalProviderProps extends UseTerminalOptions {
  children: React.ReactNode;
}

export function TerminalProvider({ children, ...options }: TerminalProviderProps) {
  const value = useTerminal(options);
  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>;
}

/** Access the terminal created by a {@link TerminalProvider}. */
export function useSharedTerminal(): UseTerminalResult {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error("useSharedTerminal must be used within a <TerminalProvider>");
  }
  return context;
}
