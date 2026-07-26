import { useMemo, useState } from "react";
import "./styles/theme.css";
import "./styles/base.css";
import "./ui/shared.css";
import "./App.css";
import { AppNavigation, type PageKey } from "./app/AppNavigation";
import { AppNotifications } from "./app/AppNotifications";
import { SAMPLE_RECORDS } from "./app/sampleRecords";
import { BackupFeature } from "./features/backup/BackupFeature";
import { useBackupStatus } from "./features/backup/useBackupStatus";
import { CategoriesFeature } from "./features/categories/CategoriesFeature";
import { LedgerFeature } from "./features/ledger/LedgerFeature";
import { StatsFeature } from "./features/stats/StatsFeature";
import { createLedgerQuery } from "./ledgerQueries";
import { useRuntimeLedgerSession } from "./useLedgerSession";
import { useRuntimeUpdateController } from "./useUpdateController";

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
  const [page, setPage] = useState<PageKey>("ledger");
  const [ledgerAddOpen, setLedgerAddOpen] = useState(false);
  const backupStatus = useBackupStatus(saveStatus);
  const query = useMemo(() => createLedgerQuery(ledger), [ledger]);

  return (
    <div className="v2-root">
      <AppNavigation
        page={page}
        onPage={setPage}
        onAddEntry={() => setLedgerAddOpen(true)}
      />

      <AppNotifications
        page={page}
        backupStatus={backupStatus}
        updateState={updateState}
        onCheckUpdate={() => void checkForUpdate(true)}
        onRunUpdate={() => void runUpdate()}
        onDismissUpdate={dismissUpdate}
      />

      <LedgerFeature
        active={page === "ledger"}
        query={query}
        dispatch={dispatchLedger}
        addOpen={ledgerAddOpen}
        onAddClose={() => setLedgerAddOpen(false)}
      />

      {page === "stats" && <StatsFeature query={query} />}

      {page === "cats" && (
        <CategoriesFeature query={query} dispatch={dispatchLedger} />
      )}

      <BackupFeature
        active={page === "backup"}
        query={query}
        dispatch={dispatchLedger}
        backupStatus={backupStatus}
        updateState={updateState}
        onCheckUpdate={() => void checkForUpdate(true)}
        onRunUpdate={() => void runUpdate()}
      />
    </div>
  );
}

export default App;
