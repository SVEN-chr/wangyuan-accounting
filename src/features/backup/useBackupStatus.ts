import { useEffect, useState } from "react";
import { type LedgerSaveStatus } from "../../ledgerSession";

export type BackupStatus = {
  type: "idle" | "success" | "error";
  message: string;
};

export type BackupStatusControl = {
  status: BackupStatus;
  setStatus: (status: BackupStatus) => void;
};

export function useBackupStatus(
  saveStatus: LedgerSaveStatus,
): BackupStatusControl {
  const [status, setStatus] = useState<BackupStatus>({
    type: "idle",
    message: "",
  });

  useEffect(() => {
    if (saveStatus.type !== "error") return;
    setStatus({ type: "error", message: saveStatus.message });
  }, [saveStatus]);

  return { status, setStatus };
}
