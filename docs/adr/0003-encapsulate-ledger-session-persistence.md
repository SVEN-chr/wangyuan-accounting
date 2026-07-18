# Encapsulate persistence in a ledger session

React callers will interact with ledger state and persistence through one ledger-session interface that exposes the current ledger, command dispatch, readiness, save status, and an explicit flush operation. The session will hide debounce timing, serialized saves, pending-recovery generations, close-timeout recovery, and the Tauri and browser storage adapters. This preserves the existing data-safety behaviour while preventing lifecycle and recovery details from leaking into pages, the updater, or the composition root.
