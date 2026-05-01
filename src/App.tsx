import { useEffect, useMemo, useState } from "react";
import "./App.css";

type CategoryType = "expense" | "income";
type TabKey = "dashboard" | "records" | "stats" | "cats";
type FilterType = CategoryType | "all";

type Category = {
  id: string;
  name: string;
  type: CategoryType;
  icon?: string;
};

type RecordItem = {
  id: number;
  catId: string;
  amount: number;
  date: string;
  note?: string;
};

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
};

type FilterState = {
  type: FilterType;
  cat: string;
  month: string;
};

type Stats = {
  income: number;
  expense: number;
  balance: number;
  byCategory: Record<string, number>;
};

const DEFAULT_CATEGORIES: Category[] = [
  { id: "parking", name: "停车费", type: "expense" },
  { id: "rent", name: "房租", type: "expense" },
  { id: "fuel", name: "加油", type: "expense" },
  { id: "entertainment", name: "商务招待", type: "expense" },
  { id: "buy-book", name: "收书", type: "expense" },
  { id: "sell-book", name: "卖书", type: "income" },
];

const COLORS = [
  "#0f766e",
  "#2563eb",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#65a30d",
  "#be185d",
];

const RECORDS_STORAGE_KEY = "accounting.records";
const CATEGORIES_STORAGE_KEY = "accounting.categories";

const today = () => new Date().toISOString().slice(0, 10);

const formatMoney = (value: number) =>
  "¥" +
  Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Restricted WebViews can disable localStorage. In that case the app still works in memory.
  }
}

function createInitialForm(categories: Category[], type: CategoryType = "expense"): RecordForm {
  const category = categories.find((cat) => cat.type === type) ?? categories[0];
  return {
    type: category?.type ?? type,
    catId: category?.id ?? DEFAULT_CATEGORIES[0].id,
    amount: "",
    date: today(),
    note: "",
  };
}

