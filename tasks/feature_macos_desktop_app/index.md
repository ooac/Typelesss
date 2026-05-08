# 任务：macOS 桌面语音输入程序

> **类型**：feature
> **优先级**：P0
> **负责人**：AreaSongWcc
> **状态**：✅ 已完成
> **开始时间**：2026-05-07
> **预计完成**：2026-05-07

## 目标
在当前目录从零构建 macOS 可用桌面程序，复用已有 TypeScript 核心算法，完成录音、硅基流动 ASR 配置、DeepSeek polish 配置、剪贴板插入和 `.app` 打包。

## 进度仪表盘

| 维度 | 状态 | 详情 |
|------|------|------|
| 整体进度 | ✅ 100% | 25 个子任务全部完成 |
| 当前阶段 | R2 验收 | 验收完成 |
| 当前文档 | [R2_review.md](./R2_review.md) | 验收总结 |

| 阶段 | 状态 | 文档链接 |
|------|------|----------|
| R1 调研 | ✅ | 本文 |
| I 设计 | ✅ | 本文 |
| P 规划 | ✅ | [P_plan.md](./P_plan.md) |
| E 执行 | ✅ | [E_execution.md](./E_execution.md) |
| R2 验收 | ✅ | [R2_review.md](./R2_review.md) |

## 子任务概览

| ID | 任务名称 | 状态 | 优先级 | 详细文档 |
|----|---------|------|--------|----------|
| 1.1 | Rust/Tauri 工具链 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.2 | React 桌面 UI | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.3 | Tauri 配置与打包 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.4 | 录音后端 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.5 | ASR/Polish Provider | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.6 | 粘贴插入 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.7 | 构建与窗口验证 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.8 | 全局快捷键 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.9 | Keychain/AX/Volcengine | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.10 | DMG 打包 | ✅ | P1 | [E_execution.md](./E_execution.md) |
| 1.11 | 独立悬浮胶囊 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.12 | ASR 响应兼容修复 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.13 | 自定义快捷键 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.14 | 右侧 Option 单键快捷键 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.15 | 右侧 Option 启用修复 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.16 | 输入监控权限校验 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.17 | 胶囊自由移动 | ✅ | P1 | [E_execution.md](./E_execution.md) |
| 1.18 | 输入监控授权拉起 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.19 | 安装到应用程序 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.20 | 插入目标回焦 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.21 | 已安装状态授权按钮 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.22 | 主动请求辅助功能权限 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.23 | 快捷键无权限自动降级 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.24 | Right Option 保存容错 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.25 | 胶囊四角白边修复 | ✅ | P1 | [E_execution.md](./E_execution.md) |

## 关键决策
- 当前目录从零构建，不克隆 OpenLess。
- 默认使用硅基流动 Whisper-compatible ASR 和 DeepSeek/OpenAI-compatible polish。
- Whisper-compatible 和 Volcengine streaming ASR 都提供 provider。
- 旧 OpenAI 默认配置会自动迁移到当前默认值，用户自定义 provider 不被覆盖。
- 独立 Tauri `capsule` 窗口常驻显示录音、计时、处理、插入和错误状态。
- 胶囊窗口支持按住任意位置拖动，位置可由用户自由摆放。
- ASR 响应解析兼容顶层 `text`、嵌套文本和 segments，并区分空文本。
- 全局快捷键从固定值改为设置页自定义，保存后立即重新注册。
- 右侧 Option 作为纯修饰键时使用 macOS flagsChanged 事件单独监听，按下开始、松开停止，按键录入期间不会触发录音；启用前强制校验输入监控权限，并提供一键拉起授权页面。
- 插入会在录音开始时记录原前台 App，转写完成后先切回原 App，再优先使用 Accessibility focused element，失败后剪贴板 Cmd+V fallback；真正未插入时界面报错并保留文本在剪贴板。
- 启动、点击辅助功能授权按钮、插入失败时都会调用 macOS `AXIsProcessTrustedWithOptions` 主动请求辅助功能权限。
- `RightOption` 缺少输入监控权限时不再假成功，会自动降级并写回 `Control+Option+Space`。
- 保存 `RightOption` 时如果 macOS 当前进程还没刷新输入监控状态，会先保存配置并提示重启，不再直接报错。
- 胶囊窗口 `html/body/#root` 全透明，避免圆角外露主窗口浅色背景。
- DMG 使用 `hdiutil create` 生成。

## 风险与问题
- `Option + Space` 可能被系统快捷键抢占，因此提供 `Control + Option + Space` 备用。
- Volcengine 端到端需要真实火山引擎凭据验证。

## 变更日志（最近15条）

| 时间 | 操作 | 说明 |
|------|------|------|
| 05-07 20:59 | ✅ 完成 #1.25 | 修复胶囊四角浅色背景外露 |
| 05-07 20:08 | ✅ 完成 #1.24 | Right Option 已勾选但未刷新时允许保存并提示重启 |
| 05-07 20:01 | ✅ 完成 #1.23 | Right Option 无输入监控时自动降级到 Control+Option+Space |
| 05-07 19:54 | ✅ 完成 #1.22 | 增加 macOS 辅助功能权限主动请求 |
| 05-07 19:34 | ✅ 完成 #1.21 | 已从 /Applications 启动时，授权按钮不再复制自身 |
| 05-07 19:26 | ✅ 完成 #1.20 | 插入前切回录音前输入 App，并提供辅助功能授权入口 |
| 05-07 19:14 | ✅ 完成 #1.19 | 添加安装到 /Applications 并打开授权功能 |
| 05-07 19:01 | ✅ 完成 #1.18 | 添加 App 内输入监控授权拉起按钮 |
| 05-07 17:56 | ✅ 完成 #1.17 | 支持胶囊窗口自由拖动并重启 App |
| 05-07 17:26 | ✅ 完成 #1.16 | 添加输入监控权限校验和授权提示 |
| 05-07 17:15 | ✅ 完成 #1.15 | 修复 Right Option 启用时按下/松开状态不同步 |
| 05-07 16:32 | ✅ 完成 #1.14 | 支持键盘右侧 Option 单独作为按住说话快捷键 |
| 05-07 15:47 | ✅ 完成 #1.13 | 添加自定义快捷键配置，保存后动态注册 |
| 05-07 15:35 | ✅ 修复插入兜底 | Cmd+V 失败时保留文本在剪贴板，不再丢失 |
| 05-07 15:28 | ✅ 完成 #1.12 | 修复硅基流动 ASR 响应解析和空文本提示 |
| 05-07 15:22 | ✅ 完成 #1.11 | 添加独立悬浮胶囊窗口并验证录音状态同步 |
| 05-07 15:00 | ✅ 验证迁移与重新打包 | Rust 迁移测试通过，release App 显示硅基流动 + DeepSeek 默认值 |
| 05-07 14:57 | ✅ 更新 provider 默认值 | 默认切换为硅基流动 ASR + DeepSeek polish，密钥仍走 Keychain |
| 05-07 14:52 | ✅ 完成 #1.10 | 使用 hdiutil 生成 DMG |
| 05-07 14:50 | ✅ 完成 #1.9 | 添加 Keychain、AX 插入、Volcengine provider |
