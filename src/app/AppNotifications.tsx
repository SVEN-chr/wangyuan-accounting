import { type BackupStatusControl } from "../features/backup/useBackupStatus";
import { type UpdateState } from "../updateController";
import { formatUpdatePercent } from "../ui/updateProgress";
import { type PageKey } from "./AppNavigation";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function AppNotifications({
  page,
  backupStatus,
  updateState,
  onCheckUpdate,
  onRunUpdate,
  onDismissUpdate,
}: {
  page: PageKey;
  backupStatus: BackupStatusControl;
  updateState: UpdateState;
  onCheckUpdate: () => void;
  onRunUpdate: () => void;
  onDismissUpdate: () => void;
}) {
  const visibleSaveError =
    backupStatus.status.type === "error" && page !== "backup";
  const visibleUpdate =
    page !== "backup" &&
    (updateState.phase === "available" ||
      updateState.phase === "downloading" ||
      updateState.phase === "error");

  return (
    <>
      {visibleSaveError && (
        <div
          role="alert"
          className="v2-save-toast"
          onClick={() =>
            backupStatus.setStatus({ type: "idle", message: "" })
          }
        >
          <span className="v2-save-toast-stamp">!</span>
          <span className="v2-save-toast-msg">
            {backupStatus.status.message}
          </span>
          <span className="mono v2-save-toast-hint">点击关闭</span>
        </div>
      )}

      {visibleUpdate && (
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
                  onClick={onRunUpdate}
                >
                  立 即 更 新
                </button>
                <button
                  type="button"
                  className="v2-update-btn-ghost"
                  onClick={onDismissUpdate}
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
                  style={{ width: formatUpdatePercent(updateState, "100%") }}
                />
              </div>
              <div className="mono v2-update-progress">
                {updateState.total && updateState.total > 0
                  ? `${formatBytes(updateState.downloaded ?? 0)} / ${formatBytes(
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
                  onClick={
                    updateState.version ? onRunUpdate : onCheckUpdate
                  }
                >
                  重 试
                </button>
                <button
                  type="button"
                  className="v2-update-btn-ghost"
                  onClick={onDismissUpdate}
                >
                  关 闭
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
