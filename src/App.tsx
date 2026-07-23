import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import "./App.css";
import {
  CATEGORY_SHAPES,
  CATEGORY_SWATCHES,
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_IDS,
  type Category,
  type CategoryType,
  type CatShape,
  type LedgerEntry as RecordItem,
} from "./ledgerCommands";
import {
  addDaysKey,
  clampDateKey as clampKey,
  dateKey,
  formatAmount as fmtAmount,
  formatCompactAmount as fmtCompact,
  formatMoney as fmtMoney,
  monthKey,
  splitMoney,
  todayKey as today,
  weekdayCN,
} from "./ledgerFormat";
import {
  createLedgerQuery,
  type BreakdownItem,
  type LedgerEntryFilter as EntryFilter,
  type LedgerQuery,
  type LedgerStats as Stats,
} from "./ledgerQueries";
import {
  decodeLedgerWorkbook,
  encodeLedgerWorkbook,
} from "./ledgerWorkbook";
import { deliverLedgerWorkbookFile } from "./ledgerWorkbookFile";
import { useRuntimeLedgerSession } from "./useLedgerSession";
import { type UpdateState } from "./updateController";
import { useRuntimeUpdateController } from "./useUpdateController";

/* =================================================================
   Types & constants
================================================================= */

type PageKey = "ledger" | "stats" | "cats" | "backup";

type RecordForm = {
  type: CategoryType;
  catId: string;
  amount: string;
  date: string;
  note: string;
};

type CategoryForm = {
  name: string;
  type: CategoryType;
  shape: CatShape;
  swatch: string;
};

type BackupStatus = {
  type: "idle" | "success" | "error";
  message: string;
};

// Fallback shown before the runtime getVersion() resolves (and in browser dev mode).
// Keep in sync with package.json / tauri.conf.json / Cargo.toml on each release.
const APP_VERSION = "0.1.7";

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// 下载进度百分比标签；total 未知（≤0）时返回调用方给的占位串。
function updatePercentLabel(s: UpdateState, fallback: string): string {
  if (!s.total || s.total <= 0) return fallback;
  return `${Math.round(((s.downloaded ?? 0) / s.total) * 100)}%`;
}
const ENTRIES_PER_PAGE = 12;
const HEAT_WINDOW_DAYS = 42;

const SAMPLE_RECORDS: RecordItem[] = [
  { id: 101, catId: "sell-book", amount: 4280, date: "2026-05-01", note: "孔网订单 · 古籍三函" },
  { id: 102, catId: "fuel", amount: 312, date: "2026-04-30", note: "嘉实多 95#" },
  { id: 103, catId: "parking", amount: 24, date: "2026-04-30" },
  { id: 104, catId: "buy-book", amount: 1860, date: "2026-04-29", note: "潘家园早市" },
  { id: 105, catId: "sell-book", amount: 980, date: "2026-04-29", note: "微信成交" },
  { id: 106, catId: "entertainment", amount: 768, date: "2026-04-28", note: "晚饭 · 老主顾" },
  { id: 107, catId: "rent", amount: 6800, date: "2026-04-28", note: "工作室四月" },
  { id: 108, catId: "consult", amount: 2400, date: "2026-04-27", note: "鉴定费" },
  { id: 109, catId: "parking", amount: 18, date: "2026-04-27" },
  { id: 110, catId: "buy-book", amount: 3450, date: "2026-04-26", note: "私人藏家收书" },
  { id: 111, catId: "fuel", amount: 286, date: "2026-04-25" },
  { id: 112, catId: "sell-book", amount: 1560, date: "2026-04-24", note: "线下同行" },
  { id: 113, catId: "entertainment", amount: 432, date: "2026-04-23" },
  { id: 114, catId: "buy-book", amount: 2100, date: "2026-04-22", note: "民国版四册" },
  { id: 115, catId: "sell-book", amount: 3200, date: "2026-04-21" },
  { id: 116, catId: "parking", amount: 30, date: "2026-04-21" },
  { id: 117, catId: "consult", amount: 1200, date: "2026-04-20" },
  { id: 118, catId: "fuel", amount: 298, date: "2026-04-19" },
  { id: 119, catId: "buy-book", amount: 880, date: "2026-04-18" },
  { id: 120, catId: "sell-book", amount: 2680, date: "2026-04-17", note: "线装古籍一套" },
  { id: 121, catId: "entertainment", amount: 596, date: "2026-04-16" },
  { id: 122, catId: "parking", amount: 24, date: "2026-04-15" },
  { id: 123, catId: "buy-book", amount: 1340, date: "2026-04-14" },
  { id: 124, catId: "sell-book", amount: 5400, date: "2026-04-12", note: "整批出货" },
  { id: 125, catId: "fuel", amount: 308, date: "2026-04-10" },
  { id: 126, catId: "consult", amount: 800, date: "2026-04-08" },
  { id: 127, catId: "buy-book", amount: 2240, date: "2026-04-06" },
  { id: 128, catId: "sell-book", amount: 1980, date: "2026-04-04" },
  { id: 129, catId: "entertainment", amount: 360, date: "2026-04-02" },
  { id: 130, catId: "rent", amount: 6800, date: "2026-04-01", note: "工作室三月" },
];

/* =================================================================
   Helpers
================================================================= */

const HEAT_COLORS: Array<[number, string]> = [
  [0.5, "#7C3A0E"],
  [0.25, "#C6701D"],
  [0.05, "#E8B97A"],
];
const HEAT_BASE = "#F5E6CC";
const HEAT_LEGEND = [HEAT_BASE, ...[...HEAT_COLORS].reverse().map(([, c]) => c)];
const heatColor = (intensity: number): string => {
  for (const [threshold, color] of HEAT_COLORS) {
    if (intensity > threshold) return color;
  }
  return HEAT_BASE;
};

const netColor = (net: number): string =>
  net > 0 ? "#5C7C2C" : net < 0 ? "#7C3A0E" : "#FAF3E2";

const DOW_LABEL = ["日", "一", "二", "三", "四", "五", "六"];

function timeGreeting(d: Date) {
  const h = d.getHours();
  if (h < 5) return "凌晨好";
  if (h < 9) return "早上好";
  if (h < 12) return "上午好";
  if (h < 14) return "中午好";
  if (h < 17) return "下午好";
  if (h < 19) return "傍晚好";
  return "晚上好";
}

function createInitialForm(
  cats: Category[],
  type: CategoryType = "expense",
): RecordForm {
  // cats can be empty (e.g. an import wiped categories and they were all
  // deleted) — don't deref undefined; leave catId empty so save stays disabled.
  const cat = cats.find((c) => c.type === type) ?? cats[0];
  return {
    type: cat?.type ?? type,
    catId: cat?.id ?? "",
    amount: "",
    date: today(),
    note: "",
  };
}

// Shared by saveRecord() and the modal's save button so they can't drift.
function isRecordFormComplete(form: RecordForm): boolean {
  const amount = Number(form.amount);
  return (
    !!form.catId &&
    !!form.date &&
    !!form.amount &&
    Number.isFinite(amount) &&
    amount > 0
  );
}

/* =================================================================
   Atoms — CountUp, CatGlyph
================================================================= */

