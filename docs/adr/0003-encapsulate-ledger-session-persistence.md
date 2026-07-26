# Encapsulate persistence in a ledger session

React callers use `useRuntimeLedgerSession()` and receive only the current ledger, command dispatch, readiness, save status, and an explicit `flush` operation. `createLedgerSession` hides debounce timing, serialized saves, pending-recovery generations, close-timeout recovery and lifecycle restart; runtime assembly hides the Tauri and browser storage adapters. This preserves the data-safety behavior while preventing lifecycle, localStorage keys and recovery details from leaking into features, the updater or the composition root.
