# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

> `AGENTS.md` is the only maintained source of agent instructions for this repository. Make all future instruction changes here; keep `CLAUDE.md` as a reference to this file only.

## What this is

A desktop bookkeeping app ("书业账房 / 王源专属记账工作台") — Tauri 2 shell, React 19 + TypeScript frontend, single-page UI built to the "Receipt Ledger" (Variant B) design: warm bone/cream + amber/terracotta palette, ledger-paper texture, perforated receipt cards, JetBrains Mono numerals, oversized typography.

## Commands

`pnpm` is the package manager (note `pnpm-workspace.yaml`, but only one package).

- `pnpm dev` — Vite dev server on port 1420 (frontend only, browser-friendly via localStorage fallback)
- `pnpm build` — `tsc` type-check + Vite production build → `dist/`
- `pnpm check:release` — validate the release contract against real project files without network access
- `pnpm preview` — preview the built bundle
- `pnpm tauri dev` — full desktop app (Vite + Rust + WebView). `beforeDevCommand` runs `pnpm dev` automatically
- `pnpm tauri build` — bundle production desktop binary
- `pnpm icons` — regenerate all app icons from `src-tauri/icons/icon-source.svg`. `scripts/build-icons.mjs` renders the SVG to a 1024² PNG via `@resvg/resvg-js` (pure-WASM, loads system fonts so the CJK glyph 账 resolves), then hands it to `pnpm tauri icon` to emit every size + `.ico` + `.icns`. Run only after editing the source SVG.

Type-check only (no emit, fastest signal): `pnpm exec tsc --noEmit`

Rust side (`src-tauri/`):
- `cargo test` — unit tests colocated with the Rust modules under `src-tauri/src/`
- `cargo build` / `cargo check`

## Naming and bundling

The app has three distinct names — keep them straight:

- **npm + Cargo package**: `wangyuan-accounting` (must be ASCII; controls dev binary filename `wangyuan-accounting.exe` and `[package].name` everywhere a tool reads it).
- **Rust crate lib name**: `wangyuan_accounting_lib` — `src-tauri/src/main.rs` calls `wangyuan_accounting_lib::run()`. If you rename the package, snake-case the lib name to match and update `main.rs`.
- **Product name (user-facing)**: `王源专属记账工作台` — this is `tauri.conf.json` `productName`, the window title, and the bundled installer's filename (`王源专属记账工作台_<ver>_x64-setup.exe`). Note GitHub sanitizes the CJK out of the *uploaded release asset* name (it becomes `_<ver>_x64-setup.exe`), which is why the CI generates the updater manifest by hand — see **Auto-update** below.
- **Bundle identifier**: `com.administrator.wangyuan-accounting` — the OS-level app identity. Changing it makes the OS treat the build as a brand-new app.

**Windows bundling is NSIS-only.** `bundle.targets` deliberately excludes `msi`. WiX 3's `light.exe` fails when `productName` contains CJK characters (encodes the MSI filename in the ANSI codepage and dies). NSIS handles UTF-8 and Chinese installer filenames cleanly. The NSIS config enables `SimpChinese` + `English` languages with `displayLanguageSelector: false`, so the installer auto-picks based on system locale. **Don't add `"msi"` back** unless someone first solves the CJK encoding problem upstream.

## Repo layout — commit directly to `main`

**The maintainer works solo and wants changes committed straight to `main` — do not auto-create a feature branch before committing.** This overrides the usual "branch first on the default branch" reflex for this repo.

The main checkout lives at `D:/project/wangyuan-accounting` (branch `main`). When branches/worktrees *are* explicitly in play, feature branches live as git worktrees under `.Codex/worktrees/<branch-slug>/`. To merge one into main without `cd`-ing around:

```
git -C "D:/project/wangyuan-accounting" merge --ff-only <branch>
```

