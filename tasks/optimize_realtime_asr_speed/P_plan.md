# 执行计划

## WBS

| ID | 任务 | 状态 | 验收标准 |
|----|------|------|----------|
| 1.1 | StepFun 协议核验 | ✅ | 明确 endpoint、鉴权、session.update、append、commit、delta、completed |
| 1.2 | 录音层 16k PCM 分片 | ✅ | 录音线程可在保留 WAV 的同时推送 40ms PCM chunk |
| 1.3 | StepFun WebSocket Provider | ✅ | 可发送 session.update、audio append、commit，并解析 partial/final/error |
| 1.4 | 前端 partial/final 预览 | ✅ | transcript-event 更新实时页、胶囊和 final 文本 |
| 1.5 | local_hybrid Provider | ✅ | 本地 provider 可选，可检查/安装模型，可连接本地 runtime 协议 |
| 1.6 | 本地 runtime sidecar | ✅ | 可安装 sherpa-onnx-bin，可启动/停止在线 WebSocket server |
| 1.7 | SQLite 主动记忆 | ✅ | telemetry、personal_terms、app profiles 落库，个人术语回灌 normalizer/stabilizer |
| 1.8 | stable live insert / final replace | 🟡 | 用 ShadowBuffer 安全替换，不重复、不乱序 |
| 1.9 | Provider benchmark | 🔵 | 输出 first partial、final latency、CER/WER、技术词召回 |

## DoD
- `npm run build` 通过。
- `npm test` 通过。
- `cargo fmt --check` 通过。
- `cargo check` 通过。
- `cargo test` 通过。
- 本地 runtime 启动后可通过 `local_hybrid` 走实时 partial 与 final 插入。