function App() {
  const [records, setRecords] = useState<RecordItem[]>(() =>
    loadJson<RecordItem[]>(RECORDS_STORAGE_KEY, []),
  );
  const [categories, setCategories] = useState<Category[]>(() =>
    loadJson<Category[]>(CATEGORIES_STORAGE_KEY, DEFAULT_CATEGORIES),
  );
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterState>({
    type: "all",
    cat: "all",
    month: "",
  });
  const [form, setForm] = useState<RecordForm>(() => createInitialForm(DEFAULT_CATEGORIES));
  const [catForm, setCatForm] = useState<CategoryForm>({
    name: "",
    type: "expense",
  });

  useEffect(() => {
    saveJson(RECORDS_STORAGE_KEY, records);
  }, [records]);

  useEffect(() => {
    saveJson(CATEGORIES_STORAGE_KEY, categories);
  }, [categories]);

  const getCat = (id: string): Category =>
    categories.find((cat) => cat.id === id) ?? {
      id: "unknown",
      name: "未知分类",
      type: "expense",
    };

  const sortedRecords = useMemo(() => {
    return records
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  }, [records]);

  const filteredRecords = useMemo(() => {
    return sortedRecords.filter((record) => {
      const category = getCat(record.catId);
      if (filter.type !== "all" && category.type !== filter.type) return false;
      if (filter.cat !== "all" && record.catId !== filter.cat) return false;
      if (filter.month && !record.date.startsWith(filter.month)) return false;
      return true;
    });
  }, [sortedRecords, filter, categories]);

  const stats = useMemo<Stats>(() => {
    const income = records
      .filter((record) => getCat(record.catId).type === "income")
      .reduce((sum, record) => sum + record.amount, 0);
    const expense = records
      .filter((record) => getCat(record.catId).type === "expense")
      .reduce((sum, record) => sum + record.amount, 0);
    const byCategory: Record<string, number> = {};

    records.forEach((record) => {
      byCategory[record.catId] = (byCategory[record.catId] || 0) + record.amount;
    });

    return { income, expense, balance: income - expense, byCategory };
  }, [records, categories]);

  const months = useMemo(() => {
    return [...new Set(records.map((record) => record.date.slice(0, 7)))]
      .sort()
      .reverse();
  }, [records]);

  const categoryStats = useMemo(() => {
    return categories
      .map((category) => ({
        category,
        amount: stats.byCategory[category.id] || 0,
      }))
      .filter((item) => item.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [categories, stats.byCategory]);

  function openAddModal() {
    setForm(createInitialForm(categories));
    setEditId(null);
    setModalOpen(true);
  }

  function openEditModal(record: RecordItem) {
    const category = getCat(record.catId);
    setForm({
      type: category.type,
      catId: record.catId,
      amount: String(record.amount),
      date: record.date,
      note: record.note || "",
    });
    setEditId(record.id);
    setModalOpen(true);
  }

  function resetForm(type: CategoryType = "expense") {
    setForm(createInitialForm(categories, type));
    setEditId(null);
  }

  function saveRecord() {
    const amount = Number(form.amount);
    if (!form.catId || !form.amount || Number.isNaN(amount) || amount <= 0) return;

    if (editId !== null) {
      setRecords((items) =>
        items.map((record) =>
          record.id === editId
            ? {
                ...record,
                catId: form.catId,
                amount,
                date: form.date,
                note: form.note.trim(),
              }
            : record,
        ),
      );
    } else {
      setRecords((items) => [
        ...items,
        {
          id: Date.now(),
          catId: form.catId,
          amount,
          date: form.date,
          note: form.note.trim(),
        },
      ]);
    }

    setModalOpen(false);
    resetForm(form.type);
  }

  function saveQuickRecord() {
    const amount = Number(form.amount);
    if (!form.catId || !form.amount || Number.isNaN(amount) || amount <= 0) return;

    setRecords((items) => [
      ...items,
      {
        id: Date.now(),
        catId: form.catId,
        amount,
        date: form.date,
        note: form.note.trim(),
      },
    ]);
    resetForm(form.type);
  }

  function deleteRecord(id: number) {
    setRecords((items) => items.filter((record) => record.id !== id));
  }

  function addCategory() {
    const name = catForm.name.trim();
    if (!name) return;

    setCategories((items) => [
      ...items,
      {
        id: `custom-${Date.now()}`,
        name,
        type: catForm.type,
      },
    ]);
    setCatForm({ name: "", type: "expense" });
  }

  function deleteCategory(id: string) {
    if (DEFAULT_CATEGORIES.some((category) => category.id === id)) return;
    setCategories((items) => items.filter((category) => category.id !== id));
    setRecords((items) => items.filter((record) => record.catId !== id));
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">账</div>
          <div>
            <div className="brand-name">简账</div>
            <div className="brand-subtitle">本地记账工作台</div>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {(
            [
              ["dashboard", "总览", "余额、近期记录"],
              ["records", "明细", "筛选和编辑"],
              ["stats", "统计", "分类占比"],
              ["cats", "分类", "自定义收支"],
            ] as const
          ).map(([key, label, helper]) => (
            <button
              className={`nav-item ${tab === key ? "active" : ""}`}
              key={key}
              onClick={() => setTab(key)}
              type="button"
            >
              <span>{label}</span>
              <small>{helper}</small>
            </button>
          ))}
        </nav>

        <div className="sidebar-balance">
          <span>当前结余</span>
          <strong>{formatMoney(stats.balance)}</strong>
        </div>
      </aside>

      <main className="main-panel">
        <section className="hero-panel">
          <div>
            <h1>财务总览</h1>
            <p>记录收入、支出和分类趋势，数据保存在本机。</p>
          </div>
          <button className="primary-action" onClick={openAddModal} type="button">
            新增记录
          </button>
        </section>

        <section className="metric-grid" aria-label="财务指标">
          <MetricCard label="总余额" value={formatMoney(stats.balance)} tone="balance" />
          <MetricCard label="总收入" value={formatMoney(stats.income)} tone="income" />
          <MetricCard label="总支出" value={formatMoney(stats.expense)} tone="expense" />
        </section>

        <section className="content-panel">
          {tab === "dashboard" && (
            <DashboardView
              records={sortedRecords}
              categoryStats={categoryStats}
              stats={stats}
              getCat={getCat}
            />
          )}

          {tab === "records" && (
            <RecordsView
              records={filteredRecords}
              categories={categories}
              filter={filter}
              months={months}
              getCat={getCat}
              setFilter={setFilter}
              onEdit={openEditModal}
              onDelete={deleteRecord}
            />
          )}

          {tab === "stats" && (
            <StatsView categoryStats={categoryStats} stats={stats} />
          )}

          {tab === "cats" && (
            <CategoriesView
              categories={categories}
              catForm={catForm}
              setCatForm={setCatForm}
              onAdd={addCategory}
              onDelete={deleteCategory}
            />
          )}
        </section>
      </main>

      <aside className="right-panel">
        <QuickEntry
          categories={categories}
          form={form}
          setForm={setForm}
          onSave={saveQuickRecord}
        />

        <section className="side-card">
          <div className="side-card-heading">
            <h2>最近记录</h2>
            <span>{records.length} 条</span>
          </div>
          <div className="mini-list">
            {sortedRecords.slice(0, 5).map((record) => (
              <MiniRecord key={record.id} record={record} category={getCat(record.catId)} />
            ))}
            {sortedRecords.length === 0 && <EmptyState text="暂无记录" compact />}
          </div>
        </section>
      </aside>

      <button className="floating-action" onClick={openAddModal} type="button" aria-label="新增记录">
        +
      </button>

      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>{editId !== null ? "编辑记录" : "新增记录"}</h2>
                <p>选择分类、金额和日期后保存。</p>
              </div>
              <button className="icon-button" onClick={() => setModalOpen(false)} type="button">
                ×
              </button>
            </div>
            <RecordFormFields categories={categories} form={form} setForm={setForm} />
            <button className="submit-button" onClick={saveRecord} type="button">
              {editId !== null ? "保存修改" : "确认记账"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "balance" | "income" | "expense";
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function DashboardView({
  records,
  categoryStats,
  stats,
  getCat,
}: {
  records: RecordItem[];
  categoryStats: { category: Category; amount: number }[];
  stats: Stats;
  getCat: (id: string) => Category;
}) {
  return (
    <div className="dashboard-grid">
      <section className="panel-block wide">
        <PanelHeader title="近期记录" description="最近 10 条收支动态" />
        <RecordTable records={records.slice(0, 10)} getCat={getCat} />
      </section>

      <section className="panel-block">
        <PanelHeader title="分类排行" description="按金额排序" />
        <CategoryBars items={categoryStats} income={stats.income} expense={stats.expense} />
      </section>
    </div>
  );
}

function RecordsView({
  records,
  categories,
  filter,
  months,
  getCat,
  setFilter,
  onEdit,
  onDelete,
}: {
  records: RecordItem[];
  categories: Category[];
  filter: FilterState;
  months: string[];
  getCat: (id: string) => Category;
  setFilter: React.Dispatch<React.SetStateAction<FilterState>>;
  onEdit: (record: RecordItem) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <section className="panel-block">
      <div className="records-toolbar">
        <PanelHeader title="收支明细" description="筛选、编辑或删除记录" />
        <div className="filter-row">
          <select
            value={filter.type}
            onChange={(event) =>
              setFilter((value) => ({ ...value, type: event.target.value as FilterType }))
            }
          >
            <option value="all">全部类型</option>
            <option value="expense">支出</option>
            <option value="income">收入</option>
          </select>
          <select
            value={filter.cat}
            onChange={(event) => setFilter((value) => ({ ...value, cat: event.target.value }))}
          >
            <option value="all">全部分类</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <select
            value={filter.month}
            onChange={(event) =>
              setFilter((value) => ({ ...value, month: event.target.value }))
            }
          >
            <option value="">全部月份</option>
            {months.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        </div>
      </div>

      <RecordTable records={records} getCat={getCat} onEdit={onEdit} onDelete={onDelete} />
    </section>
  );
}

function StatsView({
  categoryStats,
  stats,
}: {
  categoryStats: { category: Category; amount: number }[];
  stats: Stats;
}) {
  return (
    <div className="stats-grid">
      <section className="panel-block">
        <PanelHeader title="分类占比" description="收入与支出的合计分布" />
        <DonutChart items={categoryStats} />
      </section>
      <section className="panel-block">
        <PanelHeader title="分类明细" description="每个分类的金额和占比" />
        <CategoryBars items={categoryStats} income={stats.income} expense={stats.expense} />
      </section>
    </div>
  );
}

function CategoriesView({
  categories,
  catForm,
  setCatForm,
  onAdd,
  onDelete,
}: {
  categories: Category[];
  catForm: CategoryForm;
  setCatForm: React.Dispatch<React.SetStateAction<CategoryForm>>;
  onAdd: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="category-layout">
      <section className="panel-block">
        <PanelHeader title="新增分类" description="为收入或支出添加自定义分类" />
        <div className="category-editor">
          <select
            value={catForm.type}
            onChange={(event) =>
              setCatForm((value) => ({ ...value, type: event.target.value as CategoryType }))
            }
          >
            <option value="expense">支出</option>
            <option value="income">收入</option>
          </select>
          <input
            value={catForm.name}
            placeholder="分类名称"
            onChange={(event) => setCatForm((value) => ({ ...value, name: event.target.value }))}
            onKeyDown={(event) => event.key === "Enter" && onAdd()}
          />
          <button onClick={onAdd} type="button">
            添加
          </button>
        </div>
      </section>

      {(["expense", "income"] as const).map((type) => (
        <section className="panel-block" key={type}>
          <PanelHeader title={type === "expense" ? "支出分类" : "收入分类"} />
          <div className="category-list">
            {categories
              .filter((category) => category.type === type)
              .map((category) => {
                const isDefault = DEFAULT_CATEGORIES.some((item) => item.id === category.id);
                return (
                  <div className="category-row" key={category.id}>
                    <span>{category.name}</span>
                    {isDefault ? (
                      <small>默认</small>
                    ) : (
                      <button onClick={() => onDelete(category.id)} type="button">
                        删除
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}

function QuickEntry({
  categories,
  form,
  setForm,
  onSave,
}: {
  categories: Category[];
  form: RecordForm;
  setForm: React.Dispatch<React.SetStateAction<RecordForm>>;
  onSave: () => void;
}) {
  return (
    <section className="side-card quick-entry">
      <div className="side-card-heading">
        <h2>快速记一笔</h2>
        <span>{form.type === "expense" ? "支出" : "收入"}</span>
      </div>
      <RecordFormFields categories={categories} form={form} setForm={setForm} compact />
      <button className="submit-button" onClick={onSave} type="button">
        保存记录
      </button>
    </section>
  );
}

function RecordFormFields({
  categories,
  form,
  setForm,
  compact = false,
}: {
  categories: Category[];
  form: RecordForm;
  setForm: React.Dispatch<React.SetStateAction<RecordForm>>;
  compact?: boolean;
}) {
  function setType(type: CategoryType) {
    const firstCategory = categories.find((category) => category.type === type);
    setForm((value) => ({
      ...value,
      type,
      catId: firstCategory?.id ?? value.catId,
    }));
  }

  return (
    <div className={`record-form ${compact ? "compact" : ""}`}>
      <div className="segmented">
        <button
          className={form.type === "expense" ? "active expense" : ""}
          onClick={() => setType("expense")}
          type="button"
        >
          支出
        </button>
        <button
          className={form.type === "income" ? "active income" : ""}
          onClick={() => setType("income")}
          type="button"
        >
          收入
        </button>
      </div>

      <label>
        <span>分类</span>
        <select
          value={form.catId}
          onChange={(event) => setForm((value) => ({ ...value, catId: event.target.value }))}
        >
          {categories
            .filter((category) => category.type === form.type)
            .map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
        </select>
      </label>

      <label>
        <span>金额</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          placeholder="0.00"
          value={form.amount}
          onChange={(event) => setForm((value) => ({ ...value, amount: event.target.value }))}
        />
      </label>

      <label>
        <span>日期</span>
        <input
          type="date"
          value={form.date}
          onChange={(event) => setForm((value) => ({ ...value, date: event.target.value }))}
        />
      </label>

      <label>
        <span>备注</span>
        <input
          placeholder="可选"
          value={form.note}
          onChange={(event) => setForm((value) => ({ ...value, note: event.target.value }))}
        />
      </label>
    </div>
  );
}

function RecordTable({
  records,
  getCat,
  onEdit,
  onDelete,
}: {
  records: RecordItem[];
  getCat: (id: string) => Category;
  onEdit?: (record: RecordItem) => void;
  onDelete?: (id: number) => void;
}) {
  if (records.length === 0) {
    return <EmptyState text="暂无记录，新增一笔后会显示在这里。" />;
  }

  return (
    <div className="record-table">
      {records.map((record) => {
        const category = getCat(record.catId);
        const isIncome = category.type === "income";
        return (
          <div className="record-row" key={record.id}>
            <div>
              <strong>{category.name}</strong>
              <span>
                {record.date}
                {record.note ? ` · ${record.note}` : ""}
              </span>
            </div>
            <b className={isIncome ? "income-text" : "expense-text"}>
              {isIncome ? "+" : "-"}
              {formatMoney(record.amount)}
            </b>
            {(onEdit || onDelete) && (
              <div className="row-actions">
                {onEdit && (
                  <button onClick={() => onEdit(record)} type="button">
                    编辑
                  </button>
                )}
                {onDelete && (
                  <button className="danger" onClick={() => onDelete(record.id)} type="button">
                    删除
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MiniRecord({ record, category }: { record: RecordItem; category: Category }) {
  const isIncome = category.type === "income";
  return (
    <div className="mini-record">
      <div>
        <strong>{category.name}</strong>
        <span>{record.date}</span>
      </div>
      <b className={isIncome ? "income-text" : "expense-text"}>
        {isIncome ? "+" : "-"}
        {formatMoney(record.amount)}
      </b>
    </div>
  );
}

function CategoryBars({
  items,
  income,
  expense,
}: {
  items: { category: Category; amount: number }[];
  income: number;
  expense: number;
}) {
  if (items.length === 0) {
    return <EmptyState text="暂无统计数据。" compact />;
  }

  return (
    <div className="category-bars">
      {items.map(({ category, amount }, index) => {
        const base = category.type === "income" ? income : expense;
        const percent = base > 0 ? Math.round((amount / base) * 100) : 0;
        return (
          <div className="bar-item" key={category.id}>
            <div>
              <span>{category.name}</span>
              <strong>{formatMoney(amount)}</strong>
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  width: `${Math.max(percent, 4)}%`,
                  background: COLORS[index % COLORS.length],
                }}
              />
            </div>
            <small>{percent}%</small>
          </div>
        );
      })}
    </div>
  );
}

function DonutChart({ items }: { items: { category: Category; amount: number }[] }) {
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  let offset = 0;

  if (items.length === 0 || total === 0) {
    return <EmptyState text="暂无统计数据。" compact />;
  }

  return (
    <div className="donut-layout">
      <svg viewBox="0 0 120 120" className="donut-chart" role="img" aria-label="分类占比图">
        <circle cx="60" cy="60" r="44" className="donut-base" />
        {items.map((item, index) => {
          const fraction = item.amount / total;
          const length = fraction * 276.46;
          const strokeDasharray = `${length} ${276.46 - length}`;
          const strokeDashoffset = -offset;
          offset += length;
          return (
            <circle
              key={item.category.id}
              cx="60"
              cy="60"
              r="44"
              className="donut-slice"
              stroke={COLORS[index % COLORS.length]}
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
            />
          );
        })}
      </svg>
      <div className="donut-legend">
        {items.map((item, index) => (
          <div key={item.category.id}>
            <span style={{ background: COLORS[index % COLORS.length] }} />
            <strong>{item.category.name}</strong>
            <em>{Math.round((item.amount / total) * 100)}%</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function PanelHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  );
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return <div className={`empty-state ${compact ? "compact" : ""}`}>{text}</div>;
}

export default App;
