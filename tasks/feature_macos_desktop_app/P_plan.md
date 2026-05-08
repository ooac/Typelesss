# 执行计划

## WBS

| ID | 任务 | 状态 | 验收标准 |
|----|------|------|----------|
| 1.1 | 安装并验证 Rust/Tauri 工具链 | ✅ | `cargo check` 可运行 |
| 1.2 | 构建 React 桌面 UI | ✅ | App 有设置页、录音状态、输出面板 |
| 1.3 | 配置 Tauri 2 macOS App | ✅ | `.app` 可打包，Info.plist 有麦克风说明 |
| 1.4 | 实现录音后端 | ✅ | 开始录音和取消可在 App 中触发 |
| 1.5 | 实现 ASR/Polish Provider | ✅ | 硅基流动 Whisper-compatible 与 DeepSeek/OpenAI-compatible 命令可配置 |
| 1.6 | 实现剪贴板粘贴插入 | ✅ | 支持 copy 和 Cmd+V fallback |
| 1.7 | 构建与窗口验证 | ✅ | `npm run check`、`cargo check`、`npm run tauri:build` 通过 |
| 1.8 | 接入全局快捷键 | ✅ | 注册 `Option+Space` 和备用 `Control+Option+Space` |
| 1.9 | 补全 Keychain/AX/Volcengine | ✅ | API key 入 Keychain，AX 优先插入，Volcengine WebSocket provider |
| 1.10 | 生成 DMG | ✅ | `npm run release:mac` 生成 `.app` 和 `.dmg` |
| 1.11 | 添加独立悬浮胶囊 | ✅ | 胶囊窗口常驻显示待命、录音、计时、处理和取消状态 |
| 1.12 | 修复 ASR 响应解析 | ✅ | 兼容顶层 `text`、嵌套文本、segments 和空文本提示 |
| 1.13 | 支持自定义快捷键 | ✅ | 设置页可保存快捷键，后端动态重新注册 |
| 1.14 | 支持右侧 Option 单键 | ✅ | 右侧 Option 可单独录入，按下开始、松开停止 |
| 1.15 | 修复右侧 Option 启用 | ✅ | 按下和松开使用独立事件，录入快捷键时不触发录音 |
| 1.16 | 校验输入监控权限 | ✅ | Right Option 未授权时保存/启动给出明确错误 |
| 1.17 | 支持胶囊自由移动 | ✅ | 胶囊窗口可按住拖动到屏幕任意位置 |
| 1.18 | 拉起输入监控授权 | ✅ | App 内按钮直接打开系统输入监控设置页 |
| 1.19 | 安装到应用程序 | ✅ | App 内按钮复制到 `/Applications` 并打开授权页 |
| 1.20 | 修复插入目标回焦 | ✅ | 录音前记录原输入 App，转写后切回原 App 再插入 |
| 1.21 | 修复已安装状态授权按钮 | ✅ | 已从 `/Applications` 启动时按钮只打开授权页，不再替换自身 |
| 1.22 | 主动请求辅助功能权限 | ✅ | 启动、按钮和插入失败时触发 macOS 辅助功能授权请求 |
| 1.23 | 快捷键无权限自动降级 | ✅ | Right Option 缺少输入监控时自动改用 `Control+Option+Space` |
| 1.24 | Right Option 保存容错 | ✅ | 输入监控已勾选但进程未刷新时允许保存，提示重启生效 |
| 1.25 | 胶囊四角白边修复 | ✅ | 胶囊窗口根节点全透明，收紧窗口高度并移除阴影外扩 |

## DoD
- 产出 macOS `.app`。
- 前端和核心单元测试通过。
- Rust 后端编译通过。
- App 窗口能启动，录音开始/取消可交互。
- 悬浮胶囊能随录音状态同步。
- 悬浮胶囊能被用户拖动调整位置。
- ASR provider 返回非标准结构时给出可诊断错误。
- 自定义快捷键被占用或格式错误时保存失败且不写坏配置。
- 右侧 Option 作为纯修饰键时可被录入和触发。
- 右侧 Option 缺少输入监控权限时界面必须明确提示，不得显示假成功。
- 用户可从 App 内直接打开输入监控授权页面。
- 用户可从 App 内把 App 安装到 `/Applications`，避免授权时找不到应用名。
- 自动插入必须回到录音前的输入框，不能只显示在胶囊或 App 内。
- DMG 产物存在。
