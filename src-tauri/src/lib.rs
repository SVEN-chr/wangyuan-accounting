use std::{fs, io, path::PathBuf};

use tauri::{AppHandle, Manager};

const ACCOUNTING_STORE_FILE: &str = "accounting-data.json";
const WORKSPACE_FOLDER_NAME: &str = "王源专属记账工作台的文件夹";

fn accounting_workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .desktop_dir()
        .map_err(|error| error.to_string())?
        .join(WORKSPACE_FOLDER_NAME);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn accounting_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = accounting_workspace_dir(app)?;
    Ok(dir.join(ACCOUNTING_STORE_FILE))
}

fn legacy_accounting_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    Ok(dir.join(ACCOUNTING_STORE_FILE))
}

fn read_optional(path: &PathBuf) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn load_accounting_store(app: AppHandle) -> Result<String, String> {
    let path = accounting_store_path(&app)?;
    if let Some(payload) = read_optional(&path)? {
        return Ok(payload);
    }
    let legacy_path = legacy_accounting_store_path(&app)?;
    let Some(payload) = read_optional(&legacy_path)? else {
        return Ok(String::new());
    };
    atomic_write(&path, payload.as_bytes())?;
    Ok(payload)
}

fn atomic_write(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, bytes).map_err(|error| error.to_string())?;
    fs::rename(&tmp, path).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_accounting_store(app: AppHandle, payload: String) -> Result<(), String> {
    let path = accounting_store_path(&app)?;
    atomic_write(&path, payload.as_bytes())
}

#[tauri::command]
fn save_excel_backup(app: AppHandle, filename: String, bytes: Vec<u8>) -> Result<String, String> {
    let dir = accounting_workspace_dir(&app)?;
    let clean_name = PathBuf::from(filename)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("wangyuan-accounting-backup.xlsx")
        .to_string();
    let filename = if clean_name.to_lowercase().ends_with(".xlsx") {
        clean_name
    } else {
        format!("{clean_name}.xlsx")
    };
    let path = dir.join(filename);

    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_accounting_store,
            save_accounting_store,
            save_excel_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{ACCOUNTING_STORE_FILE, WORKSPACE_FOLDER_NAME};

    #[test]
    fn accounting_store_file_is_json() {
        assert_eq!(ACCOUNTING_STORE_FILE, "accounting-data.json");
    }

    #[test]
    fn workspace_folder_uses_user_facing_name() {
        assert_eq!(WORKSPACE_FOLDER_NAME, "王源专属记账工作台的文件夹");
    }
}
