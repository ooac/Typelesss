# 执行日志

### 任务 #1.1：Rust/Tauri 工具链 ✅
**状态**：已完成
**时间**：2026-05-07 13:50 - 2026-05-07 13:53
**执行者**：LD

#### 实现结果
- ✅ 安装 Rust stable aarch64-apple-darwin。
- ✅ 验证 Xcode Command Line Tools 已存在。

### 任务 #1.2：React 桌面 UI ✅
**状态**：已完成
**时间**：2026-05-07 13:54 - 2026-05-07 13:57
**执行者**：UI/UX

#### 实现结果
- ✅ 添加 Vite + React 入口。
- ✅ 添加设置页、状态 capsule、输入链路输出面板。
- ✅ 复用 TypeScript FastNormalizer 和 OutputValidator。

### 任务 #1.3：Tauri 配置与打包 ✅
**状态**：已完成
**时间**：2026-05-07 13:57 - 2026-05-07 14:00
**执行者**：AR

#### 实现结果
- ✅ 添加 Tauri 2 配置。
- ✅ 添加 macOS 麦克风和系统事件权限说明。
- ✅ `.app` 打包通过。

#### 遇到的问题（已解决）
- **问题**：release App 首次显示 `asset not found: index.html`。
- **解决**：把 `npm run build` 改为 `tsc` 后执行 `vite build`。
- **耗时**：约 2 分钟

### 任务 #1.4：录音后端 ✅
**状态**：已完成
**时间**：2026-05-07 14:00 - 2026-05-07 14:03
**执行者**：LD

#### 实现结果
- ✅ 使用 `cpal` 采集麦克风音频。
- ✅ 写入 WAV 临时文件。
- ✅ 录音器改为后台线程持有 CoreAudio stream，避免 Tauri state 线程安全问题。
- ✅ `start_recording` 改为非阻塞，避免 UI 卡死。

### 任务 #1.5：ASR/Polish Provider ✅
**状态**：已完成
**时间**：2026-05-07 14:02 - 2026-05-07 14:57
**执行者**：LD

#### 实现结果
- ✅ Whisper-compatible ASR multipart 上传。
- ✅ OpenAI-compatible chat completions polish。
- ✅ Volcengine streaming 配置入口预留。
- ✅ 默认 endpoint/model 切换为硅基流动 `FunAudioLLM/SenseVoiceSmall` 和 DeepSeek `deepseek-v4-flash`。
- ✅ DeepSeek endpoint 可填写到 `/v1`，后端会自动补齐 `/chat/completions`。
- ✅ 用户 API key 不写入代码、README 或任务日志，仍通过设置页保存到 macOS Keychain。
- ✅ 旧 OpenAI 默认 endpoint/model 自动迁移为硅基流动 + DeepSeek 默认值。

#### 测试覆盖
- ✅ Rust 配置迁移单元测试：只迁移旧默认值，不覆盖用户自定义值。

### 任务 #1.6：粘贴插入 ✅
**状态**：已完成
**时间**：2026-05-07 14:04 - 2026-05-07 14:05
**执行者**：LD

#### 实现结果
- ✅ 支持复制文本。
- ✅ 支持写入剪贴板并调用 Cmd+V。
- ✅ Cmd+V 成功后尝试恢复旧剪贴板。
- ✅ Cmd+V 失败时保留新文本在剪贴板，并向前端返回“已复制”提示，避免文本丢失。

### 任务 #1.7：构建与窗口验证 ✅
**状态**：已完成
**时间**：2026-05-07 14:05 - 2026-05-07 14:08
**执行者**：TE

