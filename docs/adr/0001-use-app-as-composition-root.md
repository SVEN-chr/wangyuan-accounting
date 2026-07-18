# Use `App.tsx` as the composition root

The frontend was originally kept in one file to preserve the visual cohesion of the ledger artifact, but that file now combines domain calculations, persistence recovery, Excel workflows, updater orchestration, page state, and rendering. We will make `App.tsx` the composition root and move those behaviours into internal deep modules with small interfaces while preserving all user-visible behaviour and persisted formats. Reuse remains repository-internal: we will not create a generic component library or public package for hypothetical consumers.
