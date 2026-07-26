import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  DEFAULT_CATEGORIES,
  type Category,
  type CategoryType,
  type LedgerDispatch,
  type LedgerEntry,
} from "../../ledgerCommands";
import {
  addDaysKey,
  clampDateKey,
  dateKey,
  formatAmount,
  formatCompactAmount,
  formatMoney,
  monthKey,
  splitMoney,
  todayKey,
  weekdayCN,
} from "../../ledgerFormat";
import {
  type LedgerEntryFilter,
  type LedgerQuery,
} from "../../ledgerQueries";
import { CatGlyph } from "../../ui/CatGlyph";
import { FeatureHeader } from "../../ui/FeatureHeader";
import "./ledger.css";

type RecordForm = {
  type: CategoryType;
  catId: string;
  amount: string;
  date: string;
  note: string;
};

type LedgerFeatureProps = {
  active: boolean;
  query: LedgerQuery;
  dispatch: LedgerDispatch;
  addOpen: boolean;
  onAddClose: () => void;
};

const ENTRIES_PER_PAGE = 12;
const HEAT_WINDOW_DAYS = 42;
const HEAT_COLORS: Array<[number, string]> = [
  [0.5, "#7C3A0E"],
  [0.25, "#C6701D"],
  [0.05, "#E8B97A"],
];
const HEAT_BASE = "#F5E6CC";
const HEAT_LEGEND = [
  HEAT_BASE,
  ...[...HEAT_COLORS].reverse().map(([, color]) => color),
];

function heatColor(intensity: number): string {
  for (const [threshold, color] of HEAT_COLORS) {
    if (intensity > threshold) return color;
  }
  return HEAT_BASE;
}

function timeGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return "凌晨好";
  if (hour < 9) return "早上好";
  if (hour < 12) return "上午好";
  if (hour < 14) return "中午好";
  if (hour < 17) return "下午好";
  if (hour < 19) return "傍晚好";
  return "晚上好";
}

function createInitialForm(
  categories: Category[],
  type: CategoryType = "expense",
): RecordForm {
  const category =
    categories.find((candidate) => candidate.type === type) ?? categories[0];
  return {
    type: category?.type ?? type,
    catId: category?.id ?? "",
    amount: "",
    date: todayKey(),
    note: "",
  };
}

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

