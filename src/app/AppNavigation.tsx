export type PageKey = "ledger" | "stats" | "cats" | "backup";

export function AppNavigation({
  page,
  onPage,
  onAddEntry,
}: {
  page: PageKey;
  onPage: (page: PageKey) => void;
  onAddEntry: () => void;
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
        ).map(([key, label]) => (
          <button
            key={key}
            className={page === key ? "active" : ""}
            onClick={() => onPage(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="v2-top-actions">
        <button className="v2-btn-ghost mono" type="button" aria-label="快捷搜索">
          ⌘ K
        </button>
        <button className="v2-btn-primary" type="button" onClick={onAddEntry}>
          + 记一笔
        </button>
      </div>
    </header>
  );
}