#### 实现结果
- ✅ `npm run check` 通过。
- ✅ `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
- ✅ `npm run tauri:build` 通过。
- ✅ 启动 `.app` 成功。
- ✅ 点击“开始录音”后 UI 进入正在录音状态。
- ✅ 点击“取消”后 UI 回到待命状态。

### 任务 #1.8：全局快捷键 ✅
**状态**：已完成
**时间**：2026-05-07 14:46 - 2026-05-07 14:49
**执行者**：LD

#### 实现结果
- ✅ 接入 Tauri global-shortcut 插件。
- ✅ 注册 `Option+Space`。
- ✅ 额外注册备用 `Control+Option+Space`，避免系统输入法快捷键抢占。
- ⚠️ 自动化合成按键未能触发系统全局快捷键层，需人工实机验证。

### 任务 #1.9：Keychain/AX/Volcengine ✅
**状态**：已完成
**时间**：2026-05-07 14:49 - 2026-05-07 14:52
**执行者**：LD

#### 实现结果
- ✅ API key 和 Access Token 写入 macOS Keychain。
- ✅ 配置文件只保存非敏感字段。
- ✅ 插入优先使用 Accessibility focused element 的 `AXSelectedText`。
- ✅ AX 失败后 fallback 到剪贴板 Cmd+V。
- ✅ 添加 Volcengine bigmodel WebSocket provider。

### 任务 #1.10：DMG 打包 ✅
**状态**：已完成
**时间**：2026-05-07 14:52 - 2026-05-07 15:00
**执行者**：TE

#### 实现结果
- ✅ `npm run release:mac` 生成 `.app`。
- ✅ 使用 `hdiutil create` 生成 `.dmg`。
- ✅ `OpenLess Realtime Input_0.1.0_aarch64.dmg` 已存在。
- ✅ 关闭旧进程并打开 release App，确认设置页显示硅基流动 ASR 和 DeepSeek polish 默认值。
- ✅ 点击“开始录音”进入录音态，点击“取消”回到待命。

### 任务 #1.11：独立悬浮胶囊 ✅
**状态**：已完成
**时间**：2026-05-07 15:10 - 2026-05-07 15:22
**执行者**：UI/UX

#### 实现结果
- ✅ 添加 Tauri `capsule` 独立窗口，透明、无边框、常驻置顶。
- ✅ 胶囊显示待命、正在录音、转写中、已插入、出错状态。
- ✅ 录音时显示计时和动态音量条，确认麦克风链路已启动。
- ✅ 主窗口通过 Rust `emit_to("capsule")` 同步状态，避免跨窗口事件丢失。
- ✅ Tauri capability 增加 `capsule` 窗口授权。

#### 验证结果
- ✅ release App 启动后出现独立胶囊窗口。
- ✅ 点击“开始录音”后胶囊显示“正在录音”和计时。
- ✅ 点击“取消”后胶囊回到待命并显示“已取消”。

### 任务 #1.12：ASR 响应兼容修复 ✅
**状态**：已完成
**时间**：2026-05-07 15:25 - 2026-05-07 15:28
**执行者**：LD

#### 实现结果
- ✅ 修复“ASR 响应缺少 text 字段”报错路径。
- ✅ 兼容顶层 `text`、`data.text`、`result.text`、`output.text` 和 `segments[].text`。
- ✅ 顶层 `text` 为空时提示检查录音人声，而不是误报缺字段。
- ✅ 无可用文本字段时输出响应结构和硅基流动 trace id，便于定位服务端返回。

#### 测试覆盖
- ✅ Rust ASR 解析测试：顶层文本、嵌套文本、segments 拼接、空文本判断。

### 任务 #1.13：自定义快捷键 ✅
**状态**：已完成
**时间**：2026-05-07 15:40 - 2026-05-07 15:47
**执行者**：LD

#### 实现结果
- ✅ `AppConfig` 增加 `hotkey` 字段，旧配置缺字段时默认 `Option+Space`。
- ✅ 设置页增加全局快捷键输入框。
- ✅ 快捷键输入框改为录制控件，点击后按组合键自动填入。
- ✅ 支持只按一个键作为快捷键，例如 `D`、`F9`。
- ✅ Esc 取消录制，Backspace/Delete 清空当前快捷键。
- ✅ 保存设置时后端先注销旧快捷键，再注册新快捷键。
- ✅ 新快捷键注册成功后才写入配置文件，避免保存坏配置。
- ✅ 支持常见别名规范化：`Cmd`、`Ctrl`、`Opt`、`Alt`、`Esc` 等。

#### 测试覆盖
- ✅ Rust 配置兼容测试：旧配置缺 `hotkey` 时自动补默认值。
- ✅ Rust 快捷键解析测试：单字母键、单功能键、组合键均可解析。

### 任务 #1.14：右侧 Option 单键快捷键 ✅
**状态**：已完成
**时间**：2026-05-07 16:20 - 2026-05-07 16:32
**执行者**：LD

#### 实现结果
- ✅ 快捷键录制控件识别键盘右侧 Option，并显示为 `Right Option`。
- ✅ 后端增加 macOS `flagsChanged` 事件监听，绕过普通全局快捷键库不支持纯修饰键的问题。
- ✅ `RightOption` 保存后按下开始录音、松开停止并进入转写处理。
- ✅ 普通单键和组合键仍走原全局快捷键注册逻辑，不受影响。

#### 测试覆盖
- ✅ 前端快捷键录入测试覆盖 `AltRight` 到 `RightOption` 的转换。
- ✅ Rust 快捷键解析测试覆盖 `RightOption` 和 `right option` 别名。

### 任务 #1.15：右侧 Option 启用修复 ✅
**状态**：已完成
**时间**：2026-05-07 17:12 - 2026-05-07 17:15
**执行者**：LD

#### 实现结果
- ✅ 右侧 Option 后端事件从 `toggle` 改为 `global-shortcut-pressed` / `global-shortcut-released`。
- ✅ 前端按下只负责开始录音，松开只负责停止并处理，避免快速按放时状态错乱。
- ✅ 前端运行态状态引用同步更新，不再等待 React 下一轮渲染后才刷新。
- ✅ 快捷键输入框正在录入时暂停处理全局快捷键事件，避免设置 `Right Option` 时误触发录音。

#### 验证结果
- ✅ `npm run check` 通过，14 个 TypeScript/核心测试通过。
- ✅ `cargo test --manifest-path src-tauri/Cargo.toml` 通过，11 个 Rust 测试通过。

### 任务 #1.16：输入监控权限校验 ✅
**状态**：已完成
**时间**：2026-05-07 17:20 - 2026-05-07 17:26
**执行者**：SE

#### 实现结果
- ✅ 保存或启动 `Right Option` 时调用 macOS `CGPreflightListenEventAccess` / `CGRequestListenEventAccess` 校验输入监控权限。
- ✅ 缺少输入监控权限时界面显示明确错误，不再显示假成功。
- ✅ `Info.plist` 增加 `NSInputMonitoringUsageDescription`。
- ✅ 右 Option 监听优先使用 HID event tap，失败后再 fallback 到 Session event tap。
- ✅ 已打开系统设置的输入监控页面，等待用户完成 Touch ID 或密码授权。

#### 验证结果
- ✅ 本机 TCC 权限库确认此前只有麦克风和 AppleEvents，没有输入监控权限。
- ✅ release App 启动后明确显示 `Right Option 未启用，请先完成输入监控授权。`
- ✅ `npm run check` 通过，14 个 TypeScript/核心测试通过。
- ✅ `cargo test --manifest-path src-tauri/Cargo.toml` 通过，11 个 Rust 测试通过。

### 任务 #1.17：胶囊自由移动 ✅
**状态**：已完成
**时间**：2026-05-07 17:50 - 2026-05-07 17:56
**执行者**：UI/UX

#### 实现结果
- ✅ 胶囊窗口增加 `startDragging()`，按住胶囊任意位置即可拖动。
- ✅ Tauri capability 增加 `core:window:allow-start-dragging` 权限。
- ✅ 胶囊保留置顶、透明、无边框和状态显示。
- ✅ 关闭系统设置弹窗并重启 release App，清理卡住状态。

#### 验证结果
- ✅ `npm run check` 通过，14 个 TypeScript/核心测试通过。
- ✅ `cargo test --manifest-path src-tauri/Cargo.toml` 通过，11 个 Rust 测试通过。
- ✅ `npm run release:mac` 重新生成 `.app` 和 `.dmg`。

### 任务 #1.18：输入监控授权拉起 ✅
**状态**：已完成
**时间**：2026-05-07 18:55 - 2026-05-07 19:01
**执行者**：LD

#### 实现结果
- ✅ Rust 后端新增 `open_input_monitoring_settings` 命令，调用 macOS 系统设置 URL。
- ✅ 错误条在缺少输入监控权限时显示“打开输入监控授权”按钮。
- ✅ Provider 设置区固定提供“打开输入监控授权”按钮，用户不需要记路径。
- ✅ 点击后拉起系统设置 > 隐私与安全性 > 输入监控页面。

#### 验证结果
- ✅ `npm run check` 通过，14 个 TypeScript/核心测试通过。
- ✅ `cargo test --manifest-path src-tauri/Cargo.toml` 通过，11 个 Rust 测试通过。
- ✅ `npm run release:mac` 重新生成 `.app` 和 `.dmg`。
- ✅ release App 启动后错误条和设置区均显示授权按钮。

### 任务 #1.19：安装到应用程序 ✅
**状态**：已完成
**时间**：2026-05-07 19:05 - 2026-05-07 19:14
**执行者**：LD

#### 实现结果
- ✅ 后端新增 `install_to_applications_and_open_input_monitoring` 命令。
- ✅ App 内新增“安装到应用程序并打开授权”按钮。
- ✅ 命令会复制当前 `.app` 到 `/Applications/OpenLess Realtime Input.app`，并打开输入监控授权页。
- ✅ 已手动安装当前 release App 到 `/Applications` 并从该位置启动。

#### 验证结果
- ✅ `npm run check` 通过，14 个 TypeScript/核心测试通过。
- ✅ `cargo test --manifest-path src-tauri/Cargo.toml` 通过，11 个 Rust 测试通过。
- ✅ `npm run release:mac` 重新生成 `.app` 和 `.dmg`。
- ✅ Finder 已定位到 `/Applications/OpenLess Realtime Input.app`，授权选择时可直接看到应用名。

### 任务 #1.20：插入目标回焦 ✅
**状态**：已完成
**时间**：2026-05-07 19:20 - 2026-05-07 19:26
**执行者**：LD

#### 实现结果
- ✅ `start_recording` 录音开始时记录当前前台 App 的进程 ID 和名称。
- ✅ `paste_text` 插入前先切回录音前的 App，再执行 Accessibility 插入或剪贴板 Cmd+V fallback。
- ✅ 粘贴真正失败时返回错误，不再误报“完成”，文本仍保留在剪贴板。
- ✅ 新增“打开辅助功能授权”入口，用户不需要手动找系统设置路径。
- ✅ 已把新版覆盖安装到 `/Applications/OpenLess Realtime Input.app` 并从该位置启动。

#### 验证结果
- ✅ `npm run check` 通过，14 个 TypeScript/核心测试通过。
- ✅ `cargo test --manifest-path src-tauri/Cargo.toml` 通过，13 个 Rust 测试通过。
- ✅ `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- ✅ `npm run release:mac` 重新生成 `.app` 和 `.dmg`。
- ✅ 敏感密钥扫描未发现硬编码 `sk-*`。

