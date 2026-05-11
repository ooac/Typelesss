# Typelesss

macOS 优先的桌面语音输入程序原型。当前版本支持在桌面 App 内录音，将音频发送到硅基流动 Whisper-compatible ASR，再通过本地 FastNormalizer 和 DeepSeek/OpenAI-compatible polish 整理文本，最后复制或粘贴到当前光标。

## 当前可用能力
- Tauri 2 + Rust + React 桌面 App。
- macOS 麦克风录音，输出 WAV 临时文件。
- 硅基流动 ASR 配置，默认 `FunAudioLLM/SenseVoiceSmall`。
- 本地混合 ASR 配置入口：支持检查/安装 sherpa-onnx streaming 与 SenseVoice 模型，安装 runtime，并启动/停止本地 sidecar。
- Volcengine bigmodel streaming ASR 配置和 WebSocket provider。
- DeepSeek/OpenAI-compatible polish 配置，默认 `deepseek-v4-flash`。
- 独立桌面悬浮胶囊，显示待命、正在录音、计时、转写、插入和错误状态。
- 中文、英文、中英混输 FastNormalizer。
- 本地 SQLite 主动记忆：记录历史、纠错、ASR 耗时和个人术语，并把个人术语回灌到后续规范化与实时稳定器。
- 输出校验，避免 polish 回答问题或丢失关键术语。
- 录音开始时记录原输入 App，转写完成后切回该 App，并使用剪贴板 Cmd+V 自动粘贴；失败时保留文本在剪贴板。
- API key 保存到 macOS Keychain。
- 全局快捷键可在设置页自定义，默认 `Option + Space`。
- macOS `.app` 和 `.dmg` release bundle。

## 使用方式

一键启动（macOS）：

```bash
./start.command
```

也可以在 Finder 中双击 `start.command`。首次启动会自动执行 `npm install`，之后会用固定端口 `1420` 启动 Tauri 桌面开发版。

开发启动：

```bash
npm run tauri:dev
```

开发检查：

```bash
npm run check
```

构建 macOS App：

```bash
npm run release:mac
```

构建产物：

```text
src-tauri/target/release/bundle/macos/Typelesss.app
src-tauri/target/release/bundle/dmg/Typelesss_0.1.0_aarch64.dmg
```

## API 配置

在 App 设置页填写：
- ASR Endpoint：默认 `https://api.siliconflow.cn/v1/audio/transcriptions`
- ASR API Key
- ASR Model：默认 `FunAudioLLM/SenseVoiceSmall`
- Polish Endpoint：默认 `https://api.deepseek.com/v1`
- Polish API Key
- Polish Model：默认 `deepseek-v4-flash`
- Volcengine App ID / Resource ID / Access Token
- 本地混合 ASR：选择“本地混合 ASR”后可检查/安装本地模型、安装 runtime、启动/停止 sidecar，默认 runtime 地址 `http://127.0.0.1:17345`
- 全局快捷键：点击设置页快捷键输入框后直接按新组合键录入，默认 `Option+Space`
- 也支持单键快捷键，例如 `F9` 或 `D`；如果和正常输入冲突，请换成不常用按键。
- 右侧 Option 可单独作为快捷键：点击快捷键输入框后按键盘右侧 Option，保存后显示 `Right Option`。这个模式是按住说话、松开处理。
- `Right Option` 需要 macOS 输入监控权限：系统设置 > 隐私与安全性 > 输入监控 > 添加并允许 `Typelesss`，授权后重启 App。
- App 内提供“打开输入监控授权”按钮，可直接拉起对应系统设置页。
- 自动插入到其他 App 输入框需要 macOS 辅助功能权限：App 内提供“打开辅助功能授权”按钮。
- App 内也提供“安装到应用程序并打开授权”按钮，会复制到 `/Applications/Typelesss.app`，方便在输入监控列表中选择。

推荐配置：
- ASR Endpoint：`https://api.siliconflow.cn/v1/audio/transcriptions`
- ASR Model：`FunAudioLLM/SenseVoiceSmall`
- Polish Endpoint：`https://api.deepseek.com/v1`
- Polish Model：`deepseek-v4-flash`

API key 和 Access Token 会写入 macOS Keychain。配置文件只保存非敏感字段。

## 当前限制
- 如果自定义快捷键被系统或其他 App 占用，保存设置会失败；请换一个组合键或单键。
- 当前硅基流动 Whisper-compatible ASR 是松手后批量转写，胶囊会实时显示录音状态和计时；边说边出 partial 文本需要 streaming ASR。
- 如果 ASR 成功响应没有顶层 `text`，后端会继续兼容嵌套文本和 segments；如果确实为空，会提示检查录音人声。
- 硅基流动和 DeepSeek 端到端调用需要你在设置页填入自己的 API key 后保存。
- Volcengine provider 已按 WebSocket 协议实现，但需要真实火山引擎凭据才能做端到端验证。
- 本地混合 ASR 使用 `sherpa-onnx-online-websocket-server` 原生 WebSocket 协议；提交后等待 final，超时使用最后一次 partial 作为兜底，避免回落到慢 batch 路径。
- 自动粘贴依赖 macOS 辅助功能权限和目标 App 可被切回；失败时会报错并保留文本在剪贴板。
