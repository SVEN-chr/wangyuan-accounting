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
- **Product name (user-facing)**: `王源专属记账工作台` — this is `tauri.conf.json` `productName`, the window title, and the bundled installer's filename (`王源专属记账工作台_<ver>_x64-setup.exe`). Note GitHub sanitizes the CJK out of the *uploaded release asset* name (it becomes `_<ver>_x64-setup.exe`), which is why the CI generates the updater manifest by hand — see **Auto-update** below.
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
- **First post-load tick is skipped** via `persistedSinceLoadRef`. The load handler calls `setRecords`/`setCategories`/`setOpeningBalance` with the values just read off disk; without the guard, the very next render would queue a debounced save that writes back the identical bytes (one wasted `atomic_write` + fsync per launch). Don't remove this skip; the close-handler still works because `flushSave()` only awaits an actually-pending invoke. **Exception — the first-run seed path pre-arms `persistedSinceLoadRef.current = true`** before the persist effect runs: seeded `SAMPLE_RECORDS` differ from the (empty) disk and *must* be written, so the first tick has to save, not skip. Without this, closing a fresh launch with no edit drops the seed, and the already-set `first-run-seeded` flag blocks re-seeding → permanently empty ledger.
- **`loadFallback` is only consulted on cold paths.** `loadAccountingData`'s Tauri-success branch checks whether all three top-level fields (`records`/`categories`/`openingBalance`) parsed cleanly; if so it returns without touching localStorage. The fallback (3 localStorage reads + 3 JSON.parse) only fires on empty payload, malformed shape, or invoke failure — don't move it back above the validity check.
- **Pending-save recovery (the one exception to "disk is truth").** When a *real* Tauri `save_accounting_store` fails, the newest edits land only in the localStorage fallback while disk still holds the older good copy (`atomic_write` leaves the original intact on error). `saveAccountingData` sets a `accounting.pending-save` localStorage flag (`setPendingSave(true)`) in that branch, and clears it (`setPendingSave(false)`) on the next successful save. On launch, if the on-disk payload parses cleanly **but the flag is set**, `loadAccountingData` returns `loadFallback()` (the newer copy) instead of the stale disk data — this is the *only* place the fallback is consulted past the validity gate, and it stays gated on the flag so the normal disk-is-truth path is untouched. The mount handler then pre-arms `persistedSinceLoadRef.current = true` (same trick as the seed path) so the first persist tick **re-writes** the recovered data to disk; that successful write clears the flag. Without this, a transient save failure would silently lose the post-failure edits on next launch even though the close dialog promised "下次启动会尝试恢复". Don't drop the flag set/clear pair or the recovery branch.
- **`latestDataRef` is updated on the persist effect's first line**, before any `storageLoaded` gate or skip-tick early return. The close handler and `beforeunload` listener depend on it always reflecting the most recent state, even before the first real save fires.
- **Save is atomic on the Rust side**: the `atomic_write` helper writes to a **unique** per-process temp file (`<target>.tmp.<pid>.<counter>`), calls `sync_all` on it, then `fs::rename`s over the target. The unique suffix matters — two overlapping saves (a debounce write firing while a prior invoke is still in flight; the JS layer doesn't await the previous invoke before starting the next) must not share one temp file and truncate each other. The user's ledger is irreplaceable; don't drop the fsync, don't go back to a fixed `.tmp` name, and don't replace this with a plain `fs::write`.
- **Save only writes the consolidated localStorage key** (`accounting.file-store-fallback`). The three legacy split keys (`accounting.records` etc.) are still *read* by `loadFallback` for one-shot migration of old browser data, but never written.
- **`saveAccountingData` returns a `SaveResult`** — `{ ok: true } | { ok: false; error }`. A module-level `tauriAvailable` flag distinguishes "Tauri actually failed" (surface as `backupStatus` error banner) from "we're in a browser and Tauri was never available" (silent fallback). Don't go back to the older `void`-returning shape.
- **Save-failure visibility is global.** `runSave` writes errors into `backupStatus`, and the App renders a fixed-position `.v2-save-toast` whenever `backupStatus.type === "error"` *and* `page !== "backup"` (the Backup page already shows the same status inline). Don't move the error UI back inside `BackupPage` only — users editing on Ledger/Stats/Categories would silently lose Tauri writes.

**Close-window flush — don't regress this.** Closing the desktop window must not drop the last edit, even when the 300 ms debounce hasn't fired or its invoke is still in flight. The persist effect tracks two things via refs:
- `pendingSaveRef` — the debounce `setTimeout` handle.
- `inFlightSaveRef` — a `Promise<SaveResult>` for the currently-running `saveAccountingData` invoke (set when the debounce callback fires; cleared in `.finally`).

A second `useEffect` registers two listeners:
- `getCurrentWindow().onCloseRequested` (via dynamic `import("@tauri-apps/api/window")` so the browser build doesn't blow up) — `event.preventDefault()`, set `closingRef.current = true` *immediately*, run `flushSave()` wrapped in `Promise.race` against a 3s timeout (so a stuck invoke can't freeze the X button), `window.confirm` on save failure (reset `closingRef` to `false` if the user picks "cancel" so a subsequent click still works), then **`void win.close()` — never `await`**. Awaiting deadlocks against this very handler: Rust waits for the JS handler's Promise to resolve, while JS waits for Rust to finish closing. The second close-requested event that `win.close()` triggers re-enters the handler, sees `closingRef === true`, and returns without `preventDefault` so the OS-level close proceeds. **Required ACL permissions** (`src-tauri/capabilities/default.json`): `core:window:allow-close` and `core:window:allow-destroy` — Tauri 2's default close path ultimately calls `window.destroy`, and without these the X button throws `window.destroy not allowed` and the user can't quit.
- `beforeunload` — pure browser-mode fallback. Synchronously clears the timer and calls `saveFallbackJson(FALLBACK_STORAGE_KEY, latestDataRef.current)` directly (NOT `saveAccountingData`, because its first `await` schedules the localStorage write into a microtask the tab won't live to run). Tauri webview doesn't fire `beforeunload` on close, so the two paths don't double-write.

If you touch the persist effect, keep `latestDataRef` / `pendingSaveRef` / `inFlightSaveRef` / `storageLoadedRef` / `closingRef` / `persistedSinceLoadRef` and the `runSave()` helper that wires the invoke promise into `inFlightSaveRef` — they're the contract the close handler relies on. `runSave` is an `async` function: it assigns `inFlightSaveRef.current = promise` synchronously *before* its first `await`, so callers that do `void runSave()` and then read the ref always see the in-flight invoke. `flushSave()` is an App-scope helper (deliberately hoisted out of the close-handler effect) so the updater can call it too — `runUpdate` flushes pending edits before the installer kills the process.

The Rust side (`src-tauri/src/lib.rs`) exposes three commands:
- `load_accounting_store` — reads `~/Desktop/王源专属记账工作台的文件夹/accounting-data.json`. Auto-migrates from legacy `app_data_dir` location on first read, and best-effort `fs::remove_file`s the legacy source after a successful `atomic_write` so subsequent empty-store launches don't keep re-migrating.
- `save_accounting_store` — atomic write via unique-temp + fsync + rename (see `atomic_write` helper, which takes `&Path` so callers can pass either `&Path` or `&PathBuf` through Deref).
- `save_excel_backup` — drops a sanitized `.xlsx` into the same workspace folder, **also through `atomic_write`** so a crash mid-write can't destroy the user's previous good backup.

When you change `PersistedAccountingData` shape, update both the TS type AND the load/save migration logic — the file may contain older shapes from prior versions. The `migrateCategory` helper handles category-shape evolution.

### Auto-update (Tauri updater)

The app self-updates via `tauri-plugin-updater` + `tauri-plugin-process`. Three places cooperate: **`src/App.tsx`** drives the UX (`checkForUpdate` / `runUpdate` / `dismissUpdate`, the fixed `.v2-update-banner`, and the Backup page "关于与更新" card), **`src-tauri/src/lib.rs`** registers the plugins and bridges the proxy, **`.github/workflows/release-windows.yml`** signs and publishes the manifest.

- **Flow.** On mount a *silent* `checkForUpdate(false)` runs and only surfaces UI if an update is found. The Backup card button calls `checkForUpdate(true)` (manual — shows 检查中 / 已是最新 / error). `runUpdate()` calls `flushSave()` first, then `downloadAndInstall` (progress into the banner), then `relaunch()`. Every Tauri API is reached via dynamic `import(...)` inside try/catch so the browser build (`pnpm dev`) doesn't blow up — manual checks there fall back to "仅桌面端支持检查更新".
- **Concurrency (don't collapse the refs).** `checkInFlightRef` guards overlapping checks, `installingRef` guards the install, `manualPendingRef` upgrades an in-flight *silent* check to manual presentation if the user clicks during it. These were split out because a single `busy` flag made the button do nothing while the startup check was running. `check({ timeout: 20000 })` keeps a dead network from holding the lock forever.
- **Version lives in FOUR places — keep them in sync:** `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the `APP_VERSION` constant in `App.tsx` (runtime value comes from `getVersion()`; `APP_VERSION` is only the browser / pre-resolve fallback). Releasing = bump all four → tag `vX.Y.Z` → push the tag; CI builds, signs, and publishes.
- **The signing key is irreplaceable.** Updates are minisign-signed. The public key is in `tauri.conf.json` `plugins.updater.pubkey`; the private key + password are GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (also kept locally as gitignored `wangyuan-updater.key*`). Lose them and no future build can be signed — every installed client would need a manual reinstall against a new pubkey.
- **CI generates `latest.json` by hand — do not delete that step.** `tauri-action` refuses to emit the updater manifest when `productName` is CJK (logs `Signature not found for the updater JSON. Skipping upload...`), and GitHub strips the CJK from the asset name. The custom `Generate & upload updater latest.json` pwsh step rebuilds the manifest from the on-disk `*-setup.exe.sig` + the actual uploaded asset name and `gh release upload`s it. **Don't "fix" this by making `productName` ASCII** — that breaks the Chinese installer-name requirement. A tauri `.sig` file's content *is* the base64 signature string; drop it verbatim into the manifest's `signature`.
- **Hosting goes through GitHub-acceleration mirrors (for no-proxy mainland-China users).** GitHub is unreachable from China without a proxy, so `endpoints` lists several mirrors (`ghfast.top`, `gh-proxy.com`, `gh.llkk.cc`) ahead of direct `github.com`; the updater tries them in order, so a dead mirror falls through to the next. The installer `url` inside `latest.json` has no fallback (one string per platform), so CI wraps it with one primary mirror (`$mirror` in the workflow) — if that mirror dies, change it and re-release. Mirror availability churns; re-test live with `curl --noproxy "*" -L "<mirror>/<github-url>"` (this dev box sits inside the GFW, so `--noproxy` faithfully simulates a no-proxy user). **The repo must stay public** or the endpoints 404.
- **Proxy bridge (`apply_system_proxy_to_env` in `lib.rs`, Windows-only).** The updater's `reqwest` honors only `HTTP(S)_PROXY` env vars, *not* the Windows "system proxy" registry that browsers use — so Clash/v2rayN "system proxy" users would hit `error sending request`. On startup we read `HKCU\...\Internet Settings` (`ProxyEnable` / `ProxyServer`), normalize it (`normalize_proxy`, unit-tested), and export `HTTP(S)_PROXY` so both check and download go through the proxy. PAC (`AutoConfigURL`) is not handled. Only set when the user hasn't already exported a proxy.
- **Bootstrap caveat.** Any updater fix (proxy bridge, mirror endpoints, new pubkey…) only takes effect once a build *carrying it* is installed. The version that introduces a fix must be installed manually; auto-update only kicks in for the version after that.
- **ACL.** `capabilities/default.json` needs `updater:default` and `process:allow-restart`.

### First-run seeding

If storage is empty AND `accounting.first-run-seeded` localStorage flag is unset, the app seeds `SAMPLE_RECORDS` (30 plausible bookkeeper-of-rare-books records anchored around 2026-04). After seeding, the flag is set so subsequent empty states stay empty. The seed must actually reach disk — the load handler sets `persistedSinceLoadRef.current = true` on the seed branch so the persist effect's first tick writes instead of being skipped as a no-op (see Persistence).

### Domain model

- `Category`: `{ id, name, type: "expense"|"income", shape: square|circle|diamond|triangle|halfcircle, swatch: hex }`. `CatGlyph` renders the shape from these fields — categories are deliberately icon-less, distinguished by shape+color.
- `RecordItem`: `{ id, catId, amount, date: "YYYY-MM-DD", note? }`. Amounts always positive; sign comes from the category's type.
- `openingBalance`: editable via the receipt rail's 期初 row in the Ledger page; persisted alongside records/categories.
- `DEFAULT_CATEGORIES` are protected: `deleteCategory` refuses to remove them via the `DEFAULT_CATEGORY_IDS` Set. Custom categories use `custom-${Date.now()}` ids; Excel-imported ones use `excel-${type}-${slug}`. All id minting is **collision-checked** against existing ids — the `Date.now()`-based mints (new record in `saveRecord`, new category in `addCategory`) bump on the rare same-millisecond clash, and Excel import de-dups record ids against a running set. `addCategory` also **rejects a duplicate name+type** so an export→import round-trip (which keys categories on `type:name`) can't silently merge two same-named categories.

### Category lookups go through `getCat` / `catsById`

The App-level `useMemo` builds `catsById: Map<string, Category>` once and exposes a stable `getCat(id)` that closes over it (with a synthetic `"unknown"`/`"未分类"` fallback for stranded record ids). Pass `getCat` down — **don't write `categories.find(c => c.id === r.catId)` inline.** That pattern was an O(records × categories) hot-path bug across `LedgerPage` / `StatsPage` and was deliberately removed; reintroducing it regresses every page render.

`StatsPage` rebuilds its own `catsById` locally because it doesn't receive `getCat` as a prop — same Map, same idiom.

### Excel import/export

Three-sheet xlsx (`收支记录` / `分类` / `汇总`) via the `xlsx` library. Import overwrites everything after a `window.confirm`. Headers are language-tolerant (see `readExcelCell` candidate keys: `分类名称|分类|name`, `日期|date`, etc.) so users can hand-edit the file. Categories without a `形状`/`颜色` cell get auto-assigned from the `SHAPES` and `PALETTE` arrays.

**`xlsx` is lazy-loaded.** The module (~430 KB) is not in the initial chunk — `exportBackup` and `importFromFile` first call `await loadXLSX()` (a memoized `import("xlsx")`) before touching `XLSX.utils.*`. `parseExcelDate` takes the loaded module as a parameter rather than importing at the top. Don't reintroduce `import * as XLSX from "xlsx"` at the top of `App.tsx` — it pulls SheetJS into every cold launch even though only the Backup page needs it.

### Charts and number formatting

- `fmtAmount(n, decimals=2)` — bare number `12,345.67`, no currency prefix. Use inside receipt rows / entry rows where the `¥` is rendered separately or the column is implicitly a money column.
- `fmtMoney(n, decimals=2)` — `"¥" + fmtAmount(...)`, full `¥12,345.67` form. (Don't write `fmtMoney(x).slice(1)` to strip the prefix — call `fmtAmount` directly.)
- `fmtCompact(n)` — abbreviated `1.2M` / `45.6K` / `89` for chart labels and the donut center. Use this anywhere a number could grow large (≥1M) and squeeze its container.
- `splitMoney(n)` — for big-typography splits like `¥48,290`+`.00`, used by `CountUp`.
- `dateKey(d)` / `monthKey(d)` / `today()` — canonical YYYY-MM-DD / YYYY-MM string formatters. **Both use local-timezone `getFullYear/Month/Date` parts**, not `toISOString().slice(...)` — going back to UTC silently shifts records created in the early morning (UTC+8) onto the wrong day. `parseExcelDate` also routes through `dateKey` for the same reason. Use these helpers; don't reinline the formatting.
- `parseKey(key)` — the inverse of `dateKey`. Takes a `YYYY-MM-DD` string and returns a local `Date` (uses `new Date(y, m-1, d)` parts). Use this whenever you need a working `Date` inside a memo keyed on `todayKey` — *never* `new Date(todayKey)`, which parses as UTC midnight and disagrees with `dateKey`/`monthKey` in non-UTC timezones. The same rule applies anywhere a `YYYY-MM-DD` string is converted to a `Date` for weekday/day-of-month work — e.g. `weekdayCN(string)` routes through `parseKey`, and the StatsPage day-of-week histogram uses `parseKey(r.date).getDay()` instead of `new Date(r.date).getDay()`.
- `addDaysKey(key, delta)` — shifts a `YYYY-MM-DD` key by `delta` days (can be negative) and returns a key, all in local time (`parseKey` → `setDate` → `dateKey`, so month/year rollover and the UTC trap are handled). Use it for day-window math — the heatmap walks `heatEnd` back through `HEAT_WINDOW_DAYS` with it. Don't hand-roll `new Date(...).getTime() + i*86400000`, which drifts across DST.
- `buildMonthSeq(records, anchor)` — takes a `monthKey` string anchor (e.g. `currentMonthKey`), not a `Date`. Produces 6 month-keys ending at `max(anchor, latestRecordMonth)`, so charts include future-dated entries. Both `LedgerPage` and `StatsPage` go through this. Passing a `Date` constructed from `new Date(monthKey + "-01")` was a UTC-parsing trap in earlier versions — keep the string interface.
- **"Current month" figures must anchor to `currentMonthKey`, not `monthSeq[5]`.** The app supports **future-dated records** (you can record a date after today), and because `buildMonthSeq` ends at `max(anchor, latestRecordMonth)`, `monthSeq[5]` can be a *future* month. So the current-month net / MoM% (`LedgerPage` `curNet`/`momPct`) and the StatsPage 财务体检 header derive the month from `currentMonthKey` — using `monthSeq[5]` makes them silently jump to a future month the moment a future-dated entry exists, disagreeing with the receipt rail. The GreetingStrip rolling-week `weekNet` is likewise capped `r.date >= weekStartKey && r.date <= todayKey` so future entries don't leak into "本周净流入". The *only* legitimate `monthSeq[5]` use is the 6-month chart's range label (`monthSeq[0] → monthSeq[5]`), which describes the chart's actual window.
- `categoryBreakdown(cats, byCat, type)` — returns `{ items, total }` filtered to the given type, sorted by amount desc, with `total` clamped to `1` to keep `amount/total` divisions safe. Used by both pages' donut and bar charts.
- `BreakdownBars` component — renders the stats-bar list. Both expense and income breakdowns share it; don't reinline.
- `heatColor(intensity)` / `netColor(net)` — color-threshold lookups for the heatmap and the net-line chart dots. Don't re-implement the cascading `if`-chain inline. The heatmap *legend* renders by mapping over `HEAT_LEGEND` (derived from `HEAT_BASE` + reversed `HEAT_COLORS`), not by re-spelling the four hex codes — so tuning a threshold updates both the cells and the swatch row.
- The stats trend chart uses an asymmetric Y mapping: positive net goes up 120 logical units (into the bar area); negative net goes down 70 units (below the y=200 baseline). Don't accidentally clip negative values off the SVG when changing the chart. The `yNet(net)` helper is hoisted in `StatsPage` — keep it that way (it was previously an IIFE and got nested 3 deep).

### Memo discipline

`LedgerPage` and `StatsPage` cache derived data with `useMemo` keyed on **string keys** (`todayKey`, `currentMonthKey`) rather than the `now: Date` object. `now = new Date()` runs fresh per render, but the heavy memos only invalidate when the date string actually changes — so re-renders from filter clicks or modal toggles don't recompute monthSeq/heatDays/dailyAggregates. If you add a memo that depends on "today", depend on `todayKey`, never on `now`.

Inside those memos, reconstruct a working `Date` from the key via `parseKey(todayKey)` — not `new Date(todayKey)` or `new Date(monthKey + "-01")`. The string form is parsed as UTC midnight and disagrees with `dateKey`/`monthKey` in non-UTC timezones; `dailyAggregates` and `buildMonthSeq` go through `parseKey` (or the `monthKey` string interface), and `heatDays` walks from `heatEnd` via `addDaysKey` (also `parseKey`-based). Note `heatDays` is keyed on `heatEnd` (a navigable window-end key), *not* `todayKey` — see the Ledger-page interactions section.

### Greeting / trend copy is data-driven

`GreetingStrip`'s `note` prop is the trend message. `LedgerPage` computes it from real `stats.byMonth` values comparing the current calendar month vs prior 5 months — never hardcode strings like "本月节余创近半年新高" again.

### Ledger page: heat-window navigation, day view, entry pagination

`LedgerPage` holds three pieces of *non-persisted* view state that drive the "每日支出强度" heatmap and the "近期账目" list:

- **`heatEnd`** (a `YYYY-MM-DD` key, init `todayKey`) — the last day of the `HEAT_WINDOW_DAYS` (42) heat grid. `heatDays` walks back from `heatEnd` with `addDaysKey`, so the window is navigable: ←/→ step a whole window, 回到今天 resets to `todayKey`, and the `<input type="date">` jumps to any day *and* selects it. Every setter clamps into `[dateBounds.min, dateBounds.max]` via the shared `clampKey(key, min, max)` helper — use it instead of re-inlining the min/max ternary.
- **`dateBounds`** — `{ min, max }` over `records`, seeded with `todayKey` on both ends so the window can reach the earliest history **and future-dated entries** (records dated after today). The ←/→ buttons disable at these bounds. A `useEffect` re-clamps `heatEnd` back into range whenever `dateBounds` shrinks (e.g. you navigate to a future record, then delete it); it returns the same value when already in range, so it does **not** cause an extra render on every `records` change.
- **`selectedDay`** — clicking a heat cell (or picking a date) sets it; the entries section then switches to a single-day view (`dayList` = records on that day, header "当 日 账 目", `× 返回全部` to clear). `null` = the normal `entryFilter`-driven list.

Entries are **paginated, not capped** (the old `filtered.slice(0, 12)` is gone). `displayList` (= `dayList` when a day is selected, else the `filtered` prop) is sliced into `ENTRIES_PER_PAGE` (12) pages. **Derive every read from `safePage = min(entryPage, totalPages)`, never raw `entryPage`** — the `第 X/Y 页` label, entry numbering (`pageStart + i + 1`, continuous across pages), the disabled checks, *and the prev/next `onClick`* all use `safePage`. The buttons must call `setEntryPage(safePage ± 1)`, **not** a functional `(p) => p ± 1`: when a deletion shrinks `totalPages` below a now-stale `entryPage`, the functional form dead-clicks (it decrements a number `safePage` already masks). `entryPage` resets to 1 via a `useEffect` on `[entryFilter, selectedDay]`.

## Conventions

- Chinese UI text, with letter-spacing applied per-character via spaces (e.g. `书 业 账 房`, `保 存 记 录`). Match this when adding new copy.
- Mono-font `.mono` class for caption-style metadata (uppercase, tracked, muted color). All numerical/tabular data uses `font-variant-numeric: tabular-nums`. The full mono fallback stack (`"JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, monospace`) is centralized on the `--v2-mono` CSS variable — use `font-family: var(--v2-mono);` instead of inlining the stack so the fallback chain stays consistent. Inside SVG, prefer `style={{ fontFamily: "var(--v2-mono)" }}` on `<text>` over the `fontFamily="JetBrains Mono"` presentation attribute, because the attribute form can't resolve CSS custom properties and silently drops the fallback chain.
- Receipt cards (`.v2-receipt`, `.v2-modal-card`) use perforated edges via `radial-gradient` masks (`.v2-receipt-perf` / `.v2-modal-perf`). Keep the perf elements when adding new ledger surfaces.
- Default categories must not be deletable — the UI hides the delete button via the `DEFAULT_CATEGORY_IDS` Set lookup (don't revert to `DEFAULT_CATEGORIES.some(...)` in render code).
