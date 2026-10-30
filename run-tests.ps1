#requires -Version 5.1
$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $env:TEMP "dsh-bili-scroll-plus-tests-$stamp.log"
$script:Results = @()

try {
    Start-Transcript -Path $logPath -Force | Out-Null
} catch {
    Write-Host "无法创建测试日志，将继续运行：$($_.Exception.Message)" -ForegroundColor Yellow
}

function Invoke-NativeStep {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    Write-Host ""
    Write-Host ("=" * 72) -ForegroundColor DarkCyan
    Write-Host "开始：$Name" -ForegroundColor Cyan
    Write-Host ("命令：`"$FilePath`" " + ($Arguments -join " "))
    Write-Host ("=" * 72) -ForegroundColor DarkCyan

    $exitCode = 1
    try {
        & $FilePath @Arguments
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) { $exitCode = 0 }
    } catch {
        Write-Host "执行异常：$($_.Exception.Message)" -ForegroundColor Red
        $exitCode = 1
    }

    $status = if ($exitCode -eq 0) { "PASS" } else { "FAIL" }
    $script:Results += [pscustomobject]@{
        Name = $Name
        Status = $status
        ExitCode = $exitCode
    }

    if ($exitCode -eq 0) {
        Write-Host "结果：通过" -ForegroundColor Green
    } else {
        Write-Host "结果：失败（退出码 $exitCode）" -ForegroundColor Red
    }
}

Write-Host "大肥鱼 Plus 自动化测试" -ForegroundColor Cyan
Write-Host "项目目录：$PSScriptRoot"
Write-Host "日志文件：$logPath"

# Locate Node.js.
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
}
if (-not $nodeCommand) {
    Write-Host "找不到 Node.js。请安装 Node.js，或在已配置 Node.js 的终端中运行。" -ForegroundColor Red
    try { Stop-Transcript | Out-Null } catch {}
    exit 1
}
$nodePath = $nodeCommand.Source
if (-not $nodePath) { $nodePath = $nodeCommand.Definition }

# Locate Python. Prefer the active Conda environment, then common Conda installs.
$pythonPath = $null
$pythonArgsPrefix = @()

if ($env:CONDA_PREFIX) {
    $candidate = Join-Path $env:CONDA_PREFIX "python.exe"
    if (Test-Path -LiteralPath $candidate) { $pythonPath = $candidate }
}

if (-not $pythonPath) {
    $candidates = @(
        (Join-Path $HOME "anaconda3\python.exe"),
        (Join-Path $HOME "Anaconda3\python.exe"),
        (Join-Path $HOME "miniconda3\python.exe"),
        (Join-Path $HOME "Miniconda3\python.exe"),
        "C:\ProgramData\anaconda3\python.exe",
        "C:\ProgramData\miniconda3\python.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            $pythonPath = $candidate
            break
        }
    }
}

if (-not $pythonPath) {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand -and $pythonCommand.Source -notmatch "\\WindowsApps\\") {
        $pythonPath = $pythonCommand.Source
    }
}

if (-not $pythonPath) {
    $pyCommand = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($pyCommand) {
        $pythonPath = $pyCommand.Source
        $pythonArgsPrefix = @("-3")
    }
}

# Make the resolved interpreter available to Node.js SQLite tests.
# Those tests use process.env.PYTHON || 'python3'.
if (-not $pythonPath -and $env:PYTHON -and (Test-Path -LiteralPath $env:PYTHON -PathType Leaf)) {
    $pythonPath = $env:PYTHON
}
if ($pythonPath) {
    $env:PYTHON = $pythonPath
    Write-Host "Node.js 测试使用 Python：$env:PYTHON" -ForegroundColor Cyan
} else {
    Write-Host "警告：未找到 Python，Node.js SQLite 测试可能失败。" -ForegroundColor Yellow
}

# Force UTF-8 for every Python subprocess in both Node.js and Python tests.
# Windows would otherwise use the local ANSI code page (often GBK), while
# Node.js decodes child stdout as UTF-8 and some Python tests read UTF-8 files.
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
Write-Host "Python 测试编码：UTF-8 (PYTHONUTF8=1, PYTHONIOENCODING=utf-8)" -ForegroundColor Cyan

# 1. Focused regression test.
Invoke-NativeStep -Name "白名单好友推荐偏好专项测试" `
    -FilePath $nodePath `
    -Arguments @("--test", "test/dev4-friend-recommendation-feedback.test.mjs")

# 2. Full Node.js test suite.
$testDir = Join-Path $PSScriptRoot "test"
$testFiles = @(
    Get-ChildItem -LiteralPath $testDir -Filter "*.test.mjs" -File |
    Sort-Object FullName |
    ForEach-Object { $_.FullName }
)

if ($testFiles.Count -gt 0) {
    $nodeTestArgs = @("--test") + $testFiles
    Invoke-NativeStep -Name "Node.js 全量测试" -FilePath $nodePath -Arguments $nodeTestArgs
} else {
    $script:Results += [pscustomobject]@{
        Name = "Node.js 全量测试"
        Status = "FAIL"
        ExitCode = 2
    }
    Write-Host "没有找到 test\*.test.mjs 测试文件。" -ForegroundColor Red
}

# 3. Plugin self-check.
Invoke-NativeStep -Name "插件自检" `
    -FilePath $nodePath `
    -Arguments @("selfcheck.mjs")

# 4. Full Python unittest suite.
if ($pythonPath) {
    $pythonTestArgs = $pythonArgsPrefix + @(
        "-m", "unittest", "discover",
        "-s", "test",
        "-p", "test*.py"
    )
    Invoke-NativeStep -Name "Python 全量测试" -FilePath $pythonPath -Arguments $pythonTestArgs
} else {
    $script:Results += [pscustomobject]@{
        Name = "Python 全量测试"
        Status = "SKIP"
        ExitCode = 9009
    }
    Write-Host ""
    Write-Host "找不到可用的 Python。请从 Anaconda PowerShell Prompt 运行此脚本，或安装/配置 Conda Python。" -ForegroundColor Yellow
}

Write-Host ""
Write-Host ("=" * 72) -ForegroundColor DarkCyan
Write-Host "测试汇总" -ForegroundColor Cyan
$script:Results | Format-Table -AutoSize

$allPassed = ($script:Results.Count -gt 0) -and (@($script:Results | Where-Object { $_.Status -ne "PASS" }).Count -eq 0)
if ($allPassed) {
    Write-Host "全部测试通过。" -ForegroundColor Green
} else {
    Write-Host "存在失败或跳过的测试；请查看上方输出和日志。" -ForegroundColor Red
}
Write-Host "完整日志：$logPath"

try { Stop-Transcript | Out-Null } catch {}

if ($allPassed) { exit 0 } else { exit 1 }
