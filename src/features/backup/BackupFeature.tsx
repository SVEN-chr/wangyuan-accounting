import { useEffect, useRef, useState } from "react";
import { type LedgerDispatch } from "../../ledgerCommands";
import { todayKey } from "../../ledgerFormat";
import { type LedgerQuery } from "../../ledgerQueries";
import {
  decodeLedgerWorkbook,
  encodeLedgerWorkbook,
} from "../../ledgerWorkbook";
import { deliverLedgerWorkbookFile } from "../../ledgerWorkbookFile";
import { type UpdateState } from "../../updateController";
import { FeatureHeader } from "../../ui/FeatureHeader";
import { formatUpdatePercent } from "../../ui/updateProgress";
import { type BackupStatusControl } from "./useBackupStatus";
import packageJson from "../../../package.json";
import "./backup.css";

type BackupFeatureProps = {
  active: boolean;
  query: LedgerQuery;
  dispatch: LedgerDispatch;
  backupStatus: BackupStatusControl;
  updateState: UpdateState;
  onCheckUpdate: () => void;
  onRunUpdate: () => void;
};

export function BackupFeature({
  active,
  query,
  dispatch,
  backupStatus,
  updateState,
  onCheckUpdate,
  onRunUpdate,
}: BackupFeatureProps) {
  const { records, categories } = query.ledger;
  const [appVersion, setAppVersion] = useState(packageJson.version);
  const [dragging, setDragging] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const filename = `wangyuan-${todayKey()}.xlsx`;
  const sizeEstimate = Math.max(8, Math.round(records.length * 0.55 + 4));

  useEffect(() => {
    void (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        setAppVersion(await getVersion());
      } catch {
        // Browser mode keeps the release fallback.
      }
    })();
  }, []);

  async function exportBackup() {
    const bytes = await encodeLedgerWorkbook(query.ledger);
    const destination = await deliverLedgerWorkbookFile(filename, bytes);
    backupStatus.setStatus({
      type: "success",
      message: `已导出 ${records.length} 条记录到 ${destination}`,
    });
  }

  async function importFromFile(file: File) {
    try {
      const decoded = await decodeLedgerWorkbook(await file.arrayBuffer());
      if (!decoded.ok) {
        backupStatus.setStatus({
          type: "error",
          message: decoded.error.message,
        });
        return;
      }

      const { candidate, diagnostics } = decoded;
      const confirmed = window.confirm(
        `导入会覆盖当前 ${records.length} 条记录、${categories.length} 个分类。确认导入 ${diagnostics.importedRecords} 条记录、${diagnostics.importedCategories} 个分类？`,
      );
      if (!confirmed) {
        backupStatus.setStatus({ type: "idle", message: "" });
        return;
      }
      const result = dispatch({
        type: "import.replace",
        records: candidate.records,
        categories: candidate.categories,
      });
      if (!result.ok) {
        backupStatus.setStatus({
          type: "error",
          message: `导入失败：${result.error.message}`,
        });
        return;
      }
      backupStatus.setStatus({
        type: "success",
        message: `已导入 ${diagnostics.importedRecords} 条记录、${diagnostics.importedCategories} 个分类${
          diagnostics.skippedRecordRows > 0
            ? ` · 跳过 ${diagnostics.skippedRecordRows} 行`
            : ""
        }`,
      });
    } catch {
      backupStatus.setStatus({
        type: "error",
        message: "导入失败：无法读取 Excel 文件",
      });
    }
  }

  async function importBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await importFromFile(file);
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void importFromFile(file);
  }

  return (
    <>
      {active && (
        <>
          <FeatureHeader
            eyebrow="BACKUP · 数 据 备 份"
            title="账 本 备 份 与"
            accent=" 导 入 / 导 出"
            subtitle="数据保存于本机 · 支持 Excel xlsx 格式"
            metrics={[{ label: "本机总记录", value: `${records.length} 笔` }]}
            compact
          />

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
            onClick={() => void exportBackup()}
          >
            ↓ 导出 {filename}
          </button>
          {backupStatus.status.message &&
            backupStatus.status.type !== "idle" && (
              <div className={`v2-backup-status ${backupStatus.status.type}`}>
                {backupStatus.status.message}
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
            onClick={() => importInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
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
              正 在 下 载… {formatUpdatePercent(updateState, "")}
            </div>
          )}
          {updateState.phase === "error" && (
            <div className="v2-backup-status error">{updateState.error}</div>
          )}
        </section>
          </div>
        </>
      )}

      <input
        ref={importInputRef}
        className="v2-file-input-hidden"
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        onChange={(event) => void importBackup(event)}
      />
    </>
  );
}
