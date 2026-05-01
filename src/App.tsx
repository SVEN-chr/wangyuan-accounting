import { useEffect, useMemo, useState } from "react";
import "./App.css";

type CategoryType = "expense" | "income";
type TabKey = "dashboard" | "records" | "stats" | "cats";
type FilterType = CategoryType | "all";

type Category = {
  id: string;
  name: string;
  type: CategoryType;
  icon: string;
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

type PieDatum = {
  label: string;
  value: number;
};

const DEFAULT_CATEGORIES: Category[] = [
  { id: "parking", name: "停车费", type: "expense", icon: "P" },
  { id: "rent", name: "房租", type: "expense", icon: "房" },
  { id: "fuel", name: "加油", type: "expense", icon: "油" },
  { id: "entertainment", name: "商务招待", type: "expense", icon: "宴" },
  { id: "buy-book", name: "收书", type: "expense", icon: "书" },
  { id: "sell-book", name: "卖书", type: "income", icon: "收" },
];

const COLORS = [
  "#6366f1",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#3b82f6",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
  "#84cc16",
];

const RECORDS_STORAGE_KEY = "accounting.records";
const CATEGORIES_STORAGE_KEY = "accounting.categories";

const fmt = (n: number) =>
  "¥" +
  Number(n).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const today = () => new Date().toISOString().slice(0, 10);

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
    // localStorage can be unavailable in restricted WebViews; the app remains usable in memory.
  }
}

