use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};

const ACCOUNTING_STORE_FILE: &str = "accounting-data.json";

fn accounting_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(ACCOUNTING_STORE_FILE))
}

#[tauri::command]
fn load_accounting_store(app: AppHandle) -> Result<String, String> {
    let path = accounting_store_path(&app)?;
    if !path.exists() {
        return Ok(String::new());
    }

    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_accounting_store(app: AppHandle, payload: String) -> Result<(), String> {
    let path = accounting_store_path(&app)?;
    fs::write(path, payload).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_accounting_store,
            save_accounting_store
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::ACCOUNTING_STORE_FILE;

    #[test]
    fn accounting_store_file_is_json() {
        assert_eq!(ACCOUNTING_STORE_FILE, "accounting-data.json");
    }
}
