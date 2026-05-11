#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=1420

cd "$APP_DIR"

echo "正在启动 Typelesss..."

# 开发启动不需要外部 API Key；清掉常见敏感环境变量，避免出现在进程列表里。
unset MINIMAX_API_KEY
unset OPENAI_API_KEY
unset ANTHROPIC_API_KEY
unset DEEPSEEK_API_KEY
unset SILICONFLOW_API_KEY
unset VOLCENGINE_ACCESS_TOKEN

if ! command -v npm >/dev/null 2>&1; then
  echo "未找到 npm。请先安装 Node.js 后再运行。"
  read -r -p "按回车键退出..."
  exit 1
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "端口 $PORT 已被占用。"
  echo "如果 Typelesss 已经在运行，请先关闭旧的开发进程后再重试。"
  read -r -p "按回车键退出..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "首次启动，正在安装依赖..."
  npm install
fi

echo "开发端口：http://127.0.0.1:$PORT"
echo "正在打开桌面应用，关闭此窗口会停止开发服务。"

npm run tauri:dev