function App() {
  const [records, setRecords] = useState<RecordItem[]>(() =>
    loadJson<RecordItem[]>(RECORDS_STORAGE_KEY, []),
  );
  const [categories, setCategories] = useState<Category[]>(() =>
    loadJson<Category[]>(CATEGORIES_STORAGE_KEY, DEFAULT_CATEGORIES),
  );
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [modal, setModal] = useState<"add" | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterState>({
    type: "all",
    cat: "all",
    month: "",
  });
  const [form, setForm] = useState<RecordForm>({
    type: "expense",
    catId: "parking",
    amount: "",
    date: today(),
    note: "",
  });
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
    categories.find((c) => c.id === id) ?? {
      id: "unknown",
      name: "未知",
      icon: "?",
      type: "expense",
    };

  const filteredRecords = useMemo(() => {
    return records
      .filter((r) => {
        const cat = getCat(r.catId);
        if (filter.type !== "all" && cat.type !== filter.type) return false;
        if (filter.cat !== "all" && r.catId !== filter.cat) return false;
        if (filter.month && !r.date.startsWith(filter.month)) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  }, [records, filter, categories]);

  const stats = useMemo(() => {
    const income = records
      .filter((r) => getCat(r.catId).type === "income")
      .reduce((s, r) => s + r.amount, 0);
    const expense = records
      .filter((r) => getCat(r.catId).type === "expense")
      .reduce((s, r) => s + r.amount, 0);
    const byCategory: Record<string, number> = {};

    records.forEach((r) => {
      byCategory[r.catId] = (byCategory[r.catId] || 0) + r.amount;
    });

    return { income, expense, balance: income - expense, byCategory };
  }, [records, categories]);

  const months = useMemo(() => {
    const ms = new Set(records.map((r) => r.date.slice(0, 7)));
    return [...ms].sort().reverse();
  }, [records]);

  const pieData = Object.entries(stats.byCategory)
    .filter(([, v]) => v > 0)
    .map(([id, value]) => ({ label: getCat(id).name, value }))
    .sort((a, b) => b.value - a.value);

  function openAdd() {
    const firstCat = categories.find((cat) => cat.type === "expense") ?? categories[0];
    setForm({
      type: firstCat?.type ?? "expense",
      catId: firstCat?.id ?? "parking",
      amount: "",
      date: today(),
      note: "",
    });
    setEditId(null);
    setModal("add");
  }

  function openEdit(rec: RecordItem) {
    const cat = getCat(rec.catId);
    setForm({
      type: cat.type,
      catId: rec.catId,
      amount: String(rec.amount),
      date: rec.date,
      note: rec.note || "",
    });
    setEditId(rec.id);
    setModal("add");
  }

  function saveRecord() {
    const amount = Number(form.amount);
    if (!form.amount || Number.isNaN(amount) || amount <= 0) return;

    if (editId !== null) {
      setRecords((rs) =>
        rs.map((r) =>
          r.id === editId
            ? {
                ...r,
                catId: form.catId,
                amount,
                date: form.date,
                note: form.note,
              }
            : r,
        ),
      );
    } else {
      setRecords((rs) => [
        ...rs,
        {
          id: Date.now(),
          catId: form.catId,
          amount,
          date: form.date,
          note: form.note,
        },
      ]);
    }

    setModal(null);
  }

  function deleteRecord(id: number) {
    setRecords((rs) => rs.filter((r) => r.id !== id));
  }

  function addCategory() {
    if (!catForm.name.trim()) return;
    const id = `custom-${Date.now()}`;
    setCategories((cs) => [
      ...cs,
      {
        id,
        name: catForm.name.trim(),
        type: catForm.type,
        icon: catForm.type === "income" ? "入" : "支",
      },
    ]);
    setCatForm({ name: "", type: "expense" });
  }

  function deleteCategory(id: string) {
    if (DEFAULT_CATEGORIES.find((c) => c.id === id)) return;
    setCategories((cs) => cs.filter((c) => c.id !== id));
  }

  function PieChart({ data }: { data: PieDatum[] }) {
    if (!data.length) {
      return <div style={emptyStateStyle}>暂无数据</div>;
    }

    const total = data.reduce((s, d) => s + d.value, 0);
    let angle = 0;
    const slices = data.map((d, i) => {
      const pct = d.value / total;
      const startAngle = angle;
      angle += pct * 2 * Math.PI;
      const x1 = 50 + 40 * Math.sin(startAngle);
      const y1 = 50 - 40 * Math.cos(startAngle);
      const x2 = 50 + 40 * Math.sin(angle);
      const y2 = 50 - 40 * Math.cos(angle);
      const large = pct > 0.5 ? 1 : 0;

      return {
        ...d,
        path: `M50,50 L${x1},${y1} A40,40 0 ${large},1 ${x2},${y2} Z`,
        color: COLORS[i % COLORS.length],
        pct,
      };
    });

    return (
      <div style={pieWrapStyle}>
        <svg viewBox="0 0 100 100" style={{ width: 160, height: 160 }}>
          {slices.length === 1 ? (
            <circle cx="50" cy="50" r="40" fill={slices[0].color} />
          ) : (
            slices.map((s, i) => <path key={i} d={s.path} fill={s.color} />)
          )}
        </svg>
        <div style={legendGridStyle}>
          {slices.map((s, i) => (
            <div key={i} style={legendItemStyle}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: s.color,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              <span style={legendTextStyle}>{s.label}</span>
              <span style={legendPctStyle}>{(s.pct * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={appShellStyle}>
      <div style={headerStyle}>
        <div style={headerLabelStyle}>总余额</div>
        <div style={balanceStyle}>{fmt(stats.balance)}</div>
        <div style={summaryStyle}>
          <div>
            <div style={summaryLabelStyle}>总收入</div>
            <div style={summaryValueStyle}>{fmt(stats.income)}</div>
          </div>
          <div>
            <div style={summaryLabelStyle}>总支出</div>
            <div style={summaryValueStyle}>{fmt(stats.expense)}</div>
          </div>
        </div>
      </div>

      <div style={tabsStyle}>
        {(
          [
            ["dashboard", "概览"],
            ["records", "明细"],
            ["stats", "统计"],
            ["cats", "分类"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              ...tabButtonStyle,
              fontWeight: tab === key ? 700 : 400,
              color: tab === key ? "#6366f1" : "#64748b",
              borderBottom:
                tab === key ? "2px solid #6366f1" : "2px solid transparent",
            }}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: "16px" }}>
        {tab === "dashboard" && (
          <div>
            <div style={sectionTitleStyle}>近期记录</div>
            {records.length === 0 && (
              <div style={emptyStateStyle}>还没有记录，点击右下角 + 开始记账</div>
            )}
            {records
              .slice()
              .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
              .slice(0, 10)
              .map((rec) => {
                const cat = getCat(rec.catId);
                return <RecordCard key={rec.id} cat={cat} rec={rec} />;
              })}
          </div>
        )}

        {tab === "records" && (
          <div>
            <div style={filtersStyle}>
              <select
                value={filter.type}
                onChange={(e) =>
                  setFilter((f) => ({ ...f, type: e.target.value as FilterType }))
                }
                style={selectStyle}
              >
                <option value="all">全部类型</option>
                <option value="income">收入</option>
                <option value="expense">支出</option>
              </select>
              <select
                value={filter.cat}
                onChange={(e) => setFilter((f) => ({ ...f, cat: e.target.value }))}
                style={selectStyle}
              >
                <option value="all">全部分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={filter.month}
                onChange={(e) =>
                  setFilter((f) => ({ ...f, month: e.target.value }))
                }
                style={selectStyle}
              >
                <option value="">全部月份</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {filteredRecords.length === 0 && (
              <div style={emptyStateStyle}>没有符合条件的记录</div>
            )}
            {filteredRecords.map((rec) => {
              const cat = getCat(rec.catId);
              return (
                <RecordCard
                  key={rec.id}
                  cat={cat}
                  rec={rec}
                  actions={
                    <div style={recordActionsStyle}>
                      <button
                        onClick={() => openEdit(rec)}
                        style={editButtonStyle}
                        type="button"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => deleteRecord(rec.id)}
                        style={deleteButtonStyle}
                        type="button"
                      >
                        删除
                      </button>
                    </div>
                  }
                />
              );
            })}
          </div>
        )}

        {tab === "stats" && (
          <div>
            <div style={panelStyle}>
              <div style={panelTitleStyle}>各分类占比</div>
              <PieChart data={pieData} />
            </div>
            <div style={panelStyle}>
              <div style={panelTitleStyle}>分类明细</div>
              {categories
                .filter((c) => stats.byCategory[c.id])
                .sort(
                  (a, b) =>
                    (stats.byCategory[b.id] || 0) - (stats.byCategory[a.id] || 0),
                )
                .map((cat, i) => {
                  const amt = stats.byCategory[cat.id] || 0;
                  const total = cat.type === "income" ? stats.income : stats.expense;
                  const pct = total > 0 ? (amt / total) * 100 : 0;
                  return (
                    <div key={cat.id} style={{ marginBottom: 12 }}>
                      <div style={categoryRowStyle}>
                        <span style={{ fontSize: 13 }}>{cat.name}</span>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: cat.type === "income" ? "#10b981" : "#ef4444",
                          }}
                        >
                          {fmt(amt)}
                        </span>
                      </div>
                      <div style={progressTrackStyle}>
                        <div
                          style={{
                            height: 6,
                            borderRadius: 3,
                            width: `${pct}%`,
                            background: COLORS[i % COLORS.length],
                            transition: "width 0.4s",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              {pieData.length === 0 && <div style={emptyStateStyle}>暂无数据</div>}
            </div>
          </div>
        )}

        {tab === "cats" && (
          <div>
            <div style={panelStyle}>
              <div style={panelTitleStyle}>添加自定义分类</div>
              <div style={categoryFormStyle}>
                <select
                  value={catForm.type}
                  onChange={(e) =>
                    setCatForm((f) => ({
                      ...f,
                      type: e.target.value as CategoryType,
                    }))
                  }
                  style={selectStyle}
                >
                  <option value="expense">支出</option>
                  <option value="income">收入</option>
                </select>
                <input
                  placeholder="分类名称"
                  value={catForm.name}
                  onChange={(e) =>
                    setCatForm((f) => ({ ...f, name: e.target.value }))
                  }
                  onKeyDown={(e) => e.key === "Enter" && addCategory()}
                  style={categoryNameInputStyle}
                />
                <button onClick={addCategory} style={primarySmallButtonStyle} type="button">
                  添加
                </button>
              </div>
            </div>
            {(["expense", "income"] as const).map((type) => (
              <div key={type} style={panelStyle}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    color: type === "income" ? "#10b981" : "#ef4444",
                    marginBottom: 10,
                  }}
                >
                  {type === "income" ? "收入分类" : "支出分类"}
                </div>
                {categories
                  .filter((c) => c.type === type)
                  .map((cat) => {
                    const isDefault = !!DEFAULT_CATEGORIES.find(
                      (d) => d.id === cat.id,
                    );
                    return (
                      <div key={cat.id} style={categoryItemStyle}>
                        <span style={categoryNameStyle}>{cat.name}</span>
                        {isDefault ? (
                          <span style={defaultBadgeStyle}>默认</span>
                        ) : (
                          <button
                            onClick={() => deleteCategory(cat.id)}
                            style={deleteButtonStyle}
                            type="button"
                          >
                            删除
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
        )}
      </div>

      <button onClick={openAdd} style={fabStyle} type="button" aria-label="添加记录">
        +
      </button>

      {modal === "add" && (
        <div style={modalOverlayStyle} onClick={() => setModal(null)}>
          <div style={modalSheetStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalTitleStyle}>
              {editId !== null ? "编辑记录" : "添加记录"}
            </div>

            <div style={typeSelectorStyle}>
              {(["expense", "income"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => {
                    const firstOfType = categories.find((c) => c.type === type);
                    setForm((f) => ({
                      ...f,
                      type,
                      catId: firstOfType?.id || f.catId,
                    }));
                  }}
                  style={{
                    ...typeButtonStyle,
                    background: form.type === type ? "#fff" : "transparent",
                    color:
                      form.type === type
                        ? type === "income"
                          ? "#10b981"
                          : "#ef4444"
                        : "#94a3b8",
                    boxShadow:
                      form.type === type ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                  }}
                  type="button"
                >
                  {type === "expense" ? "支出" : "收入"}
                </button>
              ))}
            </div>

            <div style={fieldStyle}>
              <div style={fieldLabelStyle}>分类</div>
              <div style={categoryChipsStyle}>
                {categories
                  .filter((c) => c.type === form.type)
                  .map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setForm((f) => ({ ...f, catId: cat.id }))}
                      style={{
                        ...chipStyle,
                        borderColor:
                          form.catId === cat.id ? "#6366f1" : "#e2e8f0",
                        background: form.catId === cat.id ? "#eef2ff" : "#fff",
                        color: form.catId === cat.id ? "#6366f1" : "#475569",
                      }}
                      type="button"
                    >
                      {cat.name}
                    </button>
                  ))}
              </div>
            </div>

            <div style={fieldStyle}>
              <div style={fieldLabelStyle}>金额（元）</div>
              <input
                type="number"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) =>
                  setForm((f) => ({ ...f, amount: e.target.value }))
                }
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <div style={fieldLabelStyle}>日期</div>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={fieldLabelStyle}>备注（可选）</div>
              <input
                placeholder="添加备注..."
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                style={inputStyle}
              />
            </div>

            <button onClick={saveRecord} style={primaryButtonStyle} type="button">
              {editId !== null ? "保存修改" : "确认记账"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordCard({
  cat,
  rec,
  actions,
}: {
  cat: Category;
  rec: RecordItem;
  actions?: React.ReactNode;
}) {
  return (
    <div style={recordCardStyle}>
      <div style={recordInfoStyle}>
        <div style={recordNameStyle}>{cat.name}</div>
        <div style={recordMetaStyle}>
          {rec.date}
          {rec.note ? ` · ${rec.note}` : ""}
        </div>
      </div>
      <div
        style={{
          fontWeight: 700,
          fontSize: 15,
          color: cat.type === "income" ? "#10b981" : "#ef4444",
          marginRight: actions ? 4 : 0,
          whiteSpace: "nowrap",
        }}
      >
        {cat.type === "income" ? "+" : "-"}
        {fmt(rec.amount)}
      </div>
      {actions}
    </div>
  );
}

const appShellStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "100vh",
  background: "#f8fafc",
  fontFamily: "system-ui, sans-serif",
  paddingBottom: 80,
};

const headerStyle: React.CSSProperties = {
  background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
  padding: "20px 20px 32px",
  borderRadius: "0 0 24px 24px",
};

const headerLabelStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.85)",
  fontSize: 13,
  marginBottom: 4,
};

const balanceStyle: React.CSSProperties = {
  color: "#fff",
  fontSize: 36,
  fontWeight: 700,
};

const summaryStyle: React.CSSProperties = {
  display: "flex",
  gap: 24,
  marginTop: 16,
};

const summaryLabelStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.7)",
  fontSize: 11,
};

const summaryValueStyle: React.CSSProperties = {
  color: "#fff",
  fontWeight: 600,
  fontSize: 15,
};

const tabsStyle: React.CSSProperties = {
  display: "flex",
  background: "#fff",
  borderBottom: "1px solid #e2e8f0",
  position: "sticky",
  top: 0,
  zIndex: 10,
};

const tabButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "12px 0",
  fontSize: 12,
  background: "none",
  border: "none",
  cursor: "pointer",
};

const sectionTitleStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 15,
  marginBottom: 12,
  color: "#1e293b",
};

const emptyStateStyle: React.CSSProperties = {
  textAlign: "center",
  color: "#94a3b8",
  padding: "40px 0",
};

const recordCardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: "12px 14px",
  marginBottom: 8,
  display: "flex",
  alignItems: "center",
  gap: 12,
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
};

const recordInfoStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const recordNameStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
  color: "#1e293b",
};

const recordMetaStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#94a3b8",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const filtersStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginBottom: 12,
  flexWrap: "wrap",
};

const selectStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  fontSize: 12,
  background: "#fff",
};

const recordActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
};

const editButtonStyle: React.CSSProperties = {
  background: "#f1f5f9",
  border: "none",
  borderRadius: 6,
  padding: "4px 8px",
  cursor: "pointer",
  fontSize: 12,
  color: "#6366f1",
};

const deleteButtonStyle: React.CSSProperties = {
  background: "#fef2f2",
  border: "none",
  borderRadius: 6,
  padding: "4px 8px",
  cursor: "pointer",
  fontSize: 12,
  color: "#ef4444",
};

const panelStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  padding: 16,
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  marginBottom: 16,
};

const panelTitleStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 14,
  color: "#1e293b",
  marginBottom: 12,
};

const pieWrapStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 16,
};

const legendGridStyle: React.CSSProperties = {
  width: "100%",
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  columnGap: 16,
  rowGap: 4,
};

const legendItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
};

const legendTextStyle: React.CSSProperties = {
  color: "#334155",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const legendPctStyle: React.CSSProperties = {
  marginLeft: "auto",
  color: "#64748b",
};

const categoryRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  marginBottom: 4,
};

const progressTrackStyle: React.CSSProperties = {
  height: 6,
  background: "#f1f5f9",
  borderRadius: 3,
};

const categoryFormStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginBottom: 8,
};

const categoryNameInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  fontSize: 13,
};

const primarySmallButtonStyle: React.CSSProperties = {
  background: "#6366f1",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 14px",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
};

const categoryItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 0",
  borderBottom: "1px solid #f1f5f9",
};

const categoryNameStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 14,
  color: "#1e293b",
};

const defaultBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#94a3b8",
  background: "#f1f5f9",
  borderRadius: 4,
  padding: "2px 6px",
};

const fabStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 24,
  right: 24,
  width: 56,
  height: 56,
  borderRadius: "50%",
  background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
  color: "#fff",
  fontSize: 28,
  border: "none",
  cursor: "pointer",
  boxShadow: "0 4px 16px rgba(99,102,241,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  zIndex: 200,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
};

const modalSheetStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: "20px 20px 0 0",
  padding: 24,
  width: "100%",
  maxWidth: 480,
  paddingBottom: 40,
};

const modalTitleStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 16,
  color: "#1e293b",
  marginBottom: 20,
  textAlign: "center",
};

const typeSelectorStyle: React.CSSProperties = {
  display: "flex",
  background: "#f1f5f9",
  borderRadius: 10,
  padding: 3,
  marginBottom: 16,
};

const typeButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 0",
  borderRadius: 8,
  border: "none",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
};

const fieldStyle: React.CSSProperties = {
  marginBottom: 14,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  marginBottom: 6,
};

const categoryChipsStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const chipStyle: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 20,
  border: "2px solid",
  fontSize: 13,
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  fontSize: 14,
  boxSizing: "border-box",
};

const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "14px 0",
  borderRadius: 12,
  border: "none",
  background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
  color: "#fff",
  fontWeight: 700,
  fontSize: 15,
  cursor: "pointer",
};

export default App;
