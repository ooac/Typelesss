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

### 任务 #1.10：Typeflux 对标本地多引擎 ✅
**状态**：已完成
**时间**：2026-05-12 09:48 - 2026-05-12 10:12
**执行者**：LD

#### 实现结果
- ✅ `local_hybrid` 默认本地模型从 Qwen3-ASR 改为 `SenseVoice Small int8`。
- ✅ 新增 Sherpa-ONNX runtime 管理：runtime 与模型分离下载、文件校验、Finder 打开模型目录。
- ✅ 本地引擎扩展为 `sensevoice-small`、`funasr-paraformer-zh-small`、`qwen3-asr-0.6b`，分别对应平衡极速、中文极速、高准确率。
- ✅ 普通用户 UI 改成“下载并启用 / 启用 / 镜像下载 / 打开目录 / 运行基线评测”，隐藏 endpoint/runtime server 配置感。
- ✅ 本地识别改为 Sherpa-ONNX 离线命令行 final，SenseVoice 遇到日文/韩文输出会用中文语言参数重试。
- ✅ 增加音频质量门禁，空录音直接返回可解释错误，不再长时间卡住。
- ✅ 保留用户快捷键；旧 Qwen 1.7B 配置迁移到 SenseVoice，不覆盖 hotkey。

#### 设计边界
- 不复制 Typeflux 源码，只复刻 Sherpa-ONNX 运行时/模型管理思路，规避 AGPL 许可污染。
- 本轮先保证“可用、快、准、不会乱学”，不做真正 streaming partial 与 live insert 默认开启。
- Benchmark 先落结果结构和入口，真实评分仍需要标准音频样本。

#### 相关文件
- `src-tauri/src/local_asr.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/providers.rs`
- `src-tauri/src/health.rs`
- `src/appDefaults.ts`
- `src/appTypes.ts`
- `src/components/ProviderEditor.tsx`
- `src/SettingsForm.tsx`
- `test/appDefaults.test.ts`

### 验证更新 3 ✅
**状态**：已完成
**时间**：2026-05-12 10:12

#### 结果
- ✅ `npm test` 通过，23 个测试全部通过。
- ✅ `npm run build` 通过。
- ✅ `cargo fmt --check` 通过。
- ✅ `cargo check` 通过。
- ✅ `cargo test` 通过，38 个测试全部通过。
- ✅ `git diff --check` 通过。

### 修复：Sherpa RTF 日志被误当识别文本 ✅
**状态**：已完成
**时间**：2026-05-12 10:18 - 2026-05-12 10:19
**执行者**：LD

#### 问题
- Sherpa-ONNX stdout 最后一行可能是 `Real time factor (RTF): ...` 性能日志。
- 旧解析器取最后一行非空文本，导致性能日志覆盖真实识别内容。

#### 解决
- ✅ `parse_sherpa_stdout` 改为从 stdout 优先抽取 transcript，忽略 RTF、音频路径、加载/解码日志。
- ✅ stdout 无文本时才回退读取 stderr。
- ✅ 增加回归测试覆盖 `现在已经下了本地模型` + RTF 日志场景。

#### 相关文件
- `src-tauri/src/local_asr.rs`

#### 验证
- ✅ `cargo fmt --check` 通过。
- ✅ `cargo check` 通过。
- ✅ `cargo test` 通过，40 个测试全部通过。
- ✅ `git diff --check` 通过。

### 修复：纯标点低信息识别结果 ✅
**状态**：已完成
**时间**：2026-05-12 10:23 - 2026-05-12 10:24
**执行者**：LD

#### 问题
- 用户说“能不能再快一点”，本地模型只返回 `。`。
- 纯标点属于低信息识别结果，不能当作成功文本插入，也不能写入纠错词典。

#### 解决
- ✅ SenseVoice 返回日文/韩文或低信息文本时，自动用中文参数重试。
- ✅ `。`、`.` 等纯标点结果不再视为成功识别。
- ✅ 当前引擎只返回低信息文本时继续尝试下一个已安装本地引擎。
- ✅ 增加回归测试覆盖纯标点低信息判断。

#### 相关文件
- `src-tauri/src/local_asr.rs`