export function LedgerFeature({
  active,
  query,
  dispatch,
  addOpen,
  onAddClose,
}: LedgerFeatureProps) {
  const [editId, setEditId] = useState<number | null>(null);
  const [entryFilter, setEntryFilter] =
    useState<LedgerEntryFilter>("all");
  const [form, setForm] = useState<RecordForm>(() =>
    createInitialForm(DEFAULT_CATEGORIES),
  );
  const [pendingDelete, setPendingDelete] = useState<LedgerEntry | null>(null);

  useLayoutEffect(() => {
    if (!addOpen) return;
    setForm(createInitialForm(query.ledger.categories));
    setEditId(null);
  }, [addOpen, query.ledger.categories]);

  function openEditModal(entry: LedgerEntry) {
    const category = query.category(entry.catId);
    setForm({
      type: category.type,
      catId: entry.catId,
      amount: String(entry.amount),
      date: entry.date,
      note: entry.note ?? "",
    });
    setEditId(entry.id);
  }

  function closeRecordModal() {
    setEditId(null);
    onAddClose();
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
        ? dispatch({ type: "entry.update", id: editId, entry })
        : dispatch({
            type: "entry.create",
            preferredId: Date.now(),
            entry,
          });
    if (result.ok) closeRecordModal();
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const result = dispatch({
      type: "entry.delete",
      id: pendingDelete.id,
    });
    if (result.ok) setPendingDelete(null);
  }

  return (
    <>
      {active && (
        <LedgerPage
          query={query}
          dispatch={dispatch}
          entryFilter={entryFilter}
          setEntryFilter={setEntryFilter}
          onEdit={openEditModal}
          onDelete={setPendingDelete}
        />
      )}

      {(addOpen || editId !== null) && (
        <NewRecordModal
          form={form}
          setForm={setForm}
          categories={query.ledger.categories}
          isEdit={editId !== null}
          onClose={closeRecordModal}
          onSave={saveRecord}
        />
      )}

      {pendingDelete && (
        <DeleteConfirmModal
          record={pendingDelete}
          category={query.category(pendingDelete.catId)}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </>
  );
}

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
  const startValueRef = useRef(0);
  const targetRef = useRef(value);

  useEffect(() => {
    startedRef.current = null;
    startValueRef.current = shown;
    targetRef.current = value;
    let animationFrame = 0;
    const tick = (time: number) => {
      if (startedRef.current == null) startedRef.current = time;
      const progress = Math.min(
        1,
        (time - startedRef.current) / duration,
      );
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue =
        startValueRef.current +
        (targetRef.current - startValueRef.current) * eased;
      setShown(nextValue);
      if (progress < 1) animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  const [integerPart, decimalPart] = splitMoney(shown);
  return (
    <span className={className}>
      <span className="cu-prefix">{prefix}</span>
      <span className="cu-int">{integerPart}</span>
      <span className="cu-dec">{decimalPart}</span>
    </span>
  );
}

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
    <FeatureHeader
      eyebrow={`${dateText} · 周${weekdayCN(date)}`}
      title={`${timeGreeting(date).split("").join(" ")}，`}
      accent="王 源"
      subtitle={`今日已记 ${recordedToday} 笔 · 距月末 ${daysToMonthEnd} 日 · ${note}`}
      metrics={[
        { label: "今日支出", value: formatMoney(todayExpense) },
        {
          label: "本周净流入",
          value: `${weekNet >= 0 ? "+" : "−"}${formatMoney(
            Math.abs(weekNet),
            0,
          )}`,
          positive: weekNet >= 0,
        },
      ]}
    />
  );
}

function OpeningBalanceRow({
  value,
  onChange,
}: {
  value: number;
  onChange: (nextValue: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  function commit() {
    const cleaned = draft.replace(/[^\d.-]/g, "");
    const nextValue = Number(cleaned);
    if (cleaned !== "" && Number.isFinite(nextValue)) onChange(nextValue);
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
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
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
      <span className="v2-rec-num mono">{formatAmount(value)}</span>
    </div>
  );
}

function LedgerPage({
  query,
  dispatch,
  entryFilter,
  setEntryFilter,
  onEdit,
  onDelete,
}: {
  query: LedgerQuery;
  dispatch: LedgerDispatch;
  entryFilter: LedgerEntryFilter;
  setEntryFilter: (filter: LedgerEntryFilter) => void;
  onEdit: (entry: LedgerEntry) => void;
  onDelete: (entry: LedgerEntry) => void;
}) {
  const { openingBalance } = query.ledger;
  const { stats } = query;
  const getCategory = query.category;
  const now = new Date();
  const currentTodayKey = dateKey(now);
  const currentMonthKey = monthKey(now);
  const [heatEnd, setHeatEnd] = useState(currentTodayKey);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [entryPage, setEntryPage] = useState(1);

  const filteredEntries = useMemo(
    () => query.entries(entryFilter, currentMonthKey),
    [query, entryFilter, currentMonthKey],
  );
  const dateBounds = useMemo(
    () => query.dateBounds(currentTodayKey),
    [query, currentTodayKey],
  );

  useEffect(() => {
    setEntryPage(1);
  }, [entryFilter, selectedDay]);

  useEffect(() => {
    setHeatEnd((end) =>
      clampDateKey(end, dateBounds.min, dateBounds.max),
    );
  }, [dateBounds]);

  const overview = useMemo(
    () => query.ledgerOverview(currentTodayKey),
    [query, currentTodayKey],
  );
  const dailyAggregates = {
    todayExpense: overview.today.expense,
    weekNet: overview.weekNet,
    recordedToday: overview.today.entryCount,
    incomeCount: overview.entryCounts.income,
    expenseCount: overview.entryCounts.expense,
  };
  const monthSequence = overview.monthSeries.map((month) => month.key);
  const expenseBreakdown = useMemo(
    () => query.breakdown("expense"),
    [query],
  );
  const heatDays = useMemo(
    () => query.heatmap(heatEnd, HEAT_WINDOW_DAYS),
    [query, heatEnd],
  );
  const dayEntries = useMemo(
    () => (selectedDay ? query.entriesOnDay(selectedDay) : null),
    [query, selectedDay],
  );
  const displayEntries = selectedDay
    ? (dayEntries as LedgerEntry[])
    : filteredEntries;
  const totalPages = Math.max(
    1,
    Math.ceil(displayEntries.length / ENTRIES_PER_PAGE),
  );
  const safePage = Math.min(entryPage, totalPages);
  const pageStart = (safePage - 1) * ENTRIES_PER_PAGE;
  const pageEntries = displayEntries.slice(
    pageStart,
    pageStart + ENTRIES_PER_PAGE,
  );

  const previousHeatDisabled = heatEnd <= dateBounds.min;
  const nextHeatDisabled = heatEnd >= dateBounds.max;
  const goToPreviousHeatWindow = () =>
    setHeatEnd((end) =>
      clampDateKey(
        addDaysKey(end, -HEAT_WINDOW_DAYS),
        dateBounds.min,
        dateBounds.max,
      ),
    );
  const goToNextHeatWindow = () =>
    setHeatEnd((end) =>
      clampDateKey(
        addDaysKey(end, HEAT_WINDOW_DAYS),
        dateBounds.min,
        dateBounds.max,
      ),
    );

  const currentMonth = overview.currentMonth;
  const stampDate = currentTodayKey.replace(/-/g, " / ");
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
        note={overview.trendNote}
      />

      <div className="v2-body">
        <aside className="v2-receipt">
          <div className="v2-receipt-perf top" />
          <div className="v2-receipt-head">
            <div className="mono v2-rec-no">N° {currentTodayKey}</div>
            <div className="v2-rec-title">月 度 凭 单</div>
            <div className="mono v2-rec-sub">MONTHLY SUMMARY</div>
          </div>
          <div className="v2-receipt-rows">
            <OpeningBalanceRow
              value={openingBalance}
              onChange={(value) =>
                dispatch({ type: "opening-balance.set", value })
              }
            />
            <div className="v2-rec-row income">
              <span className="mono">+ 收入</span>
              <span className="v2-rec-num mono">
                {formatAmount(currentMonth.income)}
              </span>
            </div>
            <div className="v2-rec-row expense">
              <span className="mono">− 支出</span>
              <span className="v2-rec-num mono">
                {formatAmount(currentMonth.expense)}
              </span>
            </div>
            <div className="v2-rec-rule" />
            <div className="v2-rec-row total">
              <span>结 余</span>
              <span className="v2-rec-num mono">
                {formatAmount(currentMonth.balanceWithOpening)}
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

        <main className="v2-main">
          <section className="v2-stats">
            <article className="v2-stat-card big">
              <div className="v2-stat-label mono">
                本月结余 · NET BALANCE
              </div>
              <div className="v2-stat-value">
                <CountUp
                  value={overview.currentMonth.net}
                  className="v2-bignum"
                />
              </div>
              <div className="v2-stat-trend">
                {overview.monthOverMonthPercent === null ? (
                  <span className="mono">无 上 月 数 据</span>
                ) : (
                  <>
                    <span
                      className={`v2-trend-pill ${
                        overview.monthOverMonthPercent < 0 ? "down" : ""
                      }`}
                    >
                      {overview.monthOverMonthPercent >= 0 ? "▲" : "▼"}{" "}
                      {Math.abs(
                        overview.monthOverMonthPercent,
                      ).toFixed(1)}
                      %
                    </span>
                    <span className="mono">较 上 月</span>
                  </>
                )}
              </div>
            </article>
            <article className="v2-stat-card">
              <div className="v2-stat-label mono">收入 · INCOME</div>
              <CountUp
                value={stats.income}
                className="v2-midnum income-c"
              />
              <div className="v2-stat-foot mono">
                {dailyAggregates.incomeCount} 笔
              </div>
            </article>
            <article className="v2-stat-card">
              <div className="v2-stat-label mono">支出 · EXPENSE</div>
              <CountUp
                value={stats.expense}
                className="v2-midnum expense-c"
              />
              <div className="v2-stat-foot mono">
                {dailyAggregates.expenseCount} 笔
              </div>
            </article>
          </section>

          <section className="v2-charts">
            <div className="v2-chart-card">
              <div className="v2-card-head">
                <div>
                  <h3>收 支 走 势</h3>
                  <div className="mono">
                    {monthSequence[0]} ~{" "}
                    {monthSequence[monthSequence.length - 1]} · 6 MO
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
                {overview.monthSeries.map((month) => (
                  <div key={month.key} className="v2-bar-group">
                    <div className="v2-bars">
                      <div
                        className="v2-bar income"
                        style={{
                          height: `${
                            (month.income / overview.maxMonthValue) * 100
                          }%`,
                        }}
                      >
                        {month.income > 0 && (
                          <span className="v2-bar-tip mono">
                            {formatCompactAmount(month.income)}
                          </span>
                        )}
                      </div>
                      <div
                        className="v2-bar expense"
                        style={{
                          height: `${
                            (month.expense / overview.maxMonthValue) * 100
                          }%`,
                        }}
                      >
                        {month.expense > 0 && (
                          <span className="v2-bar-tip mono">
                            {formatCompactAmount(month.expense)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="v2-bar-label mono">
                      {month.key.slice(5)}月
                    </div>
                  </div>
                ))}
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
                    let offset = 0;
                    return expenseBreakdown.items.map((category) => {
                      const fraction =
                        category.amount / expenseBreakdown.total;
                      const length = fraction * 276.46;
                      const dashArray = `${Math.max(0, length - 2)} ${
                        276.46 - length + 2
                      }`;
                      const dashOffset = -offset;
                      offset += length;
                      return (
                        <circle
                          key={category.id}
                          cx="60"
                          cy="60"
                          r="44"
                          fill="none"
                          stroke={category.swatch}
                          strokeWidth="14"
                          strokeDasharray={dashArray}
                          strokeDashoffset={dashOffset}
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
                    data-len={
                      formatCompactAmount(expenseBreakdown.total).length
                    }
                  >
                    {formatCompactAmount(expenseBreakdown.total)}
                  </div>
                </div>
              </div>
              <div className="v2-donut-legend">
                {expenseBreakdown.items.slice(0, 5).map((category) => (
                  <div key={category.id} className="v2-leg-row">
                    <CatGlyph
                      shape={category.shape}
                      color={category.swatch}
                      size={10}
                    />
                    <span className="v2-leg-name">{category.name}</span>
                    <span className="v2-leg-pct">
                      {(
                        (category.amount / expenseBreakdown.total) *
                        100
                      ).toFixed(0)}
                      %
                    </span>
                    <span className="v2-leg-amt">
                      {formatMoney(category.amount, 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="v2-heat-card">
            <div className="v2-card-head">
              <div>
                <h3>每 日 支 出 强 度</h3>
                <div className="mono">
                  {heatDays.days[0].date} –{" "}
                  {heatDays.days[HEAT_WINDOW_DAYS - 1].date} · 点 击 查 看
                  当 日
                </div>
              </div>
              <div className="v2-heat-scale mono">
                少
                {HEAT_LEGEND.map((color) => (
                  <span
                    key={color}
                    className="v2-heat-cell"
                    style={{ background: color }}
                  />
                ))}
                多
              </div>
            </div>
            <div className="v2-heat-nav">
              <button
                type="button"
                onClick={goToPreviousHeatWindow}
                disabled={previousHeatDisabled}
                aria-label="上一段"
              >
                ←
              </button>
              <button
                type="button"
                onClick={goToNextHeatWindow}
                disabled={nextHeatDisabled}
                aria-label="下一段"
              >
                →
              </button>
              <button
                type="button"
                onClick={() => setHeatEnd(currentTodayKey)}
                disabled={heatEnd === currentTodayKey}
              >
                回到今天
              </button>
              <input
                type="date"
                className="v2-heat-date mono"
                value={heatEnd}
                min={dateBounds.min}
                max={dateBounds.max}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  setHeatEnd(
                    clampDateKey(value, dateBounds.min, dateBounds.max),
                  );
                  setSelectedDay(value);
                }}
              />
            </div>
            <div className="v2-heat-grid">
              {heatDays.days.map((day) => {
                const intensity = day.value / heatDays.max;
                const selected = day.date === selectedDay;
                return (
                  <div
                    key={day.date}
                    className={`v2-heat-cell-big${
                      selected ? " selected" : ""
                    }`}
                    style={
                      {
                        background: heatColor(intensity),
                      } as CSSProperties
                    }
                    title={`${day.date} · ${formatMoney(day.value, 0)}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedDay(day.date)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" ||
                        event.key === " "
                      ) {
                        event.preventDefault();
                        setSelectedDay(day.date);
                      }
                    }}
                  >
                    <span className="mono">{day.date.slice(8)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="v2-entries">
            <div className="v2-card-head">
              <div>
                <h3>{selectedDay ? "当 日 账 目" : "近 期 账 目"}</h3>
                <div className="mono">
                  {selectedDay
                    ? `${selectedDay} · 周${weekdayCN(
                        selectedDay,
                      )} · ${displayEntries.length} 笔`
                    : `RECENT ENTRIES · ${displayEntries.length}`}
                </div>
              </div>
              {selectedDay ? (
                <div className="v2-filters">
                  <button
                    type="button"
                    onClick={() => setSelectedDay(null)}
                  >
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
                  ).map(([filter, label]) => (
                    <button
                      key={filter}
                      className={
                        entryFilter === filter ? "active" : ""
                      }
                      onClick={() => setEntryFilter(filter)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="v2-entries-list">
              {displayEntries.length === 0 && (
                <div className="v2-empty">
                  {selectedDay ? "这一天没有记录" : "暂无记录"}
                </div>
              )}
              {pageEntries.map((entry, index) => {
                const category = getCategory(entry.catId);
                const isIncome = category.type === "income";
                return (
                  <div key={entry.id} className="v2-entry">
                    <div className="v2-entry-no mono">
                      {String(pageStart + index + 1).padStart(3, "0")}
                    </div>
                    <div className="v2-entry-date">
                      <div className="d">{entry.date.slice(8)}</div>
                      <div className="m">{entry.date.slice(5, 7)}月</div>
                    </div>
                    <div className="v2-entry-cat">
                      <CatGlyph
                        shape={category.shape}
                        color={category.swatch}
                        size={14}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div className="v2-entry-name">{category.name}</div>
                        <div className="v2-entry-note">
                          {entry.note || "—"}
                        </div>
                      </div>
                    </div>
                    <div className="v2-entry-tag">
                      {isIncome ? "INCOME" : "EXPENSE"}
                    </div>
                    <div
                      className={`v2-entry-amt ${
                        isIncome ? "income-c" : "expense-c"
                      }`}
                    >
                      {isIncome ? "+" : "−"}
                      {formatAmount(entry.amount)}
                    </div>
                    <div className="v2-entry-actions">
                      <button
                        onClick={() => onEdit(entry)}
                        type="button"
                      >
                        编辑
                      </button>
                      <button
                        className="danger"
                        onClick={() => onDelete(entry)}
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
                  onClick={() =>
                    setEntryPage(Math.max(1, safePage - 1))
                  }
                  disabled={safePage <= 1}
                >
                  上一页
                </button>
                <span className="mono v2-pager-info">
                  第 {safePage} / {totalPages} 页 · 共{" "}
                  {displayEntries.length} 笔
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setEntryPage(Math.min(totalPages, safePage + 1))
                  }
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

function NewRecordModal({
  form,
  setForm,
  categories,
  isEdit,
  onClose,
  onSave,
}: {
  form: RecordForm;
  setForm: Dispatch<SetStateAction<RecordForm>>;
  categories: Category[];
  isEdit: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const availableCategories = categories.filter(
    (category) => category.type === form.type,
  );
  const onEnterSave = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") onSave();
  };

  function setType(type: CategoryType) {
    const firstCategory = categories.find(
      (category) => category.type === type,
    );
    setForm((current) => ({
      ...current,
      type,
      catId: firstCategory?.id ?? "",
    }));
  }

  function enterAmountKey(key: string) {
    setForm((current) => {
      let amount = current.amount;
      if (key === "⌫") {
        amount = amount.slice(0, -1);
      } else if (key === ".") {
        if (!amount.includes(".")) amount = (amount || "0") + ".";
      } else {
        amount = (amount + key).replace(/^0(\d)/, "$1");
      }
      return { ...current, amount };
    });
  }

  const [recordNumberSuffix] = useState(() =>
    String(Math.floor(Math.random() * 900) + 100),
  );
  const recordNumber = `${form.date}-${recordNumberSuffix}`;

  return (
    <div className="v2-modal-stage" role="dialog" aria-modal="true">
      <div className="v2-modal-bg" onClick={onClose} />
      <div className="v2-modal-card">
        <div className="v2-modal-perf top" />
        <div className="v2-modal-head">
          <div>
            <div className="mono">
              {isEdit ? "EDIT ENTRY" : "NEW ENTRY"} · No. {recordNumber}
            </div>
            <h2 className="v2-modal-h">
              {isEdit ? "编 辑 记 录" : "新 增 记 录"}
            </h2>
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
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                amount: event.target.value.replace(/[^\d.]/g, ""),
              }))
            }
            onKeyDown={onEnterSave}
            inputMode="decimal"
          />
          <div className="v2-modal-pad">
            {[
              "7",
              "8",
              "9",
              "4",
              "5",
              "6",
              "1",
              "2",
              "3",
              ".",
              "0",
              "⌫",
            ].map((key) => (
              <button
                key={key}
                type="button"
                className="v2-pad-key"
                onClick={() => enterAmountKey(key)}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        <div className="v2-modal-section">
          <div className="v2-modal-label">分 类</div>
          <div className="v2-modal-cats">
            {availableCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`v2-modal-cat ${
                  form.catId === category.id ? "active" : ""
                }`}
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    catId: category.id,
                  }))
                }
              >
                <CatGlyph
                  shape={category.shape}
                  color={category.swatch}
                  size={14}
                />
                <span>{category.name}</span>
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
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    date: event.target.value,
                  }))
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
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  note: event.target.value,
                }))
              }
              onKeyDown={onEnterSave}
            />
          </div>
        </div>

        <div className="v2-modal-rule" />

        <div className="v2-modal-footer">
          <button
            type="button"
            className="v2-btn-ghost mono"
            onClick={onClose}
          >
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

function DeleteConfirmModal({
  record,
  category,
  onCancel,
  onConfirm,
}: {
  record: LedgerEntry;
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
          <dd className="mono">{formatMoney(record.amount)}</dd>
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
          <button
            type="button"
            className="v2-btn-ghost mono"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="v2-btn-primary"
            onClick={onConfirm}
          >
            确 认 删 除
          </button>
        </div>
        <div className="v2-modal-perf bottom" />
      </div>
    </div>
  );
}
