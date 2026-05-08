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

The Rust side (`src-tauri/src/lib.rs`) exposes three commands:
- `load_accounting_store` — reads `~/Desktop/王源专属记账工作台的文件夹/accounting-data.json`. Auto-migrates from legacy `app_data_dir` location on first read.
- `save_accounting_store` — writes the same file.
- `save_excel_backup` — drops a sanitized `.xlsx` into the same workspace folder.

When you change `PersistedAccountingData` shape, update both the TS type AND the load/save migration logic — the file may contain older shapes from prior versions. The `migrateCategory` helper handles category-shape evolution.

### First-run seeding

If storage is empty AND `accounting.first-run-seeded` localStorage flag is unset, the app seeds `SAMPLE_RECORDS` (30 plausible bookkeeper-of-rare-books records anchored around 2026-04). After seeding, the flag is set so subsequent empty states stay empty.

### Domain model

- `Category`: `{ id, name, type: "expense"|"income", shape: square|circle|diamond|triangle|halfcircle, swatch: hex }`. `CatGlyph` renders the shape from these fields — categories are deliberately icon-less, distinguished by shape+color.
- `RecordItem`: `{ id, catId, amount, date: "YYYY-MM-DD", note? }`. Amounts always positive; sign comes from the category's type.
- `openingBalance`: editable via the receipt rail's 期初 row in the Ledger page; persisted alongside records/categories.
- `DEFAULT_CATEGORIES` are protected: `deleteCategory` refuses to remove them. Custom categories use `custom-${Date.now()}` ids; Excel-imported ones use `excel-${type}-${slug}` to avoid collisions.

### Excel import/export

Three-sheet xlsx (`收支记录` / `分类` / `汇总`) via the `xlsx` library. Import overwrites everything after a `window.confirm`. Headers are language-tolerant (see `readExcelCell` candidate keys: `分类名称|分类|name`, `日期|date`, etc.) so users can hand-edit the file. Categories without a `形状`/`颜色` cell get auto-assigned from the `SHAPES` and `PALETTE` arrays.

### Charts and number formatting

- `fmtMoney(n, decimals=2)` — full `¥12,345.67` form.
- `fmtCompact(n)` — abbreviated `1.2M` / `45.6K` / `89` for chart labels and the donut center. Use this anywhere a number could grow large (≥1M) and squeeze its container.
- `splitMoney(n)` — for big-typography splits like `¥48,290`+`.00`, used by `CountUp`.
- `buildMonthSeq(records, now)` — produces 6 month-keys ending at `max(currentMonth, latestRecordMonth)`, so charts include future-dated entries the user has manually entered. Both `LedgerPage` and `StatsPage` go through this.
- The stats trend chart uses an asymmetric Y mapping: positive net goes up 120 logical units (into the bar area); negative net goes down 70 units (below the y=200 baseline). Don't accidentally clip negative values off the SVG when changing the chart.

### Greeting / trend copy is data-driven

`GreetingStrip`'s `note` prop is the trend message. `LedgerPage` computes it from real `stats.byMonth` values comparing the current calendar month vs prior 5 months — never hardcode strings like "本月节余创近半年新高" again.

## Conventions

- Chinese UI text, with letter-spacing applied per-character via spaces (e.g. `书 业 账 房`, `保 存 记 录`). Match this when adding new copy.
- Mono-font `.mono` class for caption-style metadata (uppercase, tracked, muted color). All numerical/tabular data uses `font-variant-numeric: tabular-nums`.
- Receipt cards (`.v2-receipt`, `.v2-modal-card`) use perforated edges via `radial-gradient` masks (`.v2-receipt-perf` / `.v2-modal-perf`). Keep the perf elements when adding new ledger surfaces.
- Default categories must not be deletable — the UI hides the delete button for them (`DEFAULT_CATEGORIES.some(...)` check).