#### 当前权限状态
- ⚠️ 本机 TCC 记录仍未看到 `OpenLess Realtime Input` 的辅助功能和输入监控授权；已打开辅助功能授权页面，需用户勾选 App 后才能插入到其他程序输入框。

### 任务 #1.21：已安装状态授权按钮 ✅
**状态**：已完成
**时间**：2026-05-07 19:31 - 2026-05-07 19:34
**执行者**：LD

#### 实现结果
- ✅ `install_to_applications_and_open_input_monitoring` 增加路径判断。
- ✅ 当前 App 已经从 `/Applications` 启动时，不再删除和复制自身，只打开输入监控与辅助功能授权页。
- ✅ 点击按钮时先清空旧错误并显示“正在打开授权页面”，避免看起来没有响应。
- ✅ 强制结束旧进程并启动新版，确认当前运行 PID 已更新。

#### 验证结果
- ✅ `npm run check` 通过，14 个 TypeScript/核心测试通过。
- ✅ `cargo test --manifest-path src-tauri/Cargo.toml` 通过，13 个 Rust 测试通过。
- ✅ `npm run release:mac` 重新生成 `.app` 和 `.dmg`。

### 任务 #1.22：主动请求辅助功能权限 ✅
**状态**：已完成
**时间**：2026-05-07 19:48 - 2026-05-07 19:54
**执行者**：SE

