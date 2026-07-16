<div align="center">

# 书 业 账 房

### · 王 源 专 属 记 账 工 作 台 ·

```text
┌──────────────────────────────────────────────────────┐
│                                                      │
│   N°  RECEIPT LEDGER · VARIANT B                     │
│                                                      │
│   书  业  账  房                                       │
│   票  据  风  ·  桌  面  记  账                          │
│                                                      │
│   ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─    │
│                                                      │
│   TAURI 2  ·  REACT 19  ·  TYPESCRIPT  ·  VITE       │
│                                                      │
└──────────────────────────────────────────────────────┘
```

[![Release](https://img.shields.io/github/v/release/SVEN-chr/wangyuan-accounting?style=flat-square&color=b5532a&labelColor=2a1f12&label=release)](https://github.com/SVEN-chr/wangyuan-accounting/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/SVEN-chr/wangyuan-accounting/release-windows.yml?style=flat-square&color=5c7c2c&labelColor=2a1f12&label=windows%20build)](https://github.com/SVEN-chr/wangyuan-accounting/actions/workflows/release-windows.yml)
[![License](https://img.shields.io/badge/license-AGPL%203.0-7c3a0e?style=flat-square&labelColor=2a1f12)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?style=flat-square&logo=tauri&logoColor=white&labelColor=2a1f12)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white&labelColor=2a1f12)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white&labelColor=2a1f12)](https://www.typescriptlang.org/)

**暖米色 + 琥珀 / 赭石** · 手账纸质感 · 穿孔受票卡片 · JetBrains Mono 数字

</div>

---

## ◇ 设 计 · DESIGN

整本应用按 **一张票据账本** 来做：每张卡片有穿孔撕裂边，标题用大字 CJK 间距，
数字一律 JetBrains Mono `tabular-nums`，趋势文案如「本月节余创近半年新高」
完全由 `stats.byMonth` 实数算出 —— 没有写死的文本。

类目刻意 **不要图标**，靠 _形状 + 色块_ 区分：

```
   ◇       ○       □       ▽       ◐
   菱      圆      方      三     半圆
```

左侧固定一条「受票栏」（receipt rail）：日期 + 时间像收银小票一样盖印戳，
期初余额一笔可改。模态框（新增记录）也是同款穿孔卡片视觉。

## ○ 特 性 · FEATURES

|       |                                                                                          |
| :---: | :--------------------------------------------------------------------------------------- |
| `□` | **桌面原子化保存** — Rust 端 `tmp` + `sync_all` + `fs::rename`，断电也不损坏账本   |
| `○` | **300 ms 防抖** — 突发编辑合并为一次写盘                                              |
| `◇` | **关窗强 flush** — Tauri `onCloseRequested` 拦窗 + 3 s timeout 兜底，X 按钮永远响应   |
| `▽` | **浏览器模式零依赖** — `pnpm dev` 直接跑，localStorage 兜底；不需要 Rust 工具链        |
| `◐` | **Excel 三表互导** — 收支记录 / 分类 / 汇总 一键 `xlsx`，表头中英容错可手编            |
| `□` | **样例账本** — 首次启动播 30 条「旧书铺记账师」种子记录，方便上手 / 截图            |

## □ 开 发 · DEVELOPMENT

```bash
pnpm install

pnpm dev              # 仅前端（浏览器，localhost:1420，localStorage 回退）
pnpm tauri dev        # 完整桌面应用（Vite + Rust + WebView）
pnpm build            # tsc 类型检查 + Vite 生产构建
pnpm test             # Vitest 回归测试
pnpm tauri build      # 打包桌面安装包（Windows NSIS）
```

Rust 侧（`src-tauri/`）：

```bash
cargo check
cargo test
```

最快类型信号：`pnpm exec tsc --noEmit`

## ▽ 数 据 · DATA

```
Desktop/
└── 王源专属记账工作台的文件夹/
    ├── accounting-data.json    ← 主数据（原子写盘）
    └── *.xlsx                  ← 备份导出
```

账本不可替代 —— 因此 Rust 端写盘是 `tmp + fsync + rename` 三步。
首次启动会自动从 Tauri 旧 `app_data_dir` 位置迁移到桌面。

## ◐ 打 包 · PACKAGING

**Windows NSIS only**（不出 MSI）。WiX 3 的 `light.exe` 在 `productName`
含 CJK 字符时会按 ANSI 码页编码安装包文件名直接挂掉；NSIS 完整支持 UTF-8。

安装包文件名形如：

```
王源专属记账工作台_0.1.2_x64-setup.exe
```

Push 一个 `v*` tag 会触发
[Windows Build & Release workflow](.github/workflows/release-windows.yml)，
按系统语言（简中 / 英）自动挑安装界面文案。

## ◇ 单 文 件 哲 学 · WHY ONE FILE

`src/App.tsx` 接近 3000 行 —— 这 **不是** 技术债。

整本账本是一件 _coherent ledger artifact_：助手、视觉原子、页面组件
互相穿插就是设计的一部分，刻意保持一眼能读完。具体纪律（getCat 走 Map、
useMemo 用字符串 key、`onCloseRequested` 必须 `void win.close()` 不要
`await`、本地时区 `dateKey` 不要 UTC）全部记在 [`CLAUDE.md`](CLAUDE.md)。

## ○ IDE

[VS Code](https://code.visualstudio.com/) +
[Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
+ [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## □ 致 谢 · CREDITS

- **底层**：[Tauri 2](https://tauri.app) · [React 19](https://react.dev)
  · [Vite](https://vitejs.dev) · [SheetJS xlsx](https://github.com/SheetJS/sheetjs)
- **字体**：JetBrains Mono · IBM Plex Mono · Noto Sans SC
- **风格 mood**：手账票据 · 半透明纸张 · 朱砂印戳

---

<div align="center">

```text
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  END OF RECEIPT  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```

</div>