#### 验证
- ✅ `npm test` 通过，23 个测试全部通过。
- ✅ `cargo fmt --check` 通过。
- ✅ `cargo check` 通过。
- ✅ `cargo test` 通过，41 个测试全部通过。
- ✅ `git diff --check` 通过。

### 任务 #1.11：国内云端 + 本地自动择优 ✅
**状态**：已完成
**时间**：2026-05-12 11:02 - 2026-05-12 11:20
**执行者**：LD

#### 实现结果
- ✅ 新增默认 `auto_optimized`，UI 文案为“极速自动 ASR”。
- ✅ `auto_optimized` 热键录音时优先建立阿里 Paraformer realtime WebSocket，强制 `language_hints: ["zh", "en"]`。
- ✅ 停止录音后如果实时 final 不可用，不直接报错，自动进入候选 fallback：火山、本地、硅基。
- ✅ `TranscriptEvent` 增加 `candidateId`、`isLowInformation`、`confidence`、`language`。
- ✅ `。`、空文本、日文/韩文高比例输出走低信息/语言门禁，不插入目标 App。
- ✅ 普通听写不再默认走远程 LLM polish，只在提示词构建和代码提示词模式调用，减少主链路延迟。
- ✅ 新增 provider benchmark/sample/score 命令和 SQLite 表结构，为真实评分自动择优做接口准备。

#### 相关文件
- `src-tauri/src/providers.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/health.rs`
- `src-tauri/src/app_config.rs`
- `src/state/AppContext.tsx`
- `src/appDefaults.ts`
- `src/appTypes.ts`
- `src/types.ts`
- `src/components/ProviderEditor.tsx`
- `src/SettingsForm.tsx`
- `test/appDefaults.test.ts`

#### 验证
- ✅ `npm test` 通过，25 个测试全部通过。
- ✅ `npm run build` 通过。
- ✅ `cargo fmt --check` 通过。
- ✅ `cargo check` 通过。
- ✅ `cargo test` 通过，43 个测试全部通过。
- ✅ `git diff --check` 通过。

### 修复：录音开头丢字 ✅
**状态**：已完成
**时间**：2026-05-12 11:35 - 2026-05-12 11:44
**执行者**：LD

#### 问题
- `start_recording` 先做插入目标 AX 捕获，再启动麦克风。
- AX 捕获和 Tauri 调用会造成启动延迟，用户按下快捷键后立即说话时，最前面的字容易没有进入录音。

#### 解决
- ✅ 调整启动顺序：先建立实时 ASR sender，再立即启动麦克风录音，最后捕获插入目标。
- ✅ 对 realtime PCM 和停止后的 WAV 都补 240ms 前导静音，避免 ASR 模型裁掉首音。
- ✅ 增加前导静音回归测试。

#### 相关文件
- `src-tauri/src/lib.rs`
- `src-tauri/src/recorder.rs`

#### 验证
- ✅ `npm test` 通过，25 个测试全部通过。
- ✅ `npm run build` 通过。
- ✅ `cargo fmt --check` 通过。
- ✅ `cargo check` 通过。
- ✅ `cargo test` 通过，44 个测试全部通过。
- ✅ `git diff --check` 通过。

### 修复：第一次录音冷启动丢字 ✅
**状态**：已完成
**时间**：2026-05-12 11:49 - 2026-05-12 11:54
**执行者**：LD

#### 问题
- 第一次启动后正式录音仍容易丢开头，后续录音正常。
- 这是 macOS 默认输入设备冷启动问题：首次打开输入流时音频回调需要预热。

#### 解决
- ✅ App 启动后后台打开默认麦克风输入流约 900ms，然后立即释放。
- ✅ 预热流不保存音频、不发送 ASR，只消除第一次正式录音的硬件冷启动成本。
- ✅ 预热失败只记录日志，不阻塞 App 启动和正式录音。

#### 相关文件
- `src-tauri/src/recorder.rs`
- `src-tauri/src/lib.rs`

#### 验证
- ✅ `cargo fmt --check` 通过。
- ✅ `cargo check` 通过。
- ✅ `cargo test` 通过，44 个测试全部通过。

### 修复：长句分段覆盖导致前半句丢失 ✅
**状态**：已完成
**时间**：2026-05-12 12:10 - 2026-05-12 12:18
**执行者**：LD

