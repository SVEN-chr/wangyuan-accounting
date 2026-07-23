import { useEffect, useRef, useState } from "react";
import {
  type LedgerSaveStatus,
  type LedgerSessionSnapshot,
  type SaveResult,
  createLedgerSession,
  createRuntimeLedgerSession,
} from "./ledgerSession";
import {
  type Ledger,
  type LedgerCommand,
  type LedgerCommandResult,
  type LedgerEntry,
} from "./ledgerCommands";

type LedgerSessionStore = ReturnType<typeof createLedgerSession>;

export type LedgerSession = {
  ledger: Ledger;
  ready: boolean;
  saveStatus: LedgerSaveStatus;
  dispatch(command: LedgerCommand): LedgerCommandResult;
  flush(): Promise<SaveResult | null>;
};

export function useLedgerSession(
  session: LedgerSessionStore,
): LedgerSession {
  const [snapshot, setSnapshot] = useState<LedgerSessionSnapshot>(() =>
    session.getSnapshot(),
  );

  useEffect(() => {
    const unsubscribe = session.subscribe(setSnapshot);
    void session.start();
    return () => {
      unsubscribe();
      session.dispose();
    };
  }, [session]);

  return {
    ...snapshot,
    dispatch: session.dispatch,
    flush: session.flush,
  };
}

export function useRuntimeLedgerSession({
  seedRecords = [],
}: {
  seedRecords?: LedgerEntry[];
}): LedgerSession {
  const sessionRef = useRef<LedgerSessionStore | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = createRuntimeLedgerSession({
      seedRecords,
    });
  }
  return useLedgerSession(sessionRef.current);
}