#### 实现结果
- ✅ 新增 `request_accessibility_permission`，调用 macOS `AXIsProcessTrustedWithOptions` 和 `kAXTrustedCheckOptionPrompt`。
- ✅ 点击“打开辅助功能授权”时先主动请求权限，再打开系统设置页面。
- ✅ App 启动时如果缺少辅助功能权限，会主动触发一次授权请求。
- ✅ 插入失败检测到缺少辅助功能权限时，也会触发授权请求。
- ✅ 已重新覆盖安装并从 `/Applications/OpenLess Realtime Input.app` 启动新版。

#### 验证结果
- ✅ `npm run check` 通过，14 个 TypeScript/核心测试通过。
- ✅ `cargo test --manifest-path src-tauri/Cargo.toml` 通过，13 个 Rust 测试通过。
- ✅ `npm run release:mac` 重新生成 `.app` 和 `.dmg`。
- ⚠️ macOS 仍要求用户在系统设置中手动勾选授权，应用无法绕过这一步。

### 任务 #1.23：快捷键无权限自动降级 ✅
**状态**：已完成
**时间**：2026-05-07 19:58 - 2026-05-07 20:01
**执行者**：LD

#### 实现结果
- ✅ `RightOption` 不再信任 `CGRequestListenEventAccess` 的返回值，只以 `CGPreflightListenEventAccess` 作为真实授权判断。
- ✅ 启动时发现 `RightOption` 缺少输入监控权限，会自动改用并写回 `Control+Option+Space`。
- ✅ 前端加载配置时如果 `RightOption` 注册失败，也会尝试注册备用快捷键并显示原因。
- ✅ 已重新覆盖安装并从 `/Applications/OpenLess Realtime Input.app` 启动新版。

