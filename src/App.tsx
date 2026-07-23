import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./App.css";
import {
  CATEGORY_SHAPES,
  CATEGORY_SWATCHES,
  DEFAULT_CATEGORY_IDS,
  type Category,
  type CategoryType,
  type CatShape,
  type LedgerEntry as RecordItem,
} from "./ledgerCommands";
import {
  formatMoney as fmtMoney,
  todayKey as today,
} from "./ledgerFormat";
import {
  createLedgerQuery,
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
import { LedgerFeature } from "./features/ledger/LedgerFeature";
import { StatsFeature } from "./features/stats/StatsFeature";
import { CatGlyph } from "./ui/CatGlyph";

/* =================================================================
   Types & constants
================================================================= */

type PageKey = "ledger" | "stats" | "cats" | "backup";

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
  const [ledgerAddOpen, setLedgerAddOpen] = useState(false);
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

  /* ---- actions ---- */
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
        onAdd={() => setLedgerAddOpen(true)}
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

      <LedgerFeature
        active={page === "ledger"}
        query={query}
        dispatch={dispatchLedger}
        addOpen={ledgerAddOpen}
        onAddClose={() => setLedgerAddOpen(false)}
      />

      {page === "stats" && (
        <StatsFeature query={query} />
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

export default App;
