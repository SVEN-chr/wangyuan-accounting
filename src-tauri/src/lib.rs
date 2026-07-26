mod storage;
mod system_proxy;

use storage::{load_accounting_store, save_accounting_store, save_excel_backup};
use system_proxy::apply_system_proxy_to_env;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    apply_system_proxy_to_env();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            load_accounting_store,
            save_accounting_store,
            save_excel_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
