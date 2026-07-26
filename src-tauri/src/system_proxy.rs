/// 把注册表 `ProxyServer` 值规整成 reqwest 能用的代理 URL。支持两种格式：
/// 单值 `127.0.0.1:7890`，或按协议分组 `http=...;https=...;socks=...`
///（优先取 https，其次 http）。host:port 缺少 scheme 时补 `http://`。
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
            if let Some(value) = part.strip_prefix("https=") {
                https = Some(value.trim().to_string());
            } else if let Some(value) = part.strip_prefix("http=") {
                http = Some(value.trim().to_string());
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

#[cfg(target_os = "windows")]
#[cfg(test)]
mod tests {
    #[test]
    fn plain_host_port_gets_http_scheme() {
        assert_eq!(
            super::normalize_proxy("127.0.0.1:7890").as_deref(),
            Some("http://127.0.0.1:7890")
        );
    }

    #[test]
    fn protocol_grouped_proxy_prefers_https_and_adds_scheme() {
        assert_eq!(
            super::normalize_proxy("http=10.0.0.1:1;https=10.0.0.1:2;socks=10.0.0.1:3").as_deref(),
            Some("http://10.0.0.1:2")
        );
    }

    #[test]
    fn existing_scheme_is_preserved() {
        assert_eq!(
            super::normalize_proxy("https://127.0.0.1:8888").as_deref(),
            Some("https://127.0.0.1:8888")
        );
    }

    #[test]
    fn empty_proxy_is_ignored() {
        assert_eq!(super::normalize_proxy(""), None);
        assert_eq!(super::normalize_proxy("   "), None);
    }
}
/// Windows 上 updater 用的 reqwest 默认只认 HTTP(S)_PROXY 环境变量，**不读**「系统
/// 代理」(Internet Settings) 注册表。很多用户（尤其国内）用 Clash/v2rayN 的「系统代理」
/// 模式：浏览器能上 GitHub，但本应用直连 github.com 失败（error sending request）。
/// 这里在启动时把系统代理读出来写进环境变量，让 updater 的检查与下载都走代理。
/// 仅在用户未显式设置代理时生效；PAC 自动配置脚本不在处理范围内。
#[cfg(target_os = "windows")]
pub(crate) fn apply_system_proxy_to_env() {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    // 用户已显式设置任一代理环境变量时就不插手——下面会同时写 HTTP_PROXY 与
    // HTTPS_PROXY，所以这里也要把 HTTP(_)PROXY 纳入判断，否则会把用户单独设的
    // HTTP_PROXY 覆盖掉。
    let already_set = std::env::var_os("HTTPS_PROXY").is_some()
        || std::env::var_os("https_proxy").is_some()
        || std::env::var_os("HTTP_PROXY").is_some()
        || std::env::var_os("http_proxy").is_some()
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
pub(crate) fn apply_system_proxy_to_env() {}
