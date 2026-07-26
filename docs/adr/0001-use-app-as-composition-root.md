# Use `App.tsx` as the composition root

`App.tsx` creates the runtime ledger session and updater controller, creates one read-only `LedgerQuery`, owns global navigation/modal state, and wires global notifications to the four feature modules. Domain calculations, persistence recovery, Excel workflows, updater concurrency, feature state and feature rendering stay behind their internal module interfaces. Reuse remains repository-internal: we do not create a generic component library or public package for hypothetical consumers.
