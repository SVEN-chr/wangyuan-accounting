# 书业账房 · 王源专属记账工作台

票据账本风格的桌面记账应用。暖米色 + 琥珀/赭石配色，手账纸质感，带穿孔收据卡片。

技术栈：Tauri 2 · React 19 · TypeScript · Vite

## 开发

```bash
pnpm dev              # 仅前端（浏览器，localhost:1420，localStorage 回退）
pnpm tauri dev        # 完整桌面应用（Vite + Rust + WebView）
pnpm build            # tsc 类型检查 + Vite 生产构建
pnpm tauri build      # 打包桌面安装包（Windows NSIS）
```

Rust 侧：

```bash
cargo check           # src-tauri/
cargo test
```

## 数据文件

运行后数据存储在桌面的 `王源专属记账工作台的文件夹/accounting-data.json`，Excel 备份也导出至同一目录。

## IDE 推荐

VS Code + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
