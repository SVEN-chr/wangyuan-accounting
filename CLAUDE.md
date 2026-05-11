# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A desktop bookkeeping app ("书业账房 / 王源专属记账工作台") — Tauri 2 shell, React 19 + TypeScript frontend, single-page UI built to the "Receipt Ledger" (Variant B) design: warm bone/cream + amber/terracotta palette, ledger-paper texture, perforated receipt cards, JetBrains Mono numerals, oversized typography.

## Commands

`pnpm` is the package manager (note `pnpm-workspace.yaml`, but only one package).

- `pnpm dev` — Vite dev server on port 1420 (frontend only, browser-friendly via localStorage fallback)
- `pnpm build` — `tsc` type-check + Vite production build → `dist/`
- `pnpm preview` — preview the built bundle
- `pnpm tauri dev` — full desktop app (Vite + Rust + WebView). `beforeDevCommand` runs `pnpm dev` automatically
- `pnpm tauri build` — bundle production desktop binary

Type-check only (no emit, fastest signal): `pnpm exec tsc --noEmit`

Rust side (`src-tauri/`):
- `cargo test` — unit tests in `src-tauri/src/lib.rs`
- `cargo build` / `cargo check`

## Naming and bundling

The app has three distinct names — keep them straight:

- **npm + Cargo package**: `wangyuan-accounting` (must be ASCII; controls dev binary filename `wangyuan-accounting.exe` and `[package].name` everywhere a tool reads it).
- **Rust crate lib name**: `wangyuan_accounting_lib` — `src-tauri/src/main.rs` calls `wangyuan_accounting_lib::run()`. If you rename the package, snake-case the lib name to match and update `main.rs`.
- **Product name (user-facing)**: `王源专属记账工作台` — this is `tauri.conf.json` `productName`, the window title, and the bundled installer's filename (`王源专属记账工作台_<ver>_x64-setup.exe`).
- **Bundle identifier**: `com.administrator.wangyuan-accounting` — the OS-level app identity. Changing it makes the OS treat the build as a brand-new app.

**Windows bundling is NSIS-only.** `bundle.targets` deliberately excludes `msi`. WiX 3's `light.exe` fails when `productName` contains CJK characters (encodes the MSI filename in the ANSI codepage and dies). NSIS handles UTF-8 and Chinese installer filenames cleanly. The NSIS config enables `SimpChinese` + `English` languages with `displayLanguageSelector: false`, so the installer auto-picks based on system locale. **Don't add `"msi"` back** unless someone first solves the CJK encoding problem upstream.

## Repo layout — main worktree + feature worktrees

The main checkout lives at `D:/project/codex-project/demo07` (branch `main`). Feature branches are git worktrees under `.claude/worktrees/<branch-slug>/`. To merge a feature into main without `cd`-ing around:

```
git -C "D:/project/codex-project/demo07" merge --ff-only <branch>
```

