import { useMemo } from "react";
import {
  formatCompactAmount,
  formatMoney,
  todayKey,
} from "../../ledgerFormat";
import type { BreakdownItem, LedgerQuery } from "../../ledgerQueries";
import { CatGlyph } from "../../ui/CatGlyph";
import { FeatureHeader } from "../../ui/FeatureHeader";
import "./stats.css";

const DOW_LABEL = ["日", "一", "二", "三", "四", "五", "六"];

function netColor(net: number): string {
  if (net > 0) return "var(--v2-olive)";
  if (net < 0) return "var(--v2-terra-deep)";
  return "var(--v2-paper)";
}

function netY(net: number, maxNet: number): number {
  return net >= 0
    ? 200 - (net / maxNet) * 120
    : 200 + (-net / maxNet) * 70;
}

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
      {items.map((category) => {
        const percent = (category.amount / total) * 100;
        return (
          <div key={category.id} className="v2-stats-bar">
            <div className="v2-stats-bar-head">
              <span>
                <CatGlyph
                  shape={category.shape}
                  color={category.swatch}
                  size={10}
                />
                {category.name}
              </span>
              <span className="mono">
                {formatMoney(category.amount, 0)}
              </span>
            </div>
            <div className="v2-stats-bar-track">
              <div
                className="v2-stats-bar-fill"
                style={{
                  width: `${percent}%`,
                  background: category.swatch,
                }}
              />
              <span className="mono v2-stats-pct">
                {percent.toFixed(1)}%
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

export function StatsFeature({ query }: { query: LedgerQuery }) {
  const referenceDay = todayKey();
  const report = useMemo(
    () => query.statistics(referenceDay),
    [query, referenceDay],
  );
  const expenseBreakdown = report.breakdowns.expense;
  const incomeBreakdown = report.breakdowns.income;
  const monthSeries = report.monthSeries;
  const maxMonthValue = report.maxMonthValue;
  const maxNet = report.maxNet;
  const incomeStats = report.income;
  const weekdayExpenses = report.expenseByWeekday;

  return (
    <>
      <FeatureHeader
        eyebrow="STATS · 统 计 报 告"
        title="财 务 体 检 ·"
        accent={` ${report.referenceMonth.slice(5)} 月`}
        subtitle="六个月趋势 · 分类构成 · 周内分布"
        metrics={[
          {
            label: "储蓄率",
            value: `${Math.round(report.savingRate)}%`,
            positive: true,
          },
          {
            label: "收支比",
            value: report.incomeExpenseRatio.toFixed(2),
          },
        ]}
        compact
      />

      <div className="v2-body single">
        <main className="v2-main">
          <section className="v2-chart-card">
            <div className="v2-card-head">
              <div>
                <h3>六 个 月 收 支 走 势</h3>
                <div className="mono">
                  {monthSeries[0].key} → {monthSeries[5].key} · MoM
                </div>
              </div>
              <div className="v2-legend">
                <span>
                  <span className="dot income" /> 收入
                </span>
                <span>
                  <span className="dot expense" /> 支出
                </span>
                <span
                  style={{ marginLeft: 12, color: "var(--v2-terra-deep)" }}
                >
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
                {[0, 0.25, 0.5, 0.75, 1].map((position, index) => (
                  <line
                    key={index}
                    x1="40"
                    x2="800"
                    y1={20 + position * 180}
                    y2={20 + position * 180}
                    stroke="var(--v2-rule)"
                    strokeDasharray="3 4"
                    strokeWidth="0.5"
                  />
                ))}
                <line
                  x1="40"
                  x2="800"
                  y1="200"
                  y2="200"
                  stroke="var(--v2-terra-deep)"
                  strokeWidth="1"
                  opacity="0.35"
                />
                <line
                  x1="40"
                  x2="800"
                  y1="245"
                  y2="245"
                  stroke="var(--v2-rule)"
                  strokeDasharray="3 4"
                  strokeWidth="0.5"
                />
                {monthSeries.map((month, index) => {
                  const x = 80 + index * 130;
                  const incomeHeight =
                    (month.income / maxMonthValue) * 180;
                  const expenseHeight =
                    (month.expense / maxMonthValue) * 180;
                  const incomeRatio = month.income / maxMonthValue;
                  const expenseRatio = month.expense / maxMonthValue;
                  return (
                    <g key={month.key}>
                      <rect
                        x={x - 22}
                        y={200 - incomeHeight}
                        width="20"
                        height={incomeHeight}
                        fill="var(--v2-olive)"
                      />
                      <rect
                        x={x + 2}
                        y={200 - expenseHeight}
                        width="20"
                        height={expenseHeight}
                        fill="var(--v2-terra)"
                      />
                      {incomeRatio > 0.04 && (
                        <text
                          x={x - 12}
                          y={200 - incomeHeight - 6}
                          fontSize="10"
                          fill="var(--v2-olive)"
                          textAnchor="middle"
                          style={{ fontFamily: "var(--v2-mono)" }}
                        >
                          {formatCompactAmount(month.income)}
                        </text>
                      )}
                      {expenseRatio > 0.04 && (
                        <text
                          x={x + 12}
                          y={200 - expenseHeight - 6}
                          fontSize="10"
                          fill="var(--v2-terra)"
                          textAnchor="middle"
                          style={{ fontFamily: "var(--v2-mono)" }}
                        >
                          {formatCompactAmount(month.expense)}
                        </text>
                      )}
                    </g>
                  );
                })}
                <path
                  d={monthSeries
                    .map((month, index) => {
                      const x = 80 + index * 130;
                      const y = netY(month.net, maxNet);
                      return `${index === 0 ? "M" : "L"}${x},${y}`;
                    })
                    .join(" ")}
                  fill="none"
                  stroke="var(--v2-terra-deep)"
                  strokeWidth="2"
                />
                {monthSeries.map((month, index) => {
                  const x = 80 + index * 130;
                  const y = netY(month.net, maxNet);
                  return (
                    <circle
                      key={month.key}
                      cx={x}
                      cy={y}
                      r="4"
                      fill={netColor(month.net)}
                      stroke="var(--v2-terra-deep)"
                      strokeWidth="2"
                    >
                      <title>
                        {month.key} 净结余 {month.net >= 0 ? "+" : "−"}
                        {formatCompactAmount(Math.abs(month.net))}
                      </title>
                    </circle>
                  );
                })}
                {monthSeries.map((month, index) => {
                  const x = 80 + index * 130;
                  return (
                    <text
                      key={month.key}
                      x={x}
                      y="282"
                      fontSize="11"
                      fill="var(--v2-ink-soft)"
                      textAnchor="middle"
                      style={{ fontFamily: "var(--v2-mono)" }}
                    >
                      {month.key.slice(5)}月
                    </text>
                  );
                })}
              </svg>
            </div>
          </section>

          <section className="v2-charts even">
            <div className="v2-chart-card">
              <div className="v2-card-head">
                <div>
                  <h3>支 出 构 成</h3>
                  <div className="mono">
                    EXPENSE · {expenseBreakdown.items.length} 类
                  </div>
                </div>
              </div>
              <div className="v2-stats-bars">
                <BreakdownBars
                  items={expenseBreakdown.items}
                  total={expenseBreakdown.total}
                  emptyText="暂无支出数据"
                />
              </div>
            </div>

            <div className="v2-chart-card">
              <div className="v2-card-head">
                <div>
                  <h3>收 入 构 成</h3>
                  <div className="mono">
                    INCOME · {incomeBreakdown.items.length} 类
                  </div>
                </div>
              </div>
              <div className="v2-stats-bars">
                <BreakdownBars
                  items={incomeBreakdown.items}
                  total={incomeBreakdown.total}
                  emptyText="暂无收入数据"
                />
              </div>
              {incomeBreakdown.items.length > 0 && (
                <div className="v2-stats-side">
                  <div className="v2-stats-side-row">
                    <span className="mono">最大单笔收入</span>
                    <span>
                      {incomeStats.maxEntry
                        ? `${query.category(incomeStats.maxEntry.catId).name} · ${formatMoney(incomeStats.maxEntry.amount, 0)}`
                        : "—"}
                    </span>
                  </div>
                  <div className="v2-stats-side-row">
                    <span className="mono">平均单笔收入</span>
                    <span>{formatMoney(incomeStats.mean, 0)}</span>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="v2-chart-card">
            <div className="v2-card-head">
              <div>
                <h3>周 内 支 出 分 布</h3>
                <div className="mono">BY DAY OF WEEK</div>
              </div>
              <div className="mono">
                周{DOW_LABEL[weekdayExpenses.peakIndex]} 支出最高
              </div>
            </div>
            <div className="v2-dow">
              {weekdayExpenses.values.map((amount, index) => {
                const height = (amount / weekdayExpenses.max) * 140;
                return (
                  <div key={index} className="v2-dow-col">
                    <div className="v2-dow-bar-wrap">
                      <span className="mono v2-dow-amt">
                        {formatMoney(amount, 0)}
                      </span>
                      <div
                        className="v2-dow-bar"
                        style={{ height }}
                      />
                    </div>
                    <div className="v2-dow-label">
                      周 {DOW_LABEL[index]}
                    </div>
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
