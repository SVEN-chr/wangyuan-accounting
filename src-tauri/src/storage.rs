use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::{AppHandle, Manager};

const ACCOUNTING_STORE_FILE: &str = "accounting-data.json";
const WORKSPACE_FOLDER_NAME: &str = "王源专属记账工作台的文件夹";

struct AccountingStorage {
    workspace_dir: PathBuf,
}

impl AccountingStorage {
    fn new(workspace_dir: PathBuf) -> Self {
        Self { workspace_dir }
    }

    fn from_app(app: &AppHandle) -> Result<Self, String> {
        let workspace_dir = app
            .path()
            .desktop_dir()
            .map_err(|error| error.to_string())?
            .join(WORKSPACE_FOLDER_NAME);
        Ok(Self::new(workspace_dir))
    }

    fn load<F>(&self, resolve_legacy_store_path: F) -> Result<String, String>
    where
        F: FnOnce() -> Result<PathBuf, String>,
    {
        let path = self.accounting_store_path()?;
        if let Some(payload) = read_optional(&path)? {
            return Ok(payload);
        }
        let legacy_store_path = resolve_legacy_store_path()?;
        let Some(payload) = read_optional(&legacy_store_path)? else {
            return Ok(String::new());
        };
        atomic_write(&path, payload.as_bytes())?;
        let _ = fs::remove_file(&legacy_store_path);
        Ok(payload)
    }

    fn save(&self, payload: &str) -> Result<(), String> {
        let path = self.accounting_store_path()?;
        atomic_write(&path, payload.as_bytes())
    }

    fn save_backup(&self, filename: &str, bytes: &[u8]) -> Result<PathBuf, String> {
        let dir = self.ensure_workspace_dir()?;
        let path = dir.join(sanitize_backup_filename(filename));
        atomic_write(&path, bytes)?;
        Ok(path)
    }

    fn accounting_store_path(&self) -> Result<PathBuf, String> {
        Ok(self.ensure_workspace_dir()?.join(ACCOUNTING_STORE_FILE))
    }

    fn ensure_workspace_dir(&self) -> Result<&Path, String> {
        fs::create_dir_all(&self.workspace_dir).map_err(|error| error.to_string())?;
        Ok(&self.workspace_dir)
    }
}

fn legacy_accounting_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(dir.join(ACCOUNTING_STORE_FILE))
}

#[tauri::command]
pub(crate) fn load_accounting_store(app: AppHandle) -> Result<String, String> {
    let storage = AccountingStorage::from_app(&app)?;
    storage.load(|| legacy_accounting_store_path(&app))
}

#[tauri::command]
pub(crate) fn save_accounting_store(app: AppHandle, payload: String) -> Result<(), String> {
    AccountingStorage::from_app(&app)?.save(&payload)
}

#[tauri::command]
pub(crate) fn save_excel_backup(
    app: AppHandle,
    filename: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let path = AccountingStorage::from_app(&app)?.save_backup(&filename, &bytes)?;
    Ok(path.to_string_lossy().to_string())
}

fn sanitize_backup_filename(filename: &str) -> String {
    let clean_name = PathBuf::from(filename)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("wangyuan-accounting-backup.xlsx")
        .to_string();
    if clean_name.to_lowercase().ends_with(".xlsx") {
        clean_name
    } else {
        format!("{clean_name}.xlsx")
    }
}

fn read_optional(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "atomic_write: target has no file name".to_string())?;
    // 唯一临时名（进程号 + 进程内自增序号），避免 debounce、关窗 flush 或不同命令
    // 在不同线程上重叠时共用同一个 .tmp。临时文件与目标同目录，保证同卷原子替换。
    let tmp = path.with_file_name(format!(
        "{file_name}.tmp.{}.{}",
        std::process::id(),
        TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let write_result = (|| -> io::Result<()> {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&tmp);
        return Err(error.to_string());
    }
    if let Err(error) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(error.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::AccountingStorage;
    use std::{cell::Cell, fs, path::PathBuf, time::SystemTime};

    fn test_root(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "wangyuan-accounting-{label}-{}-{unique}",
            std::process::id()
        ))
    }

    #[test]
    fn load_migrates_legacy_ledger_into_workspace() {
        let root = test_root("storage-migration");
        let workspace = root.join("workspace");
        let legacy_store = root.join("legacy").join("accounting-data.json");
        fs::create_dir_all(
            legacy_store
                .parent()
                .expect("legacy store should have a parent"),
        )
        .expect("legacy directory should be created");
        fs::write(&legacy_store, br#"{"records":[]}"#).expect("legacy ledger should be written");
        let storage = AccountingStorage::new(workspace.clone());

        let payload = storage
            .load(|| Ok(legacy_store.clone()))
            .expect("legacy ledger should load");

        assert_eq!(payload, r#"{"records":[]}"#);
        assert_eq!(
            fs::read_to_string(workspace.join("accounting-data.json"))
                .expect("migrated ledger should be readable"),
            payload
        );
        assert!(!legacy_store.exists(), "legacy ledger should be removed");

        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn load_does_not_resolve_legacy_path_when_workspace_ledger_exists() {
        let root = test_root("storage-current");
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).expect("workspace should be created");
        fs::write(workspace.join("accounting-data.json"), b"current ledger")
            .expect("current ledger should be written");
        let storage = AccountingStorage::new(workspace);
        let legacy_resolved = Cell::new(false);

        let payload = storage
            .load(|| {
                legacy_resolved.set(true);
                Err("legacy path should stay cold".to_string())
            })
            .expect("current ledger should load without legacy lookup");

        assert_eq!(payload, "current ledger");
        assert!(!legacy_resolved.get(), "legacy lookup should stay cold");

        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn save_replaces_complete_ledger_without_leaving_temp_files() {
        let root = test_root("storage-save");
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).expect("workspace should be created");
        fs::write(workspace.join("accounting-data.json"), b"old ledger")
            .expect("old ledger should be written");
        let storage = AccountingStorage::new(workspace.clone());

        storage
            .save("new complete ledger")
            .expect("ledger save should succeed");

        assert_eq!(
            fs::read(workspace.join("accounting-data.json"))
                .expect("new ledger should be readable"),
            b"new complete ledger"
        );
        let leftovers: Vec<_> = fs::read_dir(&workspace)
            .expect("workspace should be readable")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp."))
            .collect();
        assert!(leftovers.is_empty(), "temporary files should be removed");

        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn save_backup_sanitizes_filename_and_writes_complete_workbook() {
        let root = test_root("storage-backup");
        let workspace = root.join("workspace");
        let storage = AccountingStorage::new(workspace.clone());

        let saved_path = storage
            .save_backup(r"..\..\账本备份", b"complete workbook")
            .expect("backup should be saved");

        assert_eq!(saved_path, workspace.join("账本备份.xlsx"));
        assert_eq!(
            fs::read(saved_path).expect("backup should be readable"),
            b"complete workbook"
        );

        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn failed_atomic_replace_removes_temporary_file() {
        let root = test_root("storage-failed-replace");
        let workspace = root.join("workspace");
        fs::create_dir_all(workspace.join("accounting-data.json"))
            .expect("directory-shaped target should be created");
        let storage = AccountingStorage::new(workspace.clone());

        let result = storage.save("ledger cannot replace a directory");

        assert!(result.is_err(), "directory target should reject rename");
        let leftovers: Vec<_> = fs::read_dir(&workspace)
            .expect("workspace should be readable")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp."))
            .collect();
        assert!(leftovers.is_empty(), "failed write should remove temp file");

        fs::remove_dir_all(root).expect("test directory should be removed");
    }
}