If `main` has uncommitted work that conflicts (e.g. another agent's WIP), stash it with a labeled message before merging — don't silently overwrite. After merging into `main`, fast-forward the feature worktree's branch (`git merge --ff-only main`) to keep both in sync.

## Architecture

### Frontend module contracts

`src/App.tsx` is the composition root. It creates the runtime ledger session and updater controller, owns only page/new-entry-modal navigation state, creates one `LedgerQuery` for the current ledger, and wires global navigation/notifications to the four features. Do not put domain rules, statistics, workbook parsing, persistence recovery, updater concurrency, or feature rendering back into it.

- `src/ledgerCommands.ts` owns the `Ledger` / `LedgerEntry` / `Category` model and the pure `applyLedgerCommand(ledger, command)` mutation seam. All ledger changes must use its `entry.*`, `category.*`, `opening-balance.set`, or `import.replace` commands.
- `src/ledgerFormat.ts` is the only home for shared local-date and money-formatting primitives. `src/ledgerQueries.ts` builds the read-only `LedgerQuery` seam once per ledger and owns category lookup, sorting/filtering, heatmap data, overview and statistics.
- `src/ledgerSession.ts` owns persistence adapters and the imperative `createLedgerSession` engine; `src/useLedgerSession.ts` is only the React binding and runtime assembly.
- `src/ledgerWorkbook.ts` owns xlsx encode/decode compatibility. `src/ledgerWorkbookFile.ts` owns final Tauri-or-browser file delivery; `BackupFeature` owns file selection, confirmation and status copy.
- `src/updateController.ts` owns updater state/concurrency and runtime Tauri adapters; `src/useUpdateController.ts` is only the React binding.
- `src/features/{ledger,stats,categories,backup}/` owns each feature's rendering, local interaction state and feature CSS. `src/app/` owns global navigation, notifications and first-run sample data.
- `src/ui/` is limited to genuinely shared UI or an independent presentation contract (`FeatureHeader`, `CatGlyph`, updater progress formatting). Do not add generic prop-forwarding wrappers.

CSS follows the same ownership: `src/styles/theme.css` defines tokens, `src/styles/base.css` defines global element defaults, `src/ui/shared.css` and component CSS define shared UI, `src/App.css` defines only the app shell/global overlays, and every feature imports its own CSS. All theming flows from `var(--v2-*)`; do not copy hard-coded theme colors into extracted styles.

### Persistence: Tauri-first with localStorage fallback

`useRuntimeLedgerSession()` exposes `{ ledger, ready, saveStatus, dispatch, flush }` and hides the entire storage lifecycle. `createRuntimeLedgerSession()` uses `isTauri()` to select `TauriLedgerPersistenceAdapter` or `BrowserLedgerPersistenceAdapter`; features and `App.tsx` must never read localStorage keys, call the storage commands, or coordinate save timing themselves. Plain `pnpm dev` remains browser-friendly through the localStorage adapter.

- **Save is debounced by 300 ms inside `createLedgerSession`.** `dispatch()` updates its latest ledger synchronously and schedules the newest snapshot. `flush()` clears the timer, queues that snapshot, and waits for the current queue tail.
- **Loaded data is not written back on a normal start.** `start()` only schedules an immediate save for first-run samples or a recovered pending snapshot. This avoids a redundant atomic write while ensuring those two disk-divergent states are persisted.
- **Fallback is a cold path.** `TauriLedgerPersistenceAdapter.load()` accepts a valid consolidated desktop ledger without reading fallback data unless `accounting.pending-save` is set. Missing/malformed desktop payloads and invoke failures use the browser fallback; a read failure still reports `storeExists: true`, so it can never trigger first-run seeding.
- **Pending-save recovery is the one exception to "disk is truth".** A failed desktop save writes the newest ledger to `accounting.file-store-fallback` and sets `accounting.pending-save`. A pending cold start returns that validated fallback even if disk is valid. Only the latest queued snapshot from the current recovery generation may refresh fallback and clear pending; a close-timeout recovery advances the generation so an older in-flight save cannot clear newer recovery state.
- **Save is serialized in TypeScript and atomic in Rust.** The session's queue prevents an older slow write from overtaking a newer one. Rust `atomic_write` uses `<target>.tmp.<pid>.<counter>`, `write_all`, `sync_all`, then same-directory `fs::rename`. Do not remove either layer or replace it with plain `fs::write`.
- **Browser writes use only the consolidated key.** The legacy split `accounting.records`, `accounting.categories`, and `accounting.opening-balance` keys remain read-only migration inputs.
- **Save results are explicit.** `SaveResult` is `{ ok: true } | { ok: false; error; recoverySaved }`; `recoverySaved` is true only when both the fallback ledger and pending marker are secure. UI text must not promise recovery when it is false.
- **Save failures are global.** `useBackupStatus` mirrors session errors, and `AppNotifications` shows `.v2-save-toast` outside the Backup feature while the Backup feature shows the same status inline.

**Close-window flush — don't regress this.** `createLedgerSession` registers lifecycle callbacks through `LedgerLifecycleAdapter`. Desktop close immediately prevents the first close request, marks the session closing, flushes the pending/tail save, and races it against 3 seconds. Timeout stores a synchronous recovery snapshot; if recovery also fails, the user may cancel closing. `createWindowLedgerLifecycleAdapter` calls `void win.close()` — never await it, because awaiting deadlocks against the same close handler. Browser `beforeunload` clears the debounce and synchronously calls `adapter.syncFallback(latestLedger)`; an async save would not finish before tab teardown. Required ACL permissions remain `core:window:allow-close` and `core:window:allow-destroy`.

When changing the session, preserve its latest-ledger update, pending timer, in-flight queue tail, recovery flag/generation, activation generation (React StrictMode restart), closing guard and lifecycle cleanup as one contract. Test this through `createLedgerSession` with in-memory adapters, not private fields or React refs.

### Rust composition root and deep modules

`src-tauri/src/lib.rs` is only the Tauri composition root: apply the proxy bridge, register the opener/updater/process plugins, register the three storage commands, and run the app. `src-tauri/src/storage.rs` owns workspace paths, legacy migration, filename sanitization and atomic writes. `src-tauri/src/system_proxy.rs` owns Windows registry access plus proxy normalization and exposes a no-op on non-Windows. Keep these responsibilities separate; do not add a generic Rust utility module or change command names/parameters.

The storage module exposes:
- `load_accounting_store` — reads `~/Desktop/王源专属记账工作台的文件夹/accounting-data.json`. Auto-migrates from legacy `app_data_dir` location on first read, and best-effort `fs::remove_file`s the legacy source after a successful `atomic_write` so subsequent empty-store launches don't keep re-migrating.
- `save_accounting_store` — atomic write via unique-temp + fsync + rename (see `atomic_write` helper, which takes `&Path` so callers can pass either `&Path` or `&PathBuf` through Deref).
- `save_excel_backup` — drops a sanitized `.xlsx` into the same workspace folder, **also through `atomic_write`** so a crash mid-write can't destroy the user's previous good backup.

When changing the `Ledger` shape, update both the domain type and `normalizePersistedLedger` migration logic — files may contain older shapes. `migrateCategory` handles category-shape evolution.

### Auto-update (Tauri updater)

The app self-updates via `tauri-plugin-updater` + `tauri-plugin-process`. `src/updateController.ts` owns updater behavior and runtime adapters, `src/useUpdateController.ts` owns React subscription/startup checking, `AppNotifications` and `BackupFeature` render the two presentation surfaces, `src-tauri/src/lib.rs` registers plugins, `src-tauri/src/system_proxy.rs` bridges the system proxy, and `.github/workflows/release-windows.yml` signs and publishes the manifest.

- **Flow.** `useRuntimeUpdateController` starts one silent `controller.check(false)` and only surfaces UI when an update exists. Manual checks call `check(true)` and show checking/up-to-date/errors. `install()` first awaits the injected ledger `flush`; it cancels only when saving failed *and* no recovery snapshot exists, then calls `downloadAndInstall`, publishes progress, and relaunches. Runtime updater/process APIs are dynamically imported so browser development degrades to "仅桌面端支持检查更新".
- **Concurrency (keep the three roles separate).** `checkInFlight` guards overlapping checks, `installing` guards installation, and `manualPending` upgrades an in-flight silent check to manual presentation. `check({ timeout: 20000 })` prevents a dead network from holding the lock forever. These belong inside `createUpdateController`, not React refs or feature components.
- **`package.json` is the release-version source of truth.** `tauri.conf.json` points its `version` at `../package.json`, and the browser fallback in `BackupFeature.tsx` imports the same value (desktop runtime still uses `getVersion()`). `Cargo.toml` keeps the Rust package copy because Cargo requires it. Releasing = bump `package.json` + `src-tauri/Cargo.toml` → run `pnpm check:release` → tag `vX.Y.Z` → push the tag. The release contract fails on version/tag/repository/endpoint drift and never rewrites source files.
- **The signing key is irreplaceable.** Updates are minisign-signed. The public key is in `tauri.conf.json` `plugins.updater.pubkey`; the private key + password are GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (also kept locally as gitignored `wangyuan-updater.key*`). Lose them and no future build can be signed — every installed client would need a manual reinstall against a new pubkey.
- **CI still generates `latest.json` explicitly — do not delete that step.** `tauri-action` refuses to emit the updater manifest when `productName` is CJK (logs `Signature not found for the updater JSON. Skipping upload...`), and GitHub strips the CJK from the asset name. The workflow adapter fetches the actual release-asset JSON and passes it with the local NSIS bundle directory to `scripts/release-cli.mjs`; `scripts/release-contract.mjs` requires exactly one uploaded `*-setup.exe` and one local `*-setup.exe.sig`, preserves the signature text, and emits UTF-8 without BOM. `gh release upload` remains in the workflow. **Don't "fix" this by making `productName` ASCII** — that breaks the Chinese installer-name requirement.
- **Hosting goes through GitHub-acceleration mirrors (for no-proxy mainland-China users).** GitHub is unreachable from China without a proxy, so `endpoints` lists several mirrors (`ghfast.top`, `gh-proxy.com`, `gh.llkk.cc`) ahead of direct `github.com`; the updater tries them in order, so a dead mirror falls through to the next. The installer `url` inside `latest.json` has no fallback (one string per platform), so the release contract derives its primary mirror from the first updater endpoint. To change it, reorder/edit `endpoints` and re-release. Mirror availability churns; the deterministic gate does not probe the network, so re-test live with `curl --noproxy "*" -L "<mirror>/<github-url>"` (this dev box sits inside the GFW, so `--noproxy` faithfully simulates a no-proxy user). **The repo must stay public** or the endpoints 404.
- **Proxy bridge (`apply_system_proxy_to_env` in `src-tauri/src/system_proxy.rs`, Windows-only).** The updater's `reqwest` honors only `HTTP(S)_PROXY` env vars, *not* the Windows "system proxy" registry that browsers use — so Clash/v2rayN "system proxy" users would hit `error sending request`. On startup we read `HKCU\...\Internet Settings` (`ProxyEnable` / `ProxyServer`), normalize it (`normalize_proxy`, unit-tested), and export `HTTP(S)_PROXY` so both check and download go through the proxy. PAC (`AutoConfigURL`) is not handled. Only set when the user hasn't already exported a proxy.
- **Bootstrap caveat.** Any updater fix (proxy bridge, mirror endpoints, new pubkey…) only takes effect once a build *carrying it* is installed. The version that introduces a fix must be installed manually; auto-update only kicks in for the version after that.
- **ACL.** `capabilities/default.json` needs `updater:default` and `process:allow-restart`.

### First-run seeding

`shouldSeedLedger` allows seeding only when no desktop store exists, the effective fallback still equals untouched defaults, and `accounting.first-run-seeded` is unset. An existing store with zero records is an intentional empty ledger and must never be reseeded or have custom categories replaced. `start()` marks the seed and schedules it immediately so a fresh launch is persisted even without a later edit.

### Domain model

- `Category`: `{ id, name, type: "expense"|"income", shape: square|circle|diamond|triangle|halfcircle, swatch: hex }`. `CatGlyph` renders the shape from these fields — categories are deliberately icon-less, distinguished by shape+color.
- `LedgerEntry`: `{ id, catId, amount, date: "YYYY-MM-DD", note? }`. Amounts are positive; sign comes from the category type. `LedgerFeature` uses `isRecordFormComplete(form)` for both submit and button state, while `applyLedgerCommand` independently enforces category/date/positive-finite-amount invariants at the domain seam.
- `openingBalance`: editable via the receipt rail's 期初 row in the Ledger page; persisted alongside records/categories.
- `DEFAULT_CATEGORIES` are protected: `applyLedgerCommand` rejects `category.delete` for IDs in `DEFAULT_CATEGORY_IDS`. `entry.create` and `category.create` collision-check caller-provided preferred IDs; workbook decoding also de-duplicates imported entry/category IDs. `category.create` and `import.replace` reject duplicate `type + trimmed name` identities.

### Category lookups go through `LedgerQuery`

`createLedgerQuery(ledger)` builds one category `Map` and exposes `query.category(id)` with the synthetic `"unknown"` / `"未分类"` fallback. `App.tsx` memoizes one query per ledger and passes it to every feature. Do not reintroduce inline ID lookups such as `categories.find(c => c.id === entry.catId)` or rebuild statistics inside a feature; that regresses the centralized O(1) lookup/read-model seam. Looking up the first category by **type** for form defaults is a different operation and may remain feature-local.

### Excel import/export

`encodeLedgerWorkbook(ledger)` and `decodeLedgerWorkbook(bytes)` are the only xlsx domain seam. They preserve the three sheets (`收支记录` / `分类` / `汇总`), language-tolerant headers (`分类名称|分类|name`, `日期|date`, etc.), date/amount parsing, category inference/de-duplication and structured diagnostics. Decoding returns only `records` + `categories`; `BackupFeature` confirms the replacement and dispatches `import.replace`, which deliberately preserves `openingBalance`. Categories without shape/color cells use `CATEGORY_SHAPES` and `CATEGORY_SWATCHES`.

**Type inference & category de-dup on import.** Exported amounts are positive, so a row without a type first resolves through the 分类 sheet's `typeByName`; only unknown/ambiguous names fall back to amount sign. The category pass skips duplicate `type:name` rows before adding them, and entry IDs are de-duplicated against the complete import candidate. Do not move these rules into `BackupFeature`.

**`xlsx` is lazy-loaded.** `ledgerWorkbook.ts` memoizes `import("xlsx")`; neither `App.tsx` nor `BackupFeature` may statically import SheetJS. This keeps the workbook chunk out of cold launch.

### Queries, charts and number formatting

- `formatAmount(n, decimals=2)` — bare number `12,345.67`; use where `¥` is rendered separately or the column is implicitly monetary.
- `formatMoney(n, decimals=2)` — full `¥12,345.67`. Do not strip its prefix with `.slice(1)`; call `formatAmount`.
- `formatCompactAmount(n)` — abbreviated `1.2M` / `45.6K` / `89` for constrained chart labels. `splitMoney(n)` supports large integer/decimal typography.
- `dateKey(d)` / `monthKey(d)` / `todayKey()` use local date parts. Never replace them with `toISOString().slice(...)`, which shifts early-morning Asia/Shanghai dates. `parseDateKey(key)` is the local-time inverse; never parse a ledger key with `new Date(key)`.
- `validLocalDateKey` is the strict constructor used by workbook parsing. `addDaysKey` and `clampDateKey` own day-window movement/bounds and handle month/year/DST transitions.
- Month sequences, current-month figures, weekly caps, category breakdowns, heatmap values and statistics come from `query.ledgerOverview(referenceDay)`, `query.breakdown(type)`, `query.heatmap(...)`, and `query.statistics(referenceDay)`. Features render these results; they do not reconstruct them.
- Future entries may extend the six-month series, but `LedgerOverview.currentMonth` and `LedgerStatistics.referenceMonth` remain anchored to the supplied current day. `monthSeries[5]` is valid only as the chart-window end label, never as "current month".
- `BreakdownBars` is local to `StatsFeature` and serves both income/expense reports. `heatColor` / `HEAT_LEGEND` stay local to the ledger heatmap, and `netColor` / `netY` stay local to the statistics chart because those are presentation contracts, not ledger calculations. `netY` retains the asymmetric +120 / -70 mapping around the y=200 baseline.

### Memo discipline

`App.tsx` memoizes `createLedgerQuery(ledger)`. `LedgerFeature` and `StatsFeature` then memoize public query calls using string day/month keys, never a fresh `Date` object. A memo that depends on today should depend on the string key. Convert a ledger key back to a working date only through `parseDateKey`; `new Date("YYYY-MM-DD")` is UTC midnight and disagrees with the local-date contract. Heatmap results depend on navigable `heatEnd`, not today's key.

### Greeting / trend copy is data-driven

`GreetingStrip` receives `overview.trendNote` from `query.ledgerOverview(referenceDay)`. The query derives it from real current/prior month data; do not hardcode trend copy in the feature.

### Ledger feature: heat-window navigation, day view, entry pagination

`LedgerFeature` holds three pieces of non-persisted view state that drive the "每日支出强度" heatmap and the "近期账目" list:

- **`heatEnd`** (a `YYYY-MM-DD` key, initialized to the current day) is the last day of the 42-day grid. Arrow controls step a complete window, 回到今天 resets it, and the date input jumps and selects. Every transition uses `addDaysKey` + `clampDateKey` against query-provided bounds.
- **`dateBounds`** comes from `query.dateBounds(currentDay)`, which includes today plus the earliest history and future-dated entries. A feature effect re-clamps `heatEnd` when deleting data shrinks the range.
- **`selectedDay`** switches the list to `query.entriesOnDay(selectedDay)` and the "当 日 账 目" view. `null` restores the normal `query.entries(filter, referenceMonth)` list.

Entries are paginated at 12 per page. Derive the label, numbering, disabled state and navigation from `safePage = min(entryPage, totalPages)`, not stale raw state. Prev/next must assign `safePage ± 1`; a functional update can dead-click after deletion shrinks the page count. Filter/day-view changes reset the page to 1.

## Conventions

- Chinese UI text, with letter-spacing applied per-character via spaces (e.g. `书 业 账 房`, `保 存 记 录`). Match this when adding new copy.
- Mono-font `.mono` class for caption-style metadata (uppercase, tracked, muted color). All numerical/tabular data uses `font-variant-numeric: tabular-nums`. The full mono fallback stack (`"JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, monospace`) is centralized on the `--v2-mono` CSS variable — use `font-family: var(--v2-mono);` instead of inlining the stack so the fallback chain stays consistent. Inside SVG, prefer `style={{ fontFamily: "var(--v2-mono)" }}` on `<text>` over the `fontFamily="JetBrains Mono"` presentation attribute, because the attribute form can't resolve CSS custom properties and silently drops the fallback chain.
- Receipt cards (`.v2-receipt`, `.v2-modal-card`) use perforated edges via `radial-gradient` masks (`.v2-receipt-perf` / `.v2-modal-perf`). Keep the perf elements when adding new ledger surfaces.
- Default categories must not be deletable — the UI hides the delete button via the `DEFAULT_CATEGORY_IDS` Set lookup (don't revert to `DEFAULT_CATEGORIES.some(...)` in render code).

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `SVEN-chr/wangyuan-accounting`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository: domain vocabulary belongs in root `CONTEXT.md`, and architectural decisions belong in `docs/adr/`. See `docs/agents/domain.md`.
