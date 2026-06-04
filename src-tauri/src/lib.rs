use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

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

fn read_optional(path: &Path) -> Result<Option<String>, String> {
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
    let _ = fs::remove_file(&legacy_path);
    Ok(payload)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    {
        let mut file = fs::File::create(&tmp).map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
    }
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

/// Windows 上 updater 用的 reqwest 默认只认 HTTP(S)_PROXY 环境变量，**不读**「系统
/// 代理」(Internet Settings) 注册表。很多用户（尤其国内）用 Clash/v2rayN 的「系统代理」
/// 模式：浏览器能上 GitHub，但本应用直连 github.com 失败（error sending request）。
/// 这里在启动时把系统代理读出来写进环境变量，让 updater 的检查与下载都走代理。
/// 仅在用户未显式设置代理时生效；PAC 自动配置脚本不在处理范围内。
#[cfg(target_os = "windows")]
fn apply_system_proxy_to_env() {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let already_set = std::env::var_os("HTTPS_PROXY").is_some()
        || std::env::var_os("https_proxy").is_some()
        || std::env::var_os("ALL_PROXY").is_some();
    if already_set {
        return;
    }

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(settings) =
        hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
    else {
        return;
    };
    let enabled: u32 = settings.get_value("ProxyEnable").unwrap_or(0);
    if enabled == 0 {
        return;
    }
    let Ok(raw) = settings.get_value::<String, _>("ProxyServer") else {
        return;
    };
    if let Some(proxy_url) = normalize_proxy(&raw) {
        std::env::set_var("HTTP_PROXY", &proxy_url);
        std::env::set_var("HTTPS_PROXY", &proxy_url);
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_system_proxy_to_env() {}

/// 把注册表 `ProxyServer` 值规整成 reqwest 能用的代理 URL。支持两种格式：
/// 单值 `127.0.0.1:7890`，或按协议分组 `http=127.0.0.1:7890;https=127.0.0.1:7890;socks=...`
/// （优先取 https，其次 http）。host:port 缺少 scheme 时补 `http://`（本地 CONNECT 代理）。
#[cfg(target_os = "windows")]
fn normalize_proxy(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let host_port = if raw.contains('=') {
        let mut http = None;
        let mut https = None;
        for part in raw.split(';') {
            let part = part.trim();
            if let Some(v) = part.strip_prefix("https=") {
                https = Some(v.trim().to_string());
            } else if let Some(v) = part.strip_prefix("http=") {
                http = Some(v.trim().to_string());
            }
        }
        https.or(http)?
    } else {
        raw.to_string()
    };
    let host_port = host_port.trim();
    if host_port.is_empty() {
        return None;
    }
    if host_port.starts_with("http://") || host_port.starts_with("https://") {
        Some(host_port.to_string())
    } else {
        Some(format!("http://{host_port}"))
    }
}

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

    #[cfg(target_os = "windows")]
    #[test]
    fn normalize_proxy_plain_host_port_gets_http_scheme() {
        assert_eq!(
            super::normalize_proxy("127.0.0.1:7890").as_deref(),
            Some("http://127.0.0.1:7890")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normalize_proxy_protocol_grouped_prefers_https() {
        assert_eq!(
            super::normalize_proxy("http=10.0.0.1:1;https=10.0.0.1:2;socks=10.0.0.1:3").as_deref(),
            Some("http://10.0.0.1:2")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normalize_proxy_preserves_existing_scheme() {
        assert_eq!(
            super::normalize_proxy("https://127.0.0.1:8888").as_deref(),
            Some("https://127.0.0.1:8888")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normalize_proxy_empty_is_none() {
        assert_eq!(super::normalize_proxy(""), None);
        assert_eq!(super::normalize_proxy("   "), None);
    }
}
