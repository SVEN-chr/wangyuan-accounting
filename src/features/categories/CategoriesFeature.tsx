import { useMemo, useState } from "react";
import {
  CATEGORY_SHAPES,
  CATEGORY_SWATCHES,
  DEFAULT_CATEGORY_IDS,
  type Category,
  type CategoryType,
  type CatShape,
  type LedgerCommand,
  type LedgerCommandResult,
} from "../../ledgerCommands";
import { formatMoney } from "../../ledgerFormat";
import {
  type LedgerQuery,
  type LedgerStats,
} from "../../ledgerQueries";
import { CatGlyph } from "../../ui/CatGlyph";
import "./categories.css";

type CategoryForm = {
  name: string;
  type: CategoryType;
  shape: CatShape;
  swatch: string;
};

type LedgerDispatch = (command: LedgerCommand) => LedgerCommandResult;

export function CategoriesFeature({
  query,
  dispatch,
}: {
  query: LedgerQuery;
  dispatch: LedgerDispatch;
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
    dispatch({
      type: "category.create",
      preferredId: Date.now(),
      category: {
        name: form.name,
        type: form.type,
        shape: form.shape,
        swatch: form.swatch,
      },
    });
    setForm({
      name: "",
      type: form.type,
      shape: "square",
      swatch: CATEGORY_SWATCHES[0],
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
    dispatch({ type: "category.delete", id });
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
                      setForm((current) => ({ ...current, type: "expense" }))
                    }
                  >
                    支出
                  </button>
                  <button
                    type="button"
                    className={form.type === "income" ? "active income" : ""}
                    onClick={() =>
                      setForm((current) => ({ ...current, type: "income" }))
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
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  onKeyDown={(event) => event.key === "Enter" && submit()}
                />
              </div>
              <div className="v2-cat-form-field">
                <label>形状</label>
                <div className="v2-cat-shapes">
                  {CATEGORY_SHAPES.map((shape) => (
                    <button
                      key={shape}
                      type="button"
                      className={form.shape === shape ? "active" : ""}
                      onClick={() =>
                        setForm((current) => ({ ...current, shape }))
                      }
                    >
                      <CatGlyph shape={shape} color={form.swatch} size={14} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="v2-cat-form-field">
                <label>颜色</label>
                <div className="v2-cat-colors">
                  {CATEGORY_SWATCHES.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      className={`v2-color-sw ${
                        form.swatch === swatch ? "active" : ""
                      }`}
                      style={{ background: swatch }}
                      onClick={() =>
                        setForm((current) => ({ ...current, swatch }))
                      }
                      aria-label={swatch}
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
                onDelete={deleteCategory}
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
                onDelete={deleteCategory}
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
  stats: LedgerStats;
  countByCat: Record<string, number>;
  onDelete: (id: string) => void;
}) {
  if (cats.length === 0) {
    return <div className="v2-empty">暂无分类</div>;
  }
  return (
    <div className="v2-cat-list-2">
      {cats.map((category) => {
        const amount = stats.byCat[category.id] || 0;
        const count = countByCat[category.id] || 0;
        const isDefault = DEFAULT_CATEGORY_IDS.has(category.id);
        return (
          <div key={category.id} className="v2-cat-card">
            <div className="v2-cat-card-l">
              <CatGlyph
                shape={category.shape}
                color={category.swatch}
                size={20}
              />
              <div>
                <div className="v2-cat-card-name">
                  {category.name}
                  {isDefault && (
                    <span className="v2-cat-card-meta-tag">默认</span>
                  )}
                </div>
                <div className="v2-cat-card-meta">
                  {count} 条记录 · {formatMoney(amount, 0)}
                </div>
              </div>
            </div>
            <div className="v2-cat-card-r">
              {!isDefault && (
                <button
                  className="v2-cat-action danger mono"
                  type="button"
                  onClick={() => onDelete(category.id)}
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