function CountUp({
  value,
  duration = 900,
  prefix = "¥",
  className = "",
}: {
  value: number;
  duration?: number;
  prefix?: string;
  className?: string;
}) {
  const [shown, setShown] = useState(0);
  const startedRef = useRef<number | null>(null);
  const startValRef = useRef(0);
  const targetRef = useRef(value);

  useEffect(() => {
    startedRef.current = null;
    startValRef.current = shown;
    targetRef.current = value;
    let raf = 0;
    const tick = (t: number) => {
      if (startedRef.current == null) startedRef.current = t;
      const p = Math.min(1, (t - startedRef.current) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v =
        startValRef.current +
        (targetRef.current - startValRef.current) * eased;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  const [intPart, decPart] = splitMoney(shown);
  return (
    <span className={className}>
      <span className="cu-prefix">{prefix}</span>
      <span className="cu-int">{intPart}</span>
      <span className="cu-dec">{decPart}</span>
    </span>
  );
}

function CatGlyph({
  shape,
  color,
  size = 14,
  className = "",
}: {
  shape: CatShape;
  color: string;
  size?: number;
  className?: string;
}) {
  const s = size;
  if (shape === "circle")
    return (
      <span
        className={className}
        style={{
          width: s,
          height: s,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
    );
  if (shape === "diamond")
    return (
      <span
        className={className}
        style={{
          width: s,
          height: s,
          background: color,
          display: "inline-block",
          transform: "rotate(45deg)",
          flexShrink: 0,
        }}
      />
    );
  if (shape === "triangle")
    return (
      <span
        className={className}
        style={{
          width: 0,
          height: 0,
          display: "inline-block",
          borderLeft: `${s / 2}px solid transparent`,
          borderRight: `${s / 2}px solid transparent`,
          borderBottom: `${s}px solid ${color}`,
          flexShrink: 0,
        }}
      />
    );
  if (shape === "halfcircle")
    return (
      <span
        className={className}
        style={{
          width: s,
          height: s / 2,
          background: color,
          display: "inline-block",
          borderRadius: `${s}px ${s}px 0 0`,
          flexShrink: 0,
        }}
      />
    );
  return (
    <span
      className={className}
      style={{
        width: s,
        height: s,
        background: color,
        display: "inline-block",
        borderRadius: 2,
        flexShrink: 0,
      }}
    />
  );
}

/* =================================================================
   App
================================================================= */

function App() {
  const ledgerSession = useRuntimeLedgerSession({
    seedRecords: SAMPLE_RECORDS,
  });
  const {
    ledger,
    saveStatus,
    dispatch: dispatchLedger,
  } = ledgerSession;
  const {
    state: updateState,
    check: checkForUpdate,
    install: runUpdate,
    dismiss: dismissUpdate,
  } = useRuntimeUpdateController({ flushLedger: ledgerSession.flush });
  const { records, categories, openingBalance } = ledger;
  const [page, setPage] = useState<PageKey>("ledger");
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<RecordForm>(() =>
    createInitialForm(DEFAULT_CATEGORIES),
  );
  const [pendingDelete, setPendingDelete] = useState<RecordItem | null>(null);
  const [entryFilter, setEntryFilter] = useState<EntryFilter>("all");
  const [backupStatus, setBackupStatus] = useState<BackupStatus>({
    type: "idle",
    message: "",
  });
  const [appVersion, setAppVersion] = useState<string>(APP_VERSION);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (saveStatus.type !== "error") return;
    setBackupStatus({
      type: "error",
      message: saveStatus.message,
    });
  }, [saveStatus]);

  /* ---- on mount: resolve real app version ---- */
  useEffect(() => {
    void (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        setAppVersion(await getVersion());
      } catch {
        /* 浏览器模式：保留 APP_VERSION 常量 */
      }
    })();
  }, []);

  /* ---- derived ---- */
  const query = useMemo(() => createLedgerQuery(ledger), [ledger]);
  const getCat = query.category;
  const currentMonthKey = monthKey(new Date());

  const filteredEntries = useMemo(
    () => query.entries(entryFilter, currentMonthKey),
    [query, entryFilter, currentMonthKey],
  );

  /* ---- actions ---- */
  function openAddModal(type: CategoryType = "expense") {
    setForm(createInitialForm(categories, type));
    setEditId(null);
    setModalOpen(true);
  }

  function openEditModal(record: RecordItem) {
    const cat = getCat(record.catId);
    setForm({
      type: cat.type,
      catId: record.catId,
      amount: String(record.amount),
      date: record.date,
      note: record.note ?? "",
    });
    setEditId(record.id);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditId(null);
  }

  function saveRecord() {
    if (!isRecordFormComplete(form)) return;
    const entry = {
      catId: form.catId,
      amount: Number(form.amount),
      date: form.date,
      note: form.note,
    };
    const result =
      editId !== null
        ? dispatchLedger({ type: "entry.update", id: editId, entry })
        : dispatchLedger({
            type: "entry.create",
            preferredId: Date.now(),
            entry,
          });
    if (result.ok) closeModal();
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const result = dispatchLedger({
      type: "entry.delete",
      id: pendingDelete.id,
    });
    if (result.ok) setPendingDelete(null);
  }

  function addCategory(c: Omit<Category, "id">): void {
    dispatchLedger({
      type: "category.create",
      preferredId: Date.now(),
      category: c,
    });
  }

  function deleteCategory(id: string) {
    if (DEFAULT_CATEGORY_IDS.has(id)) return;
    const impact = query.categoryDeletionImpact(id);
    if (!impact) return;
    const warning =
      impact.affectedEntries > 0
        ? `删除分类「${impact.categoryName}」会同时永久删除 ${impact.affectedEntries} 条关联账目。此操作无法撤销，确认继续吗？`
        : `确认删除分类「${impact.categoryName}」吗？`;
    if (!window.confirm(warning)) return;
    dispatchLedger({ type: "category.delete", id });
  }

  /* ---- backup ---- */
  async function exportBackup() {
    const filename = `wangyuan-${today()}.xlsx`;
    const bytes = await encodeLedgerWorkbook({
      records,
      categories,
      openingBalance,
    });
    const destination = await deliverLedgerWorkbookFile(filename, bytes);
    setBackupStatus({
      type: "success",
      message: `已导出 ${records.length} 条记录到 ${destination}`,
    });
  }

  function openImportPicker() {
    importInputRef.current?.click();
  }

  async function importFromFile(file: File) {
    try {
      const data = await file.arrayBuffer();
      const decoded = await decodeLedgerWorkbook(data);
      if (!decoded.ok) {
        setBackupStatus({
          type: "error",
          message: decoded.error.message,
        });
        return;
      }

      const { candidate, diagnostics } = decoded;
      const ok = window.confirm(
        `导入会覆盖当前 ${records.length} 条记录、${categories.length} 个分类。确认导入 ${diagnostics.importedRecords} 条记录、${diagnostics.importedCategories} 个分类？`,
      );
      if (!ok) {
        setBackupStatus({ type: "idle", message: "" });
        return;
      }
      const result = dispatchLedger({
        type: "import.replace",
        records: candidate.records,
        categories: candidate.categories,
      });
      if (!result.ok) {
        setBackupStatus({
          type: "error",
          message: `导入失败：${result.error.message}`,
        });
        return;
      }
      setBackupStatus({
        type: "success",
        message: `已导入 ${diagnostics.importedRecords} 条记录、${diagnostics.importedCategories} 个分类${
          diagnostics.skippedRecordRows > 0
            ? ` · 跳过 ${diagnostics.skippedRecordRows} 行`
            : ""
        }`,
      });
    } catch {
      setBackupStatus({
        type: "error",
        message: "导入失败：无法读取 Excel 文件",
      });
    }
  }

  async function importBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await importFromFile(file);
  }

  /* =================================================================
     Render
  ================================================================= */
  return (
    <div className="v2-root">
      <TopBar
        page={page}
        onPage={setPage}
        onAdd={() => openAddModal("expense")}
      />

      {backupStatus.type === "error" && page !== "backup" && (
        <div
          role="alert"
          className="v2-save-toast"
          onClick={() => setBackupStatus({ type: "idle", message: "" })}
        >
          <span className="v2-save-toast-stamp">!</span>
          <span className="v2-save-toast-msg">{backupStatus.message}</span>
          <span className="mono v2-save-toast-hint">点击关闭</span>
        </div>
      )}

      {page !== "backup" &&
        (updateState.phase === "available" ||
          updateState.phase === "downloading" ||
          updateState.phase === "error") && (
        <div className="v2-update-banner" role="status">
          <div className="v2-update-perf" aria-hidden="true" />
          {updateState.phase === "available" && (
            <>
              <div className="v2-update-body">
                <div className="mono v2-update-tag">UPDATE · 新 版 本</div>
                <div className="v2-update-title">
                  发 现 新 版 本 v{updateState.version}
                </div>
                {updateState.notes && (
                  <div className="v2-update-notes">{updateState.notes}</div>
                )}
              </div>
              <div className="v2-update-actions">
                <button
                  type="button"
                  className="v2-btn-primary v2-update-btn"
                  onClick={() => void runUpdate()}
                >
                  立 即 更 新
                </button>
                <button
                  type="button"
                  className="v2-update-btn-ghost"
                  onClick={dismissUpdate}
                >
                  稍 后
                </button>
              </div>
            </>
          )}
          {updateState.phase === "downloading" && (
            <div className="v2-update-body">
              <div className="mono v2-update-tag">DOWNLOADING · 下 载 中</div>
              <div className="v2-update-title">
                正 在 下 载 v{updateState.version}
              </div>
              <div className="v2-update-bar">
                <div
                  className="v2-update-bar-fill"
                  style={{ width: updatePercentLabel(updateState, "100%") }}
                />
              </div>
              <div className="mono v2-update-progress">
                {updateState.total && updateState.total > 0
                  ? `${fmtBytes(updateState.downloaded ?? 0)} / ${fmtBytes(
                      updateState.total,
                    )}`
                  : "准 备 安 装…"}
              </div>
            </div>
          )}
          {updateState.phase === "error" && (
            <>
              <div className="v2-update-body">
                <div className="mono v2-update-tag">ERROR · 更 新 出 错</div>
                <div className="v2-update-title">更 新 失 败</div>
                <div className="v2-update-notes">{updateState.error}</div>
              </div>
              <div className="v2-update-actions">
                <button
                  type="button"
                  className="v2-btn-primary v2-update-btn"
                  onClick={() =>
                    void (updateState.version
                      ? runUpdate()
                      : checkForUpdate(true))
                  }
                >
                  重 试
                </button>
                <button
                  type="button"
                  className="v2-update-btn-ghost"
                  onClick={dismissUpdate}
                >
                  关 闭
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {page === "ledger" && (
        <LedgerPage
          query={query}
          filtered={filteredEntries}
          entryFilter={entryFilter}
          setEntryFilter={setEntryFilter}
          onEdit={openEditModal}
          onDelete={(r) => setPendingDelete(r)}
          onOpeningBalance={(value) =>
            dispatchLedger({ type: "opening-balance.set", value })
          }
        />
      )}

      {page === "stats" && (
        <StatsPage query={query} />
      )}

      {page === "cats" && (
        <CategoriesPage
          query={query}
          onAdd={addCategory}
          onDelete={deleteCategory}
        />
      )}

      {page === "backup" && (
        <BackupPage
          records={records}
          categories={categories}
          status={backupStatus}
          onExport={exportBackup}
          onImport={openImportPicker}
          onImportFile={importFromFile}
          appVersion={appVersion}
          updateState={updateState}
          onCheckUpdate={() => void checkForUpdate(true)}
          onRunUpdate={() => void runUpdate()}
        />
      )}

      <input
        ref={importInputRef}
        className="v2-file-input-hidden"
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        onChange={importBackup}
      />

      {modalOpen && (
        <NewRecordModal
          form={form}
          setForm={setForm}
          categories={categories}
          isEdit={editId !== null}
          onClose={closeModal}
          onSave={saveRecord}
        />
      )}

      {pendingDelete && (
        <DeleteConfirmModal
          record={pendingDelete}
          category={getCat(pendingDelete.catId)}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

/* =================================================================
   TopBar
================================================================= */
function TopBar({
  page,
  onPage,
  onAdd,
}: {
  page: PageKey;
  onPage: (p: PageKey) => void;
  onAdd: () => void;
}) {
  return (
    <header className="v2-top">
      <div className="v2-brand">
        <div className="v2-brand-logo">
          <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
            <rect
              x="3"
              y="3"
              width="26"
              height="26"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <rect x="9" y="9" width="14" height="14" fill="currentColor" />
          </svg>
        </div>
        <div>
          <div className="v2-brand-name">书 业 账 房</div>
          <div className="v2-brand-sub mono">CHRONICLE BOOKS · LEDGER 2026</div>
        </div>
      </div>
      <nav className="v2-nav" aria-label="主导航">
        {(
          [
            ["ledger", "账目"],
            ["stats", "统计"],
            ["cats", "分类"],
            ["backup", "备份"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            className={page === k ? "active" : ""}
            onClick={() => onPage(k)}
            type="button"
          >
            {l}
          </button>
        ))}
      </nav>
      <div className="v2-top-actions">
        <button className="v2-btn-ghost mono" type="button" aria-label="快捷搜索">
          ⌘ K
        </button>
        <button className="v2-btn-primary" type="button" onClick={onAdd}>
          + 记一笔
        </button>
      </div>
    </header>
  );
}

/* =================================================================
   Greeting
================================================================= */
function GreetingStrip({
  date,
  todayExpense,
  weekNet,
  recordedToday,
  note,
}: {
  date: Date;
  todayExpense: number;
  weekNet: number;
  recordedToday: number;
  note: string;
}) {
  const dateText = date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const lastDayOfMonth = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
  ).getDate();
  const daysToMonthEnd = Math.max(0, lastDayOfMonth - date.getDate());
  return (
    <div className="v2-greet">
      <div className="v2-greet-l">
        <div className="v2-greet-time mono">
          {dateText} · 周{weekdayCN(date)}
        </div>
        <div className="v2-greet-hi">
          {timeGreeting(date).split("").join(" ")}，
          <span className="v2-greet-name">王 源</span>
        </div>
        <div className="v2-greet-sub">
          今日已记 {recordedToday} 笔 · 距月末 {daysToMonthEnd} 日 · {note}
        </div>
      </div>
      <div className="v2-greet-r">
        <div className="v2-greet-stat">
          <div className="mono">今日支出</div>
          <div className="v2-greet-num">{fmtMoney(todayExpense)}</div>
        </div>
        <div className="v2-greet-stat">
          <div className="mono">本周净流入</div>
          <div className={`v2-greet-num ${weekNet >= 0 ? "positive" : ""}`}>
            {weekNet >= 0 ? "+" : "−"}
            {fmtMoney(Math.abs(weekNet), 0)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =================================================================
   Opening balance row (editable)
================================================================= */
function OpeningBalanceRow({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  function commit() {
    const cleaned = draft.replace(/[^\d.-]/g, "");
    const n = Number(cleaned);
    // 空串经 Number("") 会变成 0，会把真实期初余额静默清零 —— 空输入视为「不修改」。
    if (cleaned !== "" && Number.isFinite(n)) onChange(n);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="v2-rec-row">
        <span className="mono">期 初</span>
        <input
          autoFocus
          className="v2-rec-edit mono"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(String(value));
              setEditing(false);
            }
          }}
          inputMode="decimal"
        />
      </div>
    );
  }
  return (
    <div
      className="v2-rec-row v2-rec-editable"
      onClick={() => {
        setDraft(String(value));
        setEditing(true);
      }}
      role="button"
      tabIndex={0}
      title="点击编辑期初余额"
    >
      <span className="mono">期 初</span>
      <span className="v2-rec-num mono">{fmtAmount(value)}</span>
    </div>
  );
}

/* =================================================================
   Ledger (main) page
================================================================= */
function LedgerPage({
  query,
  filtered,
  entryFilter,
  setEntryFilter,
  onEdit,
  onDelete,
  onOpeningBalance,
}: {
  query: LedgerQuery;
  filtered: RecordItem[];
  entryFilter: EntryFilter;
  setEntryFilter: (f: EntryFilter) => void;
  onEdit: (r: RecordItem) => void;
  onDelete: (r: RecordItem) => void;
  onOpeningBalance: (n: number) => void;
}) {
  const { openingBalance } = query.ledger;
  const { stats } = query;
  const getCat = query.category;
  const now = new Date();
  const todayKey = dateKey(now);

  // Heatmap window end (last visible day), clicked day, and entries page.
  const [heatEnd, setHeatEnd] = useState(todayKey);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [entryPage, setEntryPage] = useState(1);

  // Navigation bounds — let future-dated records (and earliest history) be reachable.
  const dateBounds = useMemo(
    () => query.dateBounds(todayKey),
    [query, todayKey],
  );

  // Reset to first page whenever the visible set changes.
  useEffect(() => {
    setEntryPage(1);
  }, [entryFilter, selectedDay]);

  // Keep the heat window inside the available data range when records shrink
  // (e.g. deleting the future-dated day you had navigated to). No-op when in
  // range, so it doesn't cause an extra render on every records change.
  useEffect(() => {
    setHeatEnd((end) => clampKey(end, dateBounds.min, dateBounds.max));
  }, [dateBounds]);

  const overview = useMemo(
    () => query.ledgerOverview(todayKey),
    [query, todayKey],
  );
  const dailyAggregates = {
    todayExpense: overview.today.expense,
    weekNet: overview.weekNet,
    recordedToday: overview.today.entryCount,
    incomeCount: overview.entryCounts.income,
    expenseCount: overview.entryCounts.expense,
  };
  const monthSeq = overview.monthSeries.map((month) => month.key);
  const maxMonthVal = overview.maxMonthValue;
  const curNet = overview.currentMonth.net;
  const momPct = overview.monthOverMonthPercent;
  const trendNote = overview.trendNote;

  const expenseBreakdown = useMemo(
    () => query.breakdown("expense"),
    [query],
  );
  const expenseCats = expenseBreakdown.items;
  const totalExp = expenseBreakdown.total;

  const heatDays = useMemo(
    () => query.heatmap(heatEnd, HEAT_WINDOW_DAYS),
    [query, heatEnd],
  );

  // Derived entries list: single-day view when a heat cell is selected, else the
  // filter-driven list. Paginated for both. `filtered` is already date+id sorted.
  const dayList = useMemo(
    () => (selectedDay ? query.entriesOnDay(selectedDay) : null),
    [query, selectedDay],
  );
  const displayList = selectedDay ? (dayList as RecordItem[]) : filtered;
  const totalPages = Math.max(
    1,
    Math.ceil(displayList.length / ENTRIES_PER_PAGE),
  );
  const safePage = Math.min(entryPage, totalPages);
  const pageStart = (safePage - 1) * ENTRIES_PER_PAGE;
  const pageItems = displayList.slice(pageStart, pageStart + ENTRIES_PER_PAGE);

  const heatNextDisabled = heatEnd >= dateBounds.max;
  const heatPrevDisabled = heatEnd <= dateBounds.min;
  const goHeatPrev = () =>
    setHeatEnd((end) =>
      clampKey(addDaysKey(end, -HEAT_WINDOW_DAYS), dateBounds.min, dateBounds.max),
    );
  const goHeatNext = () =>
    setHeatEnd((end) =>
      clampKey(addDaysKey(end, HEAT_WINDOW_DAYS), dateBounds.min, dateBounds.max),
    );

  const monthData = overview.currentMonth;
  const stampDate = dateKey(now).replace(/-/g, " / ");
  const stampTime = now.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <>
      <GreetingStrip
        date={now}
        todayExpense={dailyAggregates.todayExpense}
        weekNet={dailyAggregates.weekNet}
        recordedToday={dailyAggregates.recordedToday}
        note={trendNote}
      />

      <div className="v2-body">
        {/* Receipt rail */}
        <aside className="v2-receipt">
          <div className="v2-receipt-perf top" />
          <div className="v2-receipt-head">
            <div className="mono v2-rec-no">N° {todayKey}</div>
            <div className="v2-rec-title">月 度 凭 单</div>
            <div className="mono v2-rec-sub">MONTHLY SUMMARY</div>
          </div>
          <div className="v2-receipt-rows">
            <OpeningBalanceRow
              value={openingBalance}
              onChange={onOpeningBalance}
            />
            <div className="v2-rec-row income">
              <span className="mono">+ 收入</span>
              <span className="v2-rec-num mono">
                {fmtAmount(monthData.income)}
              </span>
            </div>
            <div className="v2-rec-row expense">
              <span className="mono">− 支出</span>
              <span className="v2-rec-num mono">
                {fmtAmount(monthData.expense)}
              </span>
            </div>
            <div className="v2-rec-rule" />
            <div className="v2-rec-row total">
              <span>结  余</span>
              <span className="v2-rec-num mono">
                {fmtAmount(monthData.balanceWithOpening)}
              </span>
            </div>
          </div>
          <div className="v2-receipt-stamp">
            <div className="v2-stamp">
              <div className="v2-stamp-inner">
                <div>已</div>
                <div>核</div>
                <div>对</div>
              </div>
            </div>
            <div className="v2-stamp-meta mono">
              <div>{stampDate}</div>
              <div>{stampTime}</div>
              <div>WY-001</div>
            </div>
          </div>
          <div className="v2-receipt-perf bottom" />
        </aside>

        {/* Main */}
        <main className="v2-main">
          {/* Hero stats */}
          <section className="v2-stats">
            <article className="v2-stat-card big">
              <div className="v2-stat-label mono">本月结余 · NET BALANCE</div>
              <div className="v2-stat-value">
                <CountUp value={curNet} className="v2-bignum" />
              </div>
              <div className="v2-stat-trend">
                {momPct === null ? (
                  <span className="mono">无 上 月 数 据</span>
                ) : (
                  <>
                    <span
                      className={`v2-trend-pill ${momPct < 0 ? "down" : ""}`}
                    >
                      {momPct >= 0 ? "▲" : "▼"} {Math.abs(momPct).toFixed(1)}%
                    </span>
                    <span className="mono">较 上 月</span>
                  </>
                )}
              </div>
            </article>
            <article className="v2-stat-card">
              <div className="v2-stat-label mono">收入 · INCOME</div>
              <CountUp value={stats.income} className="v2-midnum income-c" />
              <div className="v2-stat-foot mono">
                {dailyAggregates.incomeCount} 笔
              </div>
            </article>
            <article className="v2-stat-card">
              <div className="v2-stat-label mono">支出 · EXPENSE</div>
              <CountUp value={stats.expense} className="v2-midnum expense-c" />
              <div className="v2-stat-foot mono">
                {dailyAggregates.expenseCount} 笔
              </div>
            </article>
          </section>

          {/* Bars + donut */}
          <section className="v2-charts">
            <div className="v2-chart-card">
              <div className="v2-card-head">
                <div>
                  <h3>收 支 走 势</h3>
                  <div className="mono">
                    {monthSeq[0]} ~ {monthSeq[monthSeq.length - 1]} · 6 MO
                  </div>
                </div>
                <div className="v2-legend">
                  <span>
                    <span className="dot income" /> 收入
                  </span>
                  <span>
                    <span className="dot expense" /> 支出
                  </span>
                </div>
              </div>
              <div className="v2-bar-chart">
                {overview.monthSeries.map((v) => {
                  const m = v.key;
                  return (
                    <div key={m} className="v2-bar-group">
                      <div className="v2-bars">
                        <div
                          className="v2-bar income"
                          style={{
                            height: `${(v.income / maxMonthVal) * 100}%`,
                          }}
                        >
                          {v.income > 0 && (
                            <span className="v2-bar-tip mono">
                              {fmtCompact(v.income)}
                            </span>
                          )}
                        </div>
                        <div
                          className="v2-bar expense"
                          style={{
                            height: `${(v.expense / maxMonthVal) * 100}%`,
                          }}
                        >
                          {v.expense > 0 && (
                            <span className="v2-bar-tip mono">
                              {fmtCompact(v.expense)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="v2-bar-label mono">{m.slice(5)}月</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="v2-chart-card">
              <div className="v2-card-head">
                <div>
                  <h3>支 出 构 成</h3>
                  <div className="mono">EXPENSE BREAKDOWN</div>
                </div>
              </div>
              <div className="v2-donut-wrap">
                <svg viewBox="0 0 120 120" className="v2-donut">
                  <circle
                    cx="60"
                    cy="60"
                    r="44"
                    fill="none"
                    stroke="#EFE4D2"
                    strokeWidth="14"
                  />
                  {(() => {
                    let off = 0;
                    return expenseCats.map((c) => {
                      const frac = c.amount / totalExp;
                      const len = frac * 276.46;
                      const arr = `${Math.max(0, len - 2)} ${276.46 - len + 2}`;
                      const dashOff = -off;
                      off += len;
                      return (
                        <circle
                          key={c.id}
                          cx="60"
                          cy="60"
                          r="44"
                          fill="none"
                          stroke={c.swatch}
                          strokeWidth="14"
                          strokeDasharray={arr}
                          strokeDashoffset={dashOff}
                          transform="rotate(-90 60 60)"
                        />
                      );
                    });
                  })()}
                </svg>
                <div className="v2-donut-center">
                  <div className="mono v2-tag">TOTAL</div>
                  <div
                    className="v2-donut-num mono"
                    data-len={fmtCompact(totalExp).length}
                  >
                    {fmtCompact(totalExp)}
                  </div>
                </div>
              </div>
              <div className="v2-donut-legend">
                {expenseCats.slice(0, 5).map((c) => (
                  <div key={c.id} className="v2-leg-row">
                    <CatGlyph shape={c.shape} color={c.swatch} size={10} />
                    <span className="v2-leg-name">{c.name}</span>
                    <span className="v2-leg-pct">
                      {((c.amount / totalExp) * 100).toFixed(0)}%
                    </span>
                    <span className="v2-leg-amt">
                      {fmtMoney(c.amount, 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Heatmap */}
          <section className="v2-heat-card">
            <div className="v2-card-head">
              <div>
                <h3>每 日 支 出 强 度</h3>
                <div className="mono">
                  {heatDays.days[0].date} – {heatDays.days[HEAT_WINDOW_DAYS - 1].date} · 点 击 查 看 当 日
                </div>
              </div>
              <div className="v2-heat-scale mono">
                少
                {HEAT_LEGEND.map((c) => (
                  <span
                    key={c}
                    className="v2-heat-cell"
                    style={{ background: c }}
                  />
                ))}
                多
              </div>
            </div>
            <div className="v2-heat-nav">
              <button
                type="button"
                onClick={goHeatPrev}
                disabled={heatPrevDisabled}
                aria-label="上一段"
              >
                ←
              </button>
              <button
                type="button"
                onClick={goHeatNext}
                disabled={heatNextDisabled}
                aria-label="下一段"
              >
                →
              </button>
              <button
                type="button"
                onClick={() => setHeatEnd(todayKey)}
                disabled={heatEnd === todayKey}
              >
                回到今天
              </button>
              <input
                type="date"
                className="v2-heat-date mono"
                value={heatEnd}
                min={dateBounds.min}
                max={dateBounds.max}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  setHeatEnd(clampKey(v, dateBounds.min, dateBounds.max));
                  setSelectedDay(v);
                }}
              />
            </div>
            <div className="v2-heat-grid">
              {heatDays.days.map((d) => {
                const intensity = d.value / heatDays.max;
                const bg = heatColor(intensity);
                const isSel = d.date === selectedDay;
                return (
                  <div
                    key={d.date}
                    className={`v2-heat-cell-big${isSel ? " selected" : ""}`}
                    style={{ background: bg } as CSSProperties}
                    title={`${d.date} · ${fmtMoney(d.value, 0)}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedDay(d.date)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedDay(d.date);
                      }
                    }}
                  >
                    <span className="mono">{d.date.slice(8)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Entries */}
          <section className="v2-entries">
            <div className="v2-card-head">
              <div>
                <h3>{selectedDay ? "当 日 账 目" : "近 期 账 目"}</h3>
                <div className="mono">
                  {selectedDay
                    ? `${selectedDay} · 周${weekdayCN(selectedDay)} · ${displayList.length} 笔`
                    : `RECENT ENTRIES · ${displayList.length}`}
                </div>
              </div>
              {selectedDay ? (
                <div className="v2-filters">
                  <button type="button" onClick={() => setSelectedDay(null)}>
                    × 返回全部
                  </button>
                </div>
              ) : (
                <div className="v2-filters">
                  {(
                    [
                      ["all", "全部"],
                      ["expense", "支出"],
                      ["income", "收入"],
                      ["month", "本月"],
                    ] as const
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      className={entryFilter === k ? "active" : ""}
                      onClick={() => setEntryFilter(k)}
                      type="button"
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="v2-entries-list">
              {displayList.length === 0 && (
                <div className="v2-empty">
                  {selectedDay ? "这一天没有记录" : "暂无记录"}
                </div>
              )}
              {pageItems.map((r, i) => {
                const cat = getCat(r.catId);
                const isIn = cat.type === "income";
                return (
                  <div key={r.id} className="v2-entry">
                    <div className="v2-entry-no mono">
                      {String(pageStart + i + 1).padStart(3, "0")}
                    </div>
                    <div className="v2-entry-date">
                      <div className="d">{r.date.slice(8)}</div>
                      <div className="m">{r.date.slice(5, 7)}月</div>
                    </div>
                    <div className="v2-entry-cat">
                      <CatGlyph
                        shape={cat.shape}
                        color={cat.swatch}
                        size={14}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div className="v2-entry-name">{cat.name}</div>
                        <div className="v2-entry-note">{r.note || "—"}</div>
                      </div>
                    </div>
                    <div className="v2-entry-tag">
                      {isIn ? "INCOME" : "EXPENSE"}
                    </div>
                    <div
                      className={`v2-entry-amt ${
                        isIn ? "income-c" : "expense-c"
                      }`}
                    >
                      {isIn ? "+" : "−"}
                      {fmtAmount(r.amount)}
                    </div>
                    <div className="v2-entry-actions">
                      <button onClick={() => onEdit(r)} type="button">
                        编辑
                      </button>
                      <button
                        className="danger"
                        onClick={() => onDelete(r)}
                        type="button"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {totalPages > 1 && (
              <div className="v2-pager">
                <button
                  type="button"
                  onClick={() => setEntryPage(Math.max(1, safePage - 1))}
                  disabled={safePage <= 1}
                >
                  上一页
                </button>
                <span className="mono v2-pager-info">
                  第 {safePage} / {totalPages} 页 · 共 {displayList.length} 笔
                </span>
                <button
                  type="button"
                  onClick={() => setEntryPage(Math.min(totalPages, safePage + 1))}
                  disabled={safePage >= totalPages}
                >
                  下一页
                </button>
              </div>
            )}
          </section>
        </main>
      </div>
    </>
  );
}

/* =================================================================
   Stats page
================================================================= */
function BreakdownBars({
  items,
  total,
  emptyText,
}: {
  items: BreakdownItem[];
  total: number;
  emptyText: string;
}) {
  if (items.length === 0) {
    return <div className="v2-empty">{emptyText}</div>;
  }
  return (
    <>
      {items.map((c) => {
        const pct = (c.amount / total) * 100;
        return (
          <div key={c.id} className="v2-stats-bar">
            <div className="v2-stats-bar-head">
              <span>
                <CatGlyph shape={c.shape} color={c.swatch} size={10} />
                {c.name}
              </span>
              <span className="mono">{fmtMoney(c.amount, 0)}</span>
            </div>
            <div className="v2-stats-bar-track">
              <div
                className="v2-stats-bar-fill"
                style={{ width: `${pct}%`, background: c.swatch }}
              />
              <span className="mono v2-stats-pct">{pct.toFixed(1)}%</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

function StatsPage({ query }: { query: LedgerQuery }) {
  const todayKey = dateKey(new Date());
  const report = useMemo(
    () => query.statistics(todayKey),
    [query, todayKey],
  );
  const expenseBreakdown = report.breakdowns.expense;
  const incomeBreakdown = report.breakdowns.income;
  const expenseCats = expenseBreakdown.items;
  const incomeCats = incomeBreakdown.items;
  const totalExp = expenseBreakdown.total;
  const totalInc = incomeBreakdown.total;

  const currentMonthKey = todayKey.slice(0, 7);
  const monthSeries = report.monthSeries.map((month) => ({
    m: month.key,
    income: month.income,
    expense: month.expense,
  }));
  const monthSeq = report.monthSeries.map((month) => month.key);
  const maxM = report.maxMonthValue;
  const maxNet = report.maxNet;

  const yNet = (net: number) =>
    net >= 0 ? 200 - (net / maxNet) * 120 : 200 + (-net / maxNet) * 70;

  const incomeStats = {
    max: report.income.maxEntry,
    mean: report.income.mean,
  };
  const dow = report.expenseByWeekday.values;
  const maxDow = report.expenseByWeekday.max;
  const peakDow = report.expenseByWeekday.peakIndex;
  const savingRate = report.savingRate;
  const ratio = report.incomeExpenseRatio;

  return (
    <>
      <div className="v2-greet" style={{ paddingBottom: 20 }}>
        <div className="v2-greet-l">
          <div className="v2-greet-time mono">STATS · 统 计 报 告</div>
          <div className="v2-greet-hi" style={{ fontSize: 36 }}>
            财 务 体 检 ·
            <span className="v2-greet-name"> {currentMonthKey.slice(5)} 月</span>
          </div>
          <div className="v2-greet-sub">六个月趋势 · 分类构成 · 周内分布</div>
        </div>
        <div className="v2-greet-r">
          <div className="v2-greet-stat">
            <div className="mono">储蓄率</div>
            <div className="v2-greet-num positive">
              {Math.round(savingRate)}%
            </div>
          </div>
          <div className="v2-greet-stat">
            <div className="mono">收支比</div>
            <div className="v2-greet-num">{ratio.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <div className="v2-body single">
        <main className="v2-main">
          {/* Trend chart */}
          <section className="v2-chart-card">
            <div className="v2-card-head">
              <div>
                <h3>六 个 月 收 支 走 势</h3>
                <div className="mono">
                  {monthSeq[0]} → {monthSeq[5]} · MoM
                </div>
              </div>
              <div className="v2-legend">
                <span>
                  <span className="dot income" /> 收入
                </span>
                <span>
                  <span className="dot expense" /> 支出
                </span>
                <span style={{ marginLeft: 12, color: "var(--v2-terra-deep)" }}>
                  ━ 净结余 · 上正下负
                </span>
              </div>
            </div>
            <div className="v2-stats-trend">
              <svg
                viewBox="0 0 800 290"
                preserveAspectRatio="none"
                style={{ width: "100%", height: 290 }}
              >
                {/* Above-baseline grid (bar area) */}
                {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
                  <line
                    key={i}
                    x1="40"
                    x2="800"
                    y1={20 + p * 180}
                    y2={20 + p * 180}
                    stroke="#C9B690"
                    strokeDasharray="3 4"
                    strokeWidth="0.5"
                  />
                ))}
                {/* Zero baseline */}
                <line
                  x1="40"
                  x2="800"
                  y1="200"
                  y2="200"
                  stroke="#7C3A0E"
                  strokeWidth="1"
                  opacity="0.35"
                />
                {/* Below-baseline grid (negative net area) */}
                <line
                  x1="40"
                  x2="800"
                  y1="245"
                  y2="245"
                  stroke="#C9B690"
                  strokeDasharray="3 4"
                  strokeWidth="0.5"
                />
                {monthSeries.map((s, i) => {
                  const x = 80 + i * 130;
                  const incH = (s.income / maxM) * 180;
                  const expH = (s.expense / maxM) * 180;
                  const incRatio = s.income / maxM;
                  const expRatio = s.expense / maxM;
                  return (
                    <g key={s.m}>
                      <rect
                        x={x - 22}
                        y={200 - incH}
                        width="20"
                        height={incH}
                        fill="#5C7C2C"
                      />
                      <rect
                        x={x + 2}
                        y={200 - expH}
                        width="20"
                        height={expH}
                        fill="#B5532A"
                      />
                      {incRatio > 0.04 && (
                        <text
                          x={x - 12}
                          y={200 - incH - 6}
                          fontSize="10"
                          fill="#5C7C2C"
                          textAnchor="middle"
                          style={{ fontFamily: "var(--v2-mono)" }}
                        >
                          {fmtCompact(s.income)}
                        </text>
                      )}
                      {expRatio > 0.04 && (
                        <text
                          x={x + 12}
                          y={200 - expH - 6}
                          fontSize="10"
                          fill="#B5532A"
                          textAnchor="middle"
                          style={{ fontFamily: "var(--v2-mono)" }}
                        >
                          {fmtCompact(s.expense)}
                        </text>
                      )}
                    </g>
                  );
                })}
                {/* Net line — signed: positive goes up, negative goes down */}
                <path
                  d={monthSeries
                    .map((s, i) => {
                      const x = 80 + i * 130;
                      const y = yNet(s.income - s.expense);
                      return `${i === 0 ? "M" : "L"}${x},${y}`;
                    })
                    .join(" ")}
                  fill="none"
                  stroke="#7C3A0E"
                  strokeWidth="2"
                />
                {monthSeries.map((s, i) => {
                  const x = 80 + i * 130;
                  const net = s.income - s.expense;
                  const y = yNet(net);
                  return (
                    <circle
                      key={i}
                      cx={x}
                      cy={y}
                      r="4"
                      fill={netColor(net)}
                      stroke="#7C3A0E"
                      strokeWidth="2"
                    >
                      <title>
                        {s.m} 净结余 {net >= 0 ? "+" : "−"}
                        {fmtCompact(Math.abs(net))}
                      </title>
                    </circle>
                  );
                })}
                {/* Month labels — at the bottom, below negative-net area */}
                {monthSeries.map((s, i) => {
                  const x = 80 + i * 130;
                  return (
                    <text
                      key={s.m}
                      x={x}
                      y="282"
                      fontSize="11"
                      fill="#5C4A33"
                      textAnchor="middle"
                      style={{ fontFamily: "var(--v2-mono)" }}
                    >
                      {s.m.slice(5)}月
                    </text>
                  );
                })}
              </svg>
            </div>
          </section>

          {/* Two columns */}
          <section className="v2-charts even">
            <div className="v2-chart-card">
              <div className="v2-card-head">
                <div>
                  <h3>支 出 构 成</h3>
                  <div className="mono">
                    EXPENSE · {expenseCats.length} 类
                  </div>
                </div>
              </div>
              <div className="v2-stats-bars">
                <BreakdownBars
                  items={expenseCats}
                  total={totalExp}
                  emptyText="暂无支出数据"
                />
              </div>
            </div>

            <div className="v2-chart-card">
              <div className="v2-card-head">
                <div>
                  <h3>收 入 构 成</h3>
                  <div className="mono">INCOME · {incomeCats.length} 类</div>
                </div>
              </div>
              <div className="v2-stats-bars">
                <BreakdownBars
                  items={incomeCats}
                  total={totalInc}
                  emptyText="暂无收入数据"
                />
              </div>
              {incomeCats.length > 0 && (
                <div className="v2-stats-side">
                  <div className="v2-stats-side-row">
                    <span className="mono">最大单笔收入</span>
                    <span>
                      {incomeStats.max
                        ? `${query.category(incomeStats.max.catId).name} · ${fmtMoney(incomeStats.max.amount, 0)}`
                        : "—"}
                    </span>
                  </div>
                  <div className="v2-stats-side-row">
                    <span className="mono">平均单笔收入</span>
                    <span>{fmtMoney(incomeStats.mean, 0)}</span>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Day of week */}
          <section className="v2-chart-card">
            <div className="v2-card-head">
              <div>
                <h3>周 内 支 出 分 布</h3>
                <div className="mono">BY DAY OF WEEK</div>
              </div>
              <div className="mono">周{DOW_LABEL[peakDow]} 支出最高</div>
            </div>
            <div className="v2-dow">
              {dow.map((v, i) => {
                const h = (v / maxDow) * 140;
                return (
                  <div key={i} className="v2-dow-col">
                    <div className="v2-dow-bar-wrap">
                      <span className="mono v2-dow-amt">
                        {fmtMoney(v, 0)}
                      </span>
                      <div className="v2-dow-bar" style={{ height: h }} />
                    </div>
                    <div className="v2-dow-label">周 {DOW_LABEL[i]}</div>
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      </div>
    </>
  );
}

/* =================================================================
   Categories page
================================================================= */
function CategoriesPage({
  query,
  onAdd,
  onDelete,
}: {
  query: LedgerQuery;
  onAdd: (c: Omit<Category, "id">) => void;
  onDelete: (id: string) => void;
}) {
  const { categories } = query.ledger;
  const { stats } = query;
  const [form, setForm] = useState<CategoryForm>({
    name: "",
    type: "expense",
    shape: "square",
    swatch: CATEGORY_SWATCHES[0],
  });

  const { exp, inc, countByCat } = useMemo(() => {
    const summary = query.categorySummary();
    return {
      exp: summary.expense,
      inc: summary.income,
      countByCat: summary.entryCountByCategory,
    };
  }, [query]);

  function submit() {
    if (!form.name.trim()) return;
    onAdd({
      name: form.name,
      type: form.type,
      shape: form.shape,
      swatch: form.swatch,
    });
    setForm({
      name: "",
      type: form.type,
      shape: "square",
      swatch: CATEGORY_SWATCHES[0],
    });
  }

  return (
    <>
      <div className="v2-greet" style={{ paddingBottom: 20 }}>
        <div className="v2-greet-l">
          <div className="v2-greet-time mono">CATEGORIES · 分 类 管 理</div>
          <div className="v2-greet-hi" style={{ fontSize: 36 }}>
            账 目 类 别 ·
            <span className="v2-greet-name"> {categories.length} 类</span>
          </div>
          <div className="v2-greet-sub">用色块/形状区分类别 · 自定义无上限</div>
        </div>
        <div className="v2-greet-r">
          <button className="v2-btn-primary" type="button" onClick={submit}>
            + 新增分类
          </button>
        </div>
      </div>

      <div className="v2-body single">
        <main className="v2-main">
          {/* Form */}
          <section className="v2-chart-card">
            <div className="v2-card-head">
              <div>
                <h3>新 增 分 类</h3>
                <div className="mono">CREATE CATEGORY</div>
              </div>
            </div>
            <div className="v2-cat-form">
              <div className="v2-cat-form-field">
                <label>类型</label>
                <div className="v2-cat-type">
                  <button
                    type="button"
                    className={
                      form.type === "expense" ? "active expense" : ""
                    }
                    onClick={() =>
                      setForm((f) => ({ ...f, type: "expense" }))
                    }
                  >
                    支出
                  </button>
                  <button
                    type="button"
                    className={form.type === "income" ? "active income" : ""}
                    onClick={() =>
                      setForm((f) => ({ ...f, type: "income" }))
                    }
                  >
                    收入
                  </button>
                </div>
              </div>
              <div className="v2-cat-form-field">
                <label>名称</label>
                <input
                  className="v2-cat-input"
                  placeholder="例如：办公用品"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </div>
              <div className="v2-cat-form-field">
                <label>形状</label>
                <div className="v2-cat-shapes">
                  {CATEGORY_SHAPES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={form.shape === s ? "active" : ""}
                      onClick={() => setForm((f) => ({ ...f, shape: s }))}
                    >
                      <CatGlyph shape={s} color={form.swatch} size={14} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="v2-cat-form-field">
                <label>颜色</label>
                <div className="v2-cat-colors">
                  {CATEGORY_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`v2-color-sw ${
                        form.swatch === c ? "active" : ""
                      }`}
                      style={{ background: c }}
                      onClick={() => setForm((f) => ({ ...f, swatch: c }))}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="v2-btn-primary v2-cat-submit"
                onClick={submit}
              >
                保 存 分 类
              </button>
            </div>
          </section>

          {/* Lists */}
          <section className="v2-charts even">
            <div className="v2-chart-card">
              <div className="v2-card-head">
                <div>
                  <h3>支 出 分 类</h3>
                  <div className="mono">{exp.length} 类</div>
                </div>
              </div>
              <CategoryList
                cats={exp}
                stats={stats}
                countByCat={countByCat}
                onDelete={onDelete}
              />
            </div>
            <div className="v2-chart-card">
              <div className="v2-card-head">
                <div>
                  <h3>收 入 分 类</h3>
                  <div className="mono">{inc.length} 类</div>
                </div>
              </div>
              <CategoryList
                cats={inc}
                stats={stats}
                countByCat={countByCat}
                onDelete={onDelete}
              />
            </div>
          </section>
        </main>
      </div>
    </>
  );
}

function CategoryList({
  cats,
  stats,
  countByCat,
  onDelete,
}: {
  cats: Category[];
  stats: Stats;
  countByCat: Record<string, number>;
  onDelete: (id: string) => void;
}) {
  if (cats.length === 0)
    return <div className="v2-empty">暂无分类</div>;
  return (
    <div className="v2-cat-list-2">
      {cats.map((c) => {
        const amount = stats.byCat[c.id] || 0;
        const count = countByCat[c.id] || 0;
        const isDefault = DEFAULT_CATEGORY_IDS.has(c.id);
        return (
          <div key={c.id} className="v2-cat-card">
            <div className="v2-cat-card-l">
              <CatGlyph shape={c.shape} color={c.swatch} size={20} />
              <div>
                <div className="v2-cat-card-name">
                  {c.name}
                  {isDefault && (
                    <span className="v2-cat-card-meta-tag">默认</span>
                  )}
                </div>
                <div className="v2-cat-card-meta">
                  {count} 条记录 · {fmtMoney(amount, 0)}
                </div>
              </div>
            </div>
            <div className="v2-cat-card-r">
              {!isDefault && (
                <button
                  className="v2-cat-action danger mono"
                  type="button"
                  onClick={() => onDelete(c.id)}
                >
                  删除
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* =================================================================
   Backup page
================================================================= */
function BackupPage({
  records,
  categories,
  status,
  onExport,
  onImport,
  onImportFile,
  appVersion,
  updateState,
  onCheckUpdate,
  onRunUpdate,
}: {
  records: RecordItem[];
  categories: Category[];
  status: BackupStatus;
  onExport: () => void;
  onImport: () => void;
  onImportFile: (file: File) => void;
  appVersion: string;
  updateState: UpdateState;
  onCheckUpdate: () => void;
  onRunUpdate: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const filename = `wangyuan-${today()}.xlsx`;
  const sizeEstimate = Math.max(8, Math.round(records.length * 0.55 + 4));

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onImportFile(file);
  }

  return (
    <>
      <div className="v2-greet" style={{ paddingBottom: 20 }}>
        <div className="v2-greet-l">
          <div className="v2-greet-time mono">BACKUP · 数 据 备 份</div>
          <div className="v2-greet-hi" style={{ fontSize: 36 }}>
            账 本 备 份 与
            <span className="v2-greet-name"> 导 入 / 导 出</span>
          </div>
          <div className="v2-greet-sub">
            数据保存于本机 · 支持 Excel xlsx 格式
          </div>
        </div>
        <div className="v2-greet-r">
          <div className="v2-greet-stat">
            <div className="mono">本机总记录</div>
            <div className="v2-greet-num">{records.length} 笔</div>
          </div>
        </div>
      </div>

      <div className="v2-body two">
        <section className="v2-backup-card export">
          <div className="v2-backup-tag mono">EXPORT</div>
          <h3 className="v2-backup-h">导 出 Excel</h3>
          <p className="v2-backup-desc">
            将所有账目记录、分类、汇总导出为 .xlsx 文件，三个工作表分别保存。可在 Numbers / Excel / WPS 中直接打开。
          </p>
          <div className="v2-backup-stat">
            <div>
              <div className="mono">将导出</div>
              <div className="v2-backup-num">{records.length} 条记录</div>
            </div>
            <div>
              <div className="mono">分类</div>
              <div className="v2-backup-num">{categories.length} 类</div>
            </div>
            <div>
              <div className="mono">文件大小估计</div>
              <div className="v2-backup-num">~ {sizeEstimate} KB</div>
            </div>
          </div>
          <button
            type="button"
            className="v2-btn-primary v2-backup-btn"
            onClick={onExport}
          >
            ↓ 导出 {filename}
          </button>
          {status.message && status.type !== "idle" && (
            <div className={`v2-backup-status ${status.type}`}>
              {status.message}
            </div>
          )}
        </section>

        <section className="v2-backup-card import">
          <div className="v2-backup-tag mono">IMPORT</div>
          <h3 className="v2-backup-h">导 入 Excel</h3>
          <p className="v2-backup-desc">
            从 .xlsx 文件恢复账目。系统会校验日期、金额、分类等字段，并提示是否合并或覆盖现有数据。
          </p>
          <div
            className={`v2-backup-drop ${dragging ? "dragging" : ""}`}
            onClick={onImport}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
          >
            <div className="v2-drop-icon mono">+</div>
            <div className="v2-drop-title">拖 拽 文 件 到 此</div>
            <div className="mono v2-drop-sub">或 点 击 选 择 .xlsx</div>
          </div>
          <div className="v2-backup-warn">
            <div className="v2-warn-stamp">!</div>
            <div>
              <div className="v2-warn-title">导入会覆盖当前数据</div>
              <div className="mono v2-warn-sub">
                建议先导出现有账本作为备份
              </div>
            </div>
          </div>
        </section>

        <section className="v2-backup-card about">
          <div className="v2-backup-tag mono">ABOUT · 关 于 与 更 新</div>
          <h3 className="v2-backup-h">版 本 与 更 新</h3>
          <p className="v2-backup-desc">
            应用启动时会自动检查新版本。你也可以随时手动检查；发现新版本可一键下载并安装，无需再去下载安装包。
          </p>
          <div className="v2-about-row">
            <div>
              <div className="mono">当前版本</div>
              <div className="v2-backup-num">v{appVersion}</div>
            </div>
            <button
              type="button"
              className="v2-btn-primary v2-backup-btn"
              onClick={onCheckUpdate}
              disabled={
                updateState.phase === "checking" ||
                updateState.phase === "downloading"
              }
            >
              {updateState.phase === "checking" ? "检 查 中…" : "检 查 更 新"}
            </button>
          </div>
          {updateState.phase === "uptodate" && (
            <div className="v2-backup-status success">已 是 最 新 版 本</div>
          )}
          {updateState.phase === "available" && (
            <div className="v2-about-avail">
              <span>发 现 新 版 本 v{updateState.version}</span>
              <button
                type="button"
                className="v2-btn-primary"
                onClick={onRunUpdate}
              >
                立 即 更 新
              </button>
            </div>
          )}
          {updateState.phase === "downloading" && (
            <div className="v2-backup-status">
              正 在 下 载…{" "}
              {updatePercentLabel(updateState, "")}
            </div>
          )}
          {updateState.phase === "error" && (
            <div className="v2-backup-status error">{updateState.error}</div>
          )}
        </section>
      </div>
    </>
  );
}

/* =================================================================
   New record modal
================================================================= */
function NewRecordModal({
  form,
  setForm,
  categories,
  isEdit,
  onClose,
  onSave,
}: {
  form: RecordForm;
  setForm: React.Dispatch<React.SetStateAction<RecordForm>>;
  categories: Category[];
  isEdit: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const cats = categories.filter((c) => c.type === form.type);
  const onEnterSave = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") onSave();
  };

  function setType(t: CategoryType) {
    const first = categories.find((c) => c.type === t);
    // 目标类型一个分类都没有（如导入了只含单一类型的分类表）时清空 catId，
    // 让保存按钮失效，避免把记录存到与所选 tab 相反类型的旧分类上。
    setForm((f) => ({ ...f, type: t, catId: first?.id ?? "" }));
  }

  function pad(k: string) {
    setForm((f) => {
      let v = f.amount;
      if (k === "⌫") {
        v = v.slice(0, -1);
      } else if (k === ".") {
        if (!v.includes(".")) v = (v || "0") + ".";
      } else {
        v = (v + k).replace(/^0(\d)/, "$1");
      }
      return { ...f, amount: v };
    });
  }

  const [recordNoSuffix] = useState(() =>
    String(Math.floor(Math.random() * 900) + 100),
  );
  const recordNo = `${form.date}-${recordNoSuffix}`;

  return (
    <div className="v2-modal-stage" role="dialog" aria-modal="true">
      <div className="v2-modal-bg" onClick={onClose} />
      <div className="v2-modal-card">
        <div className="v2-modal-perf top" />
        <div className="v2-modal-head">
          <div>
            <div className="mono">
              {isEdit ? "EDIT ENTRY" : "NEW ENTRY"} · No. {recordNo}
            </div>
            <h2 className="v2-modal-h">{isEdit ? "编 辑 记 录" : "新 增 记 录"}</h2>
          </div>
          <button
            type="button"
            className="v2-modal-x"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="v2-modal-tabs">
          <button
            type="button"
            className={form.type === "expense" ? "active expense" : ""}
            onClick={() => setType("expense")}
          >
            支 出
          </button>
          <button
            type="button"
            className={form.type === "income" ? "active income" : ""}
            onClick={() => setType("income")}
          >
            收 入
          </button>
        </div>

        <div className="v2-modal-amount">
          <span className="v2-modal-cur">¥</span>
          <input
            className="v2-modal-input"
            value={form.amount}
            placeholder="0.00"
            onChange={(e) =>
              setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") }))
            }
            onKeyDown={onEnterSave}
            inputMode="decimal"
          />
          <div className="v2-modal-pad">
            {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "⌫"].map(
              (k) => (
                <button
                  key={k}
                  type="button"
                  className="v2-pad-key"
                  onClick={() => pad(k)}
                >
                  {k}
                </button>
              ),
            )}
          </div>
        </div>

        <div className="v2-modal-section">
          <div className="v2-modal-label">分 类</div>
          <div className="v2-modal-cats">
            {cats.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`v2-modal-cat ${form.catId === c.id ? "active" : ""}`}
                onClick={() => setForm((f) => ({ ...f, catId: c.id }))}
              >
                <CatGlyph shape={c.shape} color={c.swatch} size={14} />
                <span>{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="v2-modal-row">
          <div className="v2-modal-section">
            <div className="v2-modal-label">日 期</div>
            <div className="v2-modal-date">
              <input
                type="date"
                value={form.date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, date: e.target.value }))
                }
              />
              <span className="mono">周{weekdayCN(form.date)}</span>
            </div>
          </div>
          <div className="v2-modal-section">
            <div className="v2-modal-label">备 注</div>
            <input
              className="v2-modal-note"
              placeholder="可选 — 例如：嘉实多 95#"
              value={form.note}
              onChange={(e) =>
                setForm((f) => ({ ...f, note: e.target.value }))
              }
              onKeyDown={onEnterSave}
            />
          </div>
        </div>

        <div className="v2-modal-rule" />

        <div className="v2-modal-footer">
          <button type="button" className="v2-btn-ghost mono" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="v2-btn-primary"
            onClick={onSave}
            disabled={!isRecordFormComplete(form)}
          >
            {isEdit ? "保 存 修 改" : "保 存 记 录 · ⏎"}
          </button>
        </div>
        <div className="v2-modal-perf bottom" />
      </div>
    </div>
  );
}

/* =================================================================
   Delete confirm modal
================================================================= */
function DeleteConfirmModal({
  record,
  category,
  onCancel,
  onConfirm,
}: {
  record: RecordItem;
  category: Category;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="v2-modal-stage" role="dialog" aria-modal="true">
      <div className="v2-modal-bg" onClick={onCancel} />
      <div className="v2-modal-card v2-confirm-card">
        <div className="v2-modal-perf top" />
        <div className="v2-modal-head">
          <div>
            <div className="mono">CONFIRM DELETE · No. {record.id}</div>
            <h2 className="v2-modal-h">确 认 删 除</h2>
          </div>
          <button
            type="button"
            className="v2-modal-x"
            onClick={onCancel}
            aria-label="取消"
          >
            ×
          </button>
        </div>

        <p
          style={{
            margin: "16px 0 0",
            fontSize: 13,
            color: "var(--v2-ink-soft)",
            lineHeight: 1.7,
          }}
        >
          删除后会立即从本地数据中移除，无法在应用内撤回。
        </p>

        <dl className="v2-confirm-list">
          <dt>分 类</dt>
          <dd>
            <CatGlyph
              shape={category.shape}
              color={category.swatch}
              size={10}
            />{" "}
            {category.name}
          </dd>
          <dt>金 额</dt>
          <dd className="mono">{fmtMoney(record.amount)}</dd>
          <dt>日 期</dt>
          <dd className="mono">
            {record.date} 周{weekdayCN(record.date)}
          </dd>
          {record.note && (
            <>
              <dt>备 注</dt>
              <dd>{record.note}</dd>
            </>
          )}
        </dl>

        <div className="v2-modal-footer">
          <button type="button" className="v2-btn-ghost mono" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="v2-btn-primary" onClick={onConfirm}>
            确 认 删 除
          </button>
        </div>
        <div className="v2-modal-perf bottom" />
      </div>
    </div>
  );
}

export default App;