#### 验证结果
- ✅ `npm run check` 通过，14 个 TypeScript/核心测试通过。
- ✅ `cargo test --manifest-path src-tauri/Cargo.toml` 通过，13 个 Rust 测试通过。
- ✅ `npm run release:mac` 重新生成 `.app` 和 `.dmg`。
- ✅ 当前配置已写回 `"hotkey": "Control+Option+Space"`，进程 PID `36169` 正在运行。

### 任务 #1.24：Right Option 保存容错 ✅
**状态**：已完成
**时间**：2026-05-07 20:03 - 2026-05-07 20:08
**执行者**：LD

#### 实现结果
- ✅ 保存 `RightOption` 时，如果当前进程尚未刷新输入监控权限，不再返回保存失败。
- ✅ 后端会保存 `RightOption` 配置、打开输入监控设置页，并提示重启后生效。
- ✅ 前端保存成功后针对 `RightOption` 显示“刚授权请重启 App 后生效”，避免误判。
- ✅ 已重新覆盖安装并从 `/Applications/OpenLess Realtime Input.app` 启动新版。

#### 验证结果
- ✅ `npm run check` 通过，14 个 TypeScript/核心测试通过。
- ✅ `cargo test --manifest-path src-tauri/Cargo.toml` 通过，13 个 Rust 测试通过。
- ✅ `npm run release:mac` 重新生成 `.app` 和 `.dmg`。
- ✅ 当前新版进程 PID `44379` 正在运行。

### 任务 #1.25：胶囊四角白边修复 ✅
**状态**：已完成
**时间**：2026-05-07 20:55 - 2026-05-07 20:59
**执行者**：UI/UX

#### 实现结果
- ✅ 胶囊窗口挂载时给 `html` 添加 `capsule-root`，卸载时清理。
- ✅ `html.capsule-root`、`body.capsule-body`、`#root` 全部强制透明并隐藏溢出。
- ✅ 胶囊窗口高度从 `66` 收紧到 `64`，减少圆角外透明区域。
- ✅ 移除胶囊阴影外扩，避免透明窗口边缘露出浅色底。
- ✅ 已重新覆盖安装并从 `/Applications/OpenLess Realtime Input.app` 启动新版。

#### 验证结果
- ✅ `npm run check` 通过，14 个 TypeScript/核心测试通过。
- ✅ `cargo test --manifest-path src-tauri/Cargo.toml` 通过，13 个 Rust 测试通过。
- ✅ `npm run release:mac` 重新生成 `.app` 和 `.dmg`。
- ✅ 当前新版进程 PID `87423` 正在运行。
