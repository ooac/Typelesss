# 任务：实时 ASR 速度与准确率重构

> **类型**：optimize
> **优先级**：P0
> **负责人**：AreaSongWcc
> **状态**：🟡 进行中
> **开始时间**：2026-05-11
> **预计完成**：2026-05-12

## 目标
把录音后 batch 转写链路升级为实时输入引擎：提供 partial/final 事件、国内实时云端 + 本地 fallback 自动择优、快速 final 插入、SQLite 主动记忆，并保留硅基流动 batch fallback。

## 进度仪表盘

| 维度 | 状态 | 详情 |
|------|------|------|
| 整体进度 | 🟡 96% | 新增极速自动 ASR，并修复首录冷启动丢字 |
| 当前阶段 | E 执行 | 自动候选链路、门禁、首音保护和麦克风预热已接入，真实语音集待端到端 benchmark |
| 当前文档 | [E_execution.md](./E_execution.md) | 执行日志 |

| 阶段 | 状态 | 文档链接 |
|------|------|----------|
| R1 调研 | ✅ | 本文 |
| I 设计 | ✅ | 本文 |
| P 规划 | ✅ | [P_plan.md](./P_plan.md) |
| E 执行 | 🟡 | [E_execution.md](./E_execution.md) |
| R2 验收 | 🔵 | - |

## 子任务概览

| ID | 任务名称 | 状态 | 优先级 | 详细文档 |
|----|---------|------|--------|----------|
| 1.1 | StepFun 协议核验 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.2 | 录音层 16k PCM 分片 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.3 | StepFun WebSocket Provider | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.4 | 前端 partial/final 预览 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.5 | local_hybrid Provider | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.6 | 本地 runtime sidecar | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.7 | SQLite 主动记忆 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.8 | stable live insert / final replace | 🟡 | P0 | 待做：需安全接入 ShadowBuffer 到原生输入 |
| 1.9 | Provider benchmark | 🟡 | P1 | 已落命令/表结构，待真实样本评分 |
| 1.10 | Typeflux 对标本地多引擎 | ✅ | P0 | [E_execution.md](./E_execution.md) |
| 1.11 | 国内云端 + 本地自动择优 | ✅ | P0 | [E_execution.md](./E_execution.md) |

## 关键决策
- 默认策略改为 `auto_optimized`（极速自动 ASR），先走阿里 Paraformer realtime，再按候选降级到火山、本地、硅基。
- StepFun 暂缓，保留 provider 但不作为当前默认候选。
- `local_hybrid` 不再承担主链路，只作为无网、云端失败或隐私场景 fallback。
- 本地模型下载到用户 App data 目录，不提交到仓库。
- 主动记忆本地私有存储，先影响 FastNormalizer 和 TranscriptStabilizer。
- Typeflux 仅借鉴架构，不复制源码，避免 AGPL 许可污染。

## 风险与问题
- 阿里 Paraformer realtime 需要真实 DashScope Key 后端到端验证 first partial/final 延迟。
- 自动 provider 排名目前已有表结构和接口，真实评分还需要标准语音样本。
- stable live insert 需要原生输入 patch 能力，目前只有 final paste 最安全。

## 变更日志（最近15条）

| 时间 | 操作 | 说明 |
|------|------|------|
| 05-12 11:54 | ✅ 修复 | App 启动后后台预热麦克风输入流，降低第一次录音丢字 |
| 05-12 11:44 | ✅ 修复 | 麦克风启动提前，并为 ASR 音频补 240ms 前导静音 |
| 05-12 11:20 | ✅ 完成 #1.11 | 默认 ASR 改为极速自动，接入阿里 Paraformer realtime 与低信息门禁 |
| 05-12 10:12 | ✅ 完成 #1.10 | 默认本地 ASR 改为 Sherpa-ONNX + SenseVoice，新增 FunASR/Qwen 多引擎入口 |
| 05-12 00:03 | ✅ 完成 #1.6 | 新增 sherpa-onnx runtime 自安装、启动/停止和原生 WebSocket 协议 |
| 05-11 23:51 | ✅ 完成 #1.7 | 新增 telemetry、personal_terms、app_context_profiles，并把个人术语回灌规范化 |
| 05-11 23:49 | ✅ 完成 #1.5 | 新增 local_hybrid provider、runtime 状态和本地模型安装入口 |
| 05-11 23:26 | ✅ 完成 #1.4 | 前端接收 transcript-event，胶囊与最终文本区显示 partial/final |
| 05-11 23:24 | ✅ 完成 #1.3 | 新增 StepFun WebSocket ASR provider |
| 05-11 23:20 | ✅ 完成 #1.2 | 录音层输出 16k mono PCM 40ms 分片 |
| 05-11 23:12 | ✅ 完成 #1.1 | 核验 StepFun 双向流式 ASR 协议 |
