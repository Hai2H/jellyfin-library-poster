#!/bin/bash
set -euo pipefail

# 默认参数
PORT=8765
BUILD_FRONTEND=0
SKIP_FRONTEND_CHECK=0

# 解析入参
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="$2"
      shift 2
      ;;
    --build-frontend)
      BUILD_FRONTEND=1
      shift
      ;;
    --skip-frontend-check)
      SKIP_FRONTEND_CHECK=1
      shift
      ;;
    *)
      echo "未知参数: $1"
      echo "用法: $0 [--port 端口] [--build-frontend] [--skip-frontend-check]"
      exit 1
      ;;
  esac
done

# 项目根目录（脚本所在目录）
ROOT=$(cd "$(dirname "$0")" && pwd)
WEBUI_DIR="${ROOT}/webui"
ANGULAR_INDEX="${WEBUI_DIR}/dist/app/browser/index.html"
VENV_DIR="${ROOT}/.venv"
VENV_PYTHON="${VENV_DIR}/bin/python3"
APP_SCRIPT="${ROOT}/webui_app.py"

# 自动创建 Python 虚拟环境
resolve_python() {
  if [[ -f "${VENV_PYTHON}" ]]; then
    echo "${VENV_PYTHON}"
    return
  fi

  echo "未检测到虚拟环境 .venv，自动创建 Python 虚拟环境..."
  if ! command -v python3 &> /dev/null; then
    echo "错误：系统未找到 python3，请先安装 Python3"
    exit 1
  fi

  python3 -m venv "${VENV_DIR}"
  echo "虚拟环境创建完成"
  echo "${VENV_PYTHON}"
}

# 前端构建逻辑
ensure_frontend() {
  if [[ ${SKIP_FRONTEND_CHECK} -eq 1 ]]; then
    return
  fi

  if [[ -f "${ANGULAR_INDEX}" && ${BUILD_FRONTEND} -eq 0 ]]; then
    return
  fi

  if [[ ! -d "${WEBUI_DIR}" ]]; then
    echo "错误：未找到 webui 目录"
    exit 1
  fi

  if ! command -v npm &> /dev/null; then
    echo "错误：未找到 npm，请安装 Node.js"
    exit 1
  fi

  pushd "${WEBUI_DIR}" > /dev/null
  if [[ ! -d "node_modules" ]]; then
    echo "安装前端依赖..."
    npm install
  fi
  echo "构建 Angular 前端..."
  npm run build
  popd > /dev/null
}

# 校验主程序
if [[ ! -f "${APP_SCRIPT}" ]]; then
  echo "错误：未找到 webui_app.py，请在项目根目录执行脚本"
  exit 1
fi

PYTHON_BIN=$(resolve_python)
ensure_frontend

echo "====================================="
echo "服务监听全部网卡（局域网/公网均可访问）"
echo "本地访问: http://127.0.0.1:${PORT}/"
echo "局域网访问: http://本机内网IP:${PORT}/"
echo "公网访问: http://域名:${PORT}/"
echo "按 Ctrl+C 停止服务"
echo "====================================="
# 关键：传递端口给 Python，代码内监听 0.0.0.0
"${PYTHON_BIN}" "${APP_SCRIPT}" "${PORT}"