If `main` has uncommitted work that conflicts (e.g. another agent's WIP), stash it with a labeled message before merging — don't silently overwrite. After merging into `main`, fast-forward the feature worktree's branch (`git merge --ff-only main`) to keep both in sync.

## Architecture

### Frontend is one file

Almost the entire app lives in `src/App.tsx` — top-level `App` component plus page components (`LedgerPage`, `StatsPage`, `CategoriesPage`, `BackupPage`), modals (`NewRecordModal`, `DeleteConfirmModal`), atoms (`CountUp`, `CatGlyph`, `GreetingStrip`, `TopBar`, `OpeningBalanceRow`), and all the helpers/types. Don't split it up unless asked — the design treats it as a coherent ledger artifact.

`src/App.css` is the matching style sheet. All theming flows from CSS variables on `:root` and `.v2-root` (`--v2-paper`, `--v2-ink`, `--v2-terra`, `--v2-olive`, etc.). Use those vars instead of hardcoded colors.

### Persistence: Tauri-first with localStorage fallback

`loadAccountingData` / `saveAccountingData` try Tauri commands first; on failure (e.g. running in plain browser via `pnpm dev`) they fall back to `localStorage`. This lets you iterate UI in a browser without launching the desktop shell.

- **Save is debounced** (300 ms) in the App's persist `useEffect`. Bursts of edits coalesce into one write — preserve this when refactoring the persist effect; don't move the work inline.
- **Save is atomic on the Rust side**: `save_accounting_store` writes to `accounting-data.json.tmp`, calls `sync_all` on the temp file, then `fs::rename`s over the target. The user's ledger is irreplaceable; don't drop the fsync or replace this with a plain `fs::write`.
- **Save only writes the consolidated localStorage key** (`accounting.file-store-fallback`). The three legacy split keys (`accounting.records` etc.) are still *read* by `loadFallback` for one-shot migration of old browser data, but never written.
- **`saveAccountingData` returns a `SaveResult`** — `{ ok: true } | { ok: false; error }`. A module-level `tauriAvailable` flag distinguishes "Tauri actually failed" (surface as `backupStatus` error banner) from "we're in a browser and Tauri was never available" (silent fallback). Don't go back to the older `void`-returning shape.

**Close-window flush — don't regress this.** Closing the desktop window must not drop the last edit, even when the 300 ms debounce hasn't fired or its invoke is still in flight. The persist effect tracks two things via refs:
- `pendingSaveRef` — the debounce `setTimeout` handle.
- `inFlightSaveRef` — a `Promise<SaveResult>` for the currently-running `saveAccountingData` invoke (set when the debounce callback fires; cleared in `.finally`).

A second `useEffect` registers two listeners:
- `getCurrentWindow().onCloseRequested` (via dynamic `import("@tauri-apps/api/window")` so the browser build doesn't blow up) — `event.preventDefault()`, run `flushSave()` (drain `pendingSaveRef` then `await inFlightSaveRef`), `window.confirm` on save failure, then `win.close()`. A `closingRef` guards reentry from the second close-requested event that `win.close()` triggers.
- `beforeunload` — pure browser-mode fallback. Synchronously clears the timer and calls `saveFallbackJson(FALLBACK_STORAGE_KEY, latestDataRef.current)` directly (NOT `saveAccountingData`, because its first `await` schedules the localStorage write into a microtask the tab won't live to run). Tauri webview doesn't fire `beforeunload` on close, so the two paths don't double-write.

If you touch the persist effect, keep `latestDataRef` / `pendingSaveRef` / `inFlightSaveRef` / `storageLoadedRef` / `closingRef` and the `runSave()` helper that wires the invoke promise into `inFlightSaveRef` — they're the contract the close handler relies on.

The Rust side (`src-tauri/src/lib.rs`) exposes three commands:
- `load_accounting_store` — reads `~/Desktop/王源专属记账工作台的文件夹/accounting-data.json`. Auto-migrates from legacy `app_data_dir` location on first read.
- `save_accounting_store` — atomic write via tmp + fsync + rename (see `atomic_write` helper, which takes `&Path` so callers can pass either `&Path` or `&PathBuf` through Deref).
- `save_excel_backup` — drops a sanitized `.xlsx` into the same workspace folder.

When you change `PersistedAccountingData` shape, update both the TS type AND the load/save migration logic — the file may contain older shapes from prior versions. The `migrateCategory` helper handles category-shape evolution.

### First-run seeding

If storage is empty AND `accounting.first-run-seeded` localStorage flag is unset, the app seeds `SAMPLE_RECORDS` (30 plausible bookkeeper-of-rare-books records anchored around 2026-04). After seeding, the flag is set so subsequent empty states stay empty.

### Domain model

- `Category`: `{ id, name, type: "expense"|"income", shape: square|circle|diamond|triangle|halfcircle, swatch: hex }`. `CatGlyph` renders the shape from these fields — categories are deliberately icon-less, distinguished by shape+color.
- `RecordItem`: `{ id, catId, amount, date: "YYYY-MM-DD", note? }`. Amounts always positive; sign comes from the category's type.
- `openingBalance`: editable via the receipt rail's 期初 row in the Ledger page; persisted alongside records/categories.
- `DEFAULT_CATEGORIES` are protected: `deleteCategory` refuses to remove them via the `DEFAULT_CATEGORY_IDS` Set. Custom categories use `custom-${Date.now()}` ids; Excel-imported ones use `excel-${type}-${slug}` to avoid collisions.

### Category lookups go through `getCat` / `catsById`

The App-level `useMemo` builds `catsById: Map<string, Category>` once and exposes a stable `getCat(id)` that closes over it (with a synthetic `"unknown"`/`"未分类"` fallback for stranded record ids). Pass `getCat` down — **don't write `categories.find(c => c.id === r.catId)` inline.** That pattern was an O(records × categories) hot-path bug across `LedgerPage` / `StatsPage` and was deliberately removed; reintroducing it regresses every page render.

`StatsPage` rebuilds its own `catsById` locally because it doesn't receive `getCat` as a prop — same Map, same idiom.

### Excel import/export

Three-sheet xlsx (`收支记录` / `分类` / `汇总`) via the `xlsx` library. Import overwrites everything after a `window.confirm`. Headers are language-tolerant (see `readExcelCell` candidate keys: `分类名称|分类|name`, `日期|date`, etc.) so users can hand-edit the file. Categories without a `形状`/`颜色` cell get auto-assigned from the `SHAPES` and `PALETTE` arrays.

### Charts and number formatting

- `fmtAmount(n, decimals=2)` — bare number `12,345.67`, no currency prefix. Use inside receipt rows / entry rows where the `¥` is rendered separately or the column is implicitly a money column.
- `fmtMoney(n, decimals=2)` — `"¥" + fmtAmount(...)`, full `¥12,345.67` form. (Don't write `fmtMoney(x).slice(1)` to strip the prefix — call `fmtAmount` directly.)
- `fmtCompact(n)` — abbreviated `1.2M` / `45.6K` / `89` for chart labels and the donut center. Use this anywhere a number could grow large (≥1M) and squeeze its container.
- `splitMoney(n)` — for big-typography splits like `¥48,290`+`.00`, used by `CountUp`.
- `dateKey(d)` / `monthKey(d)` / `today()` — canonical YYYY-MM-DD / YYYY-MM string formatters. **Both use local-timezone `getFullYear/Month/Date` parts**, not `toISOString().slice(...)` — going back to UTC silently shifts records created in the early morning (UTC+8) onto the wrong day. `parseExcelDate` also routes through `dateKey` for the same reason. Use these helpers; don't reinline the formatting.
- `buildMonthSeq(records, anchor)` — takes a `monthKey` string anchor (e.g. `currentMonthKey`), not a `Date`. Produces 6 month-keys ending at `max(anchor, latestRecordMonth)`, so charts include future-dated entries. Both `LedgerPage` and `StatsPage` go through this. Passing a `Date` constructed from `new Date(monthKey + "-01")` was a UTC-parsing trap in earlier versions — keep the string interface.
- `categoryBreakdown(cats, byCat, type)` — returns `{ items, total }` filtered to the given type, sorted by amount desc, with `total` clamped to `1` to keep `amount/total` divisions safe. Used by both pages' donut and bar charts.
- `BreakdownBars` component — renders the stats-bar list. Both expense and income breakdowns share it; don't reinline.
- `heatColor(intensity)` / `netColor(net)` — color-threshold lookups for the heatmap and the net-line chart dots. Don't re-implement the cascading `if`-chain inline.
- The stats trend chart uses an asymmetric Y mapping: positive net goes up 120 logical units (into the bar area); negative net goes down 70 units (below the y=200 baseline). Don't accidentally clip negative values off the SVG when changing the chart. The `yNet(net)` helper is hoisted in `StatsPage` — keep it that way (it was previously an IIFE and got nested 3 deep).

### Memo discipline

`LedgerPage` and `StatsPage` cache derived data with `useMemo` keyed on **string keys** (`todayKey`, `currentMonthKey`) rather than the `now: Date` object. `now = new Date()` runs fresh per render, but the heavy memos only invalidate when the date string actually changes — so re-renders from filter clicks or modal toggles don't recompute monthSeq/heatDays/dailyAggregates. If you add a memo that depends on "today", depend on `todayKey`, never on `now`.

Inside those memos, reconstruct a working `Date` from the key with `new Date(y, m-1, d)` (parts) — not `new Date(todayKey)` or `new Date(monthKey + "-01")`. The string form is parsed as UTC midnight and disagrees with `dateKey`/`monthKey` in non-UTC timezones; the heatmap/`dailyAggregates`/`buildMonthSeq` call sites all use the parts form.

### Greeting / trend copy is data-driven

`GreetingStrip`'s `note` prop is the trend message. `LedgerPage` computes it from real `stats.byMonth` values comparing the current calendar month vs prior 5 months — never hardcode strings like "本月节余创近半年新高" again.

## Conventions

- Chinese UI text, with letter-spacing applied per-character via spaces (e.g. `书 业 账 房`, `保 存 记 录`). Match this when adding new copy.
- Mono-font `.mono` class for caption-style metadata (uppercase, tracked, muted color). All numerical/tabular data uses `font-variant-numeric: tabular-nums`.
- Receipt cards (`.v2-receipt`, `.v2-modal-card`) use perforated edges via `radial-gradient` masks (`.v2-receipt-perf` / `.v2-modal-perf`). Keep the perf elements when adding new ledger surfaces.
- Default categories must not be deletable — the UI hides the delete button via the `DEFAULT_CATEGORY_IDS` Set lookup (don't revert to `DEFAULT_CATEGORIES.some(...)` in render code).
