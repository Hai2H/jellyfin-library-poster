param(
  [int]$Port = 8765,
  [switch]$BuildFrontend,
  [switch]$SkipFrontendCheck
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebuiDir = Join-Path $Root "webui"
$AngularIndex = Join-Path $WebuiDir "dist\app\browser\index.html"
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$App = Join-Path $Root "webui_app.py"

function Resolve-Python {
  if (Test-Path $VenvPython) {
    return $VenvPython
  }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    return $python.Source
  }

  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    return $py.Source
  }

  throw "未找到 Python。请先创建 .venv，或把 python/py 加入 PATH。"
}

function Ensure-Frontend {
  if ($SkipFrontendCheck) {
    return
  }

  if ((Test-Path $AngularIndex) -and -not $BuildFrontend) {
    return
  }

  if (-not (Test-Path $WebuiDir)) {
    throw "未找到 webui 目录。"
  }

  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $npm) {
    throw "未找到 npm，无法构建 Angular 前端。请安装 Node.js 后重试。"
  }

  Push-Location $WebuiDir
  try {
    if (-not (Test-Path "node_modules")) {
      Write-Host "正在安装前端依赖..."
      npm install
    }

    Write-Host "正在构建 Angular 前端..."
    npm run build
  }
  finally {
    Pop-Location
  }
}

if (-not (Test-Path $App)) {
  throw "未找到 webui_app.py。请在项目根目录运行此脚本。"
}

$Python = Resolve-Python
Ensure-Frontend

Write-Host "WebUI 即将启动: http://127.0.0.1:$Port/"
Write-Host "按 Ctrl+C 停止服务。"
& $Python $App $Port