#### 问题
- 阿里 Paraformer realtime 的 `sentence.text` 可能返回当前分句，而不是整段累计文本。
- 旧逻辑每次把 `best_text` 直接覆盖为最新 `sentence.text`，长句被服务端切段后，最终只剩后半句。

#### 解决
- ✅ 新增 `RealtimeTranscriptAccumulator`，区分 committed stable 文本与当前 partial preview。
- ✅ 当前片段返回时追加到前文；累计全文返回时直接更新，避免重复拼接。
- ✅ stable 片段才提交到 committed，partial 只作为尾部预览。
- ✅ 增加测试覆盖“分段返回”和“累计返回”两种阿里行为。

#### 相关文件
- `src-tauri/src/providers.rs`

#### 验证
- ✅ `npm test` 通过，25 个测试全部通过。
- ✅ `npm run build` 通过。
- ✅ `cargo fmt --check` 通过。
- ✅ `cargo check` 通过。
- ✅ `cargo test` 通过，46 个测试全部通过。
- ✅ `git diff --check` 通过。

### 任务 #1.12：ASR final 复核与音频链路补强 ✅
**状态**：已完成
**时间**：2026-05-12 14:12 - 2026-05-12 14:36
**执行者**：LD

#### 实现结果
- ✅ 新增 `FinalCandidateGuard`，实时 final 若明显短于 preview、只有标点或语言错判，不再直接插入。
- ✅ `auto_optimized` 在 final 疑似截断时调用完整 WAV 复核，并在复核结果更完整时替换。
- ✅ 阿里 realtime 默认改为低延迟断句参数：关闭语义断句，启用 `max_sentence_silence=2500`。
- ✅ 录音结果新增 RMS、peak、audible ratio，前端可提示“音量偏低/有效语音过少”。
- ✅ realtime chunker 在销毁时 flush 不满 40ms 的尾包，减少尾音丢失。
- ✅ 增加段首 pre-roll 缓冲，长停顿后新语音段会补发最近音频上下文。
- ✅ `run_provider_benchmark` 不再返回静态 0 分；缺少真实样本时报明确错误，有样本时对本地/火山/硅基候选做真实转写评分。

#### 相关文件
- `src/asr/finalCandidateGuard.ts`
- `src/state/AppContext.tsx`
- `src-tauri/src/recorder.rs`
- `src-tauri/src/providers.rs`
- `src-tauri/src/lib.rs`

#### 验证
- ✅ `npm test` 通过，29 个测试全部通过。
- ✅ `npm run build` 通过。
- ✅ `cargo fmt --check` 通过。
- ✅ `cargo check` 通过。
- ✅ `cargo test` 通过，48 个测试全部通过。
- ✅ `git diff --check` 通过。

### 任务 #1.13：腾讯云实时 ASR 候选接入 ✅
**状态**：已完成
**时间**：2026-05-12 15:08 - 2026-05-12 15:46
**执行者**：LD

#### 实现结果
- ✅ 新增 `tencent_realtime` ASR provider，接入腾讯云实时识别 WebSocket。
- ✅ 实现腾讯云 HMAC-SHA1 签名 URL，默认模型 `16k_zh_en`。
- ✅ 解析腾讯云 `result`、`slice_type`、`final`，输出 partial/stable/final。
- ✅ 配置增加腾讯云 AppID、SecretID、SecretKey，SecretKey 写入 macOS Keychain。
- ✅ UI 增加“腾讯云实时 ASR”服务商和行内凭证编辑。
- ✅ `auto_optimized` 默认候选加入腾讯云，顺序为阿里 → 腾讯 → 火山 → 本地 → 硅基。

#### 相关文件
- `src-tauri/src/providers.rs`
- `src-tauri/src/app_config.rs`
- `src-tauri/src/secret_store.rs`
- `src/components/ProviderEditor.tsx`
- `src/appDefaults.ts`

#### 验证
- ✅ `npm test` 通过，30 个测试全部通过。
- ✅ `npm run build` 通过。
- ✅ `cargo fmt --check` 通过。
- ✅ `cargo check` 通过。
- ✅ `cargo test` 通过，51 个测试全部通过。
- ✅ `git diff --check` 通过。
