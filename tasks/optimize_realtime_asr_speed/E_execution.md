# 执行日志

### 任务 #1.1：StepFun 协议核验 ✅
**状态**：已完成
**时间**：2026-05-11 23:12 - 2026-05-11 23:16
**执行者**：LD

#### 实现结果
- ✅ 核验 StepFun 双向流式 ASR 地址：`wss://api.stepfun.com/v1/realtime/asr/stream`。
- ✅ 核验消息类型：`session.update`、`input_audio_buffer.append`、`input_audio_buffer.commit`。
- ✅ 核验服务端事件：`conversation.item.input_audio_transcription.delta`、`conversation.item.input_audio_transcription.completed`、`error`。

### 任务 #1.2：录音层 16k PCM 分片 ✅
**状态**：已完成
**时间**：2026-05-11 23:16 - 2026-05-11 23:20
**执行者**：LD

#### 实现结果
- ✅ `RecorderCommand::Start` 支持携带实时 ASR sender。
- ✅ 麦克风输入保持原 WAV fallback，同时下混为 mono、重采样为 16k。
- ✅ 实时链路按 40ms chunk 发送 PCM Int16。

#### 相关文件
- `src-tauri/src/recorder.rs`

### 任务 #1.3：StepFun WebSocket Provider ✅
**状态**：已完成
**时间**：2026-05-11 23:20 - 2026-05-11 23:24
**执行者**：LD

#### 实现结果
- ✅ 新增 `stepfun_streaming` Provider。
- ✅ 建立 WebSocket 连接并发送 session 配置、audio append、commit。
- ✅ 将 delta/completed/error 映射为统一 `transcript-event`。
- ✅ 注入技术词 prompt：Claude Code、OpenAI Codex、Tauri、src-tauri、TranscriptEvent、ShadowBuffer 等。

#### 相关文件
- `src-tauri/src/providers.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/health.rs`

### 任务 #1.4：前端 partial/final 预览 ✅
**状态**：已完成
**时间**：2026-05-11 23:24 - 2026-05-11 23:26
**执行者**：LD

#### 实现结果
- ✅ 前端监听 `transcript-event`。
- ✅ partial 更新实时页文本和胶囊预览。
- ✅ final 直接进入整理/插入链路，避免再走 batch ASR。
- ✅ StepFun 服务商在实时页和设置页可选，自动填充默认 endpoint/model。

#### 相关文件
- `src/state/AppContext.tsx`
- `src/appTypes.ts`
- `src/appDefaults.ts`
- `src/components/ProviderEditor.tsx`
- `src/SettingsForm.tsx`

### 验证 ✅
**状态**：已完成
**时间**：2026-05-11 23:26

#### 结果
- ✅ `npm run build` 通过。
- ✅ `npm test` 通过，14 个测试全部通过。
- ✅ `cargo fmt --check` 通过。
- ✅ `cargo check` 通过。
- ✅ `cargo test` 通过，22 个测试全部通过。

### 任务 #1.5：local_hybrid Provider ✅
**状态**：已完成
**时间**：2026-05-11 23:40 - 2026-05-11 23:49
**执行者**：LD

#### 实现结果
- ✅ 新增 `local_hybrid` ASR Provider。
- ✅ 本地 runtime 协议接入：优先采用 sherpa-onnx 官方在线 WebSocket server；HTTP final adapter 暂不作为主链路。
- ✅ 新增本地 ASR 状态检查和模型安装命令。
- ✅ 服务商编辑区支持检查/安装本地模型。

#### 相关文件
- `src-tauri/src/local_asr.rs`
- `src-tauri/src/providers.rs`
- `src/components/ProviderEditor.tsx`

### 任务 #1.6：SQLite 主动记忆 ✅
**状态**：已完成
**时间**：2026-05-11 23:49 - 2026-05-11 23:51
**执行者**：LD

#### 实现结果
- ✅ 新增 `asr_telemetry`、`personal_terms`、`app_context_profiles` 迁移。
- ✅ 每次成功会话落库 ASR 时序数据。
- ✅ 从最终文本中学习个人术语。
- ✅ 个人术语回灌到 FastNormalizer 和 TranscriptStabilizer。

#### 相关文件
- `src-tauri/src/lib.rs`
- `src/db/historyRepo.ts`
- `src/normalize/fastNormalizer.ts`
- `src/state/AppContext.tsx`

### 验证更新 ✅
**状态**：已完成
**时间**：2026-05-11 23:51

#### 结果
- ✅ `npm run build` 通过。
- ✅ `npm test` 通过，15 个测试全部通过。
- ✅ `cargo fmt --check` 通过。
- ✅ `cargo check` 通过。
- ✅ `cargo test` 通过，25 个测试全部通过。

### 任务 #1.6：本地 runtime sidecar ✅
**状态**：已完成
**时间**：2026-05-11 23:54 - 2026-05-12 00:03
**执行者**：LD

#### 实现结果
- ✅ 增加 `sherpa-onnx-bin` 自安装路径，安装到 App data 下的 venv，不污染系统 Python。
- ✅ 增加 runtime 启动/停止命令，进程由 Tauri `AppState` 持有。
- ✅ `local_hybrid` 改为 sherpa-onnx 原生 WebSocket 协议：发送 `float32` PCM bytes，结束发送 `Done`，解析服务端 JSON 文本。
- ✅ runtime 探测改为本地 TCP 端口探测，适配 sherpa 官方 server 无 `/health` 的事实。

#### 相关文件
- `src-tauri/src/local_asr.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/providers.rs`
- `src/components/ProviderEditor.tsx`

### 验证更新 2 ✅
**状态**：已完成
**时间**：2026-05-12 00:03

#### 结果
- ✅ `npm run build` 通过。
- ✅ `npm test` 通过，15 个测试全部通过。
- ✅ `cargo fmt --check` 通过。
- ✅ `cargo check` 通过。
- ✅ `cargo test` 通过，26 个测试全部通过。

### 任务 #1.6b：本地实时 final 兜底 ✅
**状态**：已完成
**时间**：2026-05-12 00:18 - 2026-05-12 00:26
**执行者**：LD

#### 实现结果
- ✅ 修复录音停止后 sender 关闭导致 WebSocket 任务提前退出的问题。
- ✅ `Commit` 后继续等待 sherpa final；1.2 秒内未返回则用最后一次 partial 作为 final，避免卡入慢 fallback。
- ✅ 前端记录 `streamingPreviewRef`，本地混合 ASR 无 final 时直接用实时预览兜底，不再调用未完成的 HTTP batch adapter。

#### 相关文件
- `src-tauri/src/providers.rs`
- `src/state/AppContext.tsx`
