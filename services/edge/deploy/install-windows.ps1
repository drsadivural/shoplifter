# Install or update the RetailGuard edge software on Windows 10/11 or Windows Server 2019+ (x64).
#
#   Right-click PowerShell > Run as administrator, then in the extracted package folder:
#   powershell -ExecutionPolicy Bypass -File .\deploy\install-windows.ps1 -Api https://shoplifter.ayonix.com
#
# Installs uv, a private Python 3.12 and the locked dependencies under
# %ProgramFiles%\RetailGuard\Edge, ffmpeg (unless already on PATH), the config and state under
# %ProgramData%\RetailGuard\Edge (SYSTEM and Administrators only), a "RetailGuard Edge" scheduled
# task that runs the agent as SYSTEM at startup and restarts it, and a `retailguard-edge` command.
[CmdletBinding()]
param(
    [string]$Api = "https://shoplifter.ayonix.com",
    [string]$FfmpegZipUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated PowerShell (Run as administrator)."
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Src = Split-Path -Parent $PSScriptRoot
$Prefix = Join-Path $env:ProgramFiles "RetailGuard\Edge"
$Bin = Join-Path $Prefix "bin"
$Data = Join-Path $env:ProgramData "RetailGuard\Edge"
$State = Join-Path $Data "state"
$Logs = Join-Path $Data "logs"
$Config = Join-Path $Data "config.toml"
$TaskName = "RetailGuard Edge"

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

# A running agent holds files open; stop it while files are replaced.
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }

Step "Folders"
New-Item -ItemType Directory -Force -Path $Prefix, $Bin, $Data, $State, $Logs | Out-Null
# Config, keys, camera credentials and spool: SYSTEM and Administrators only (the Linux 0600/0700).
& icacls $Data /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" /T /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw "icacls failed ($LASTEXITCODE)" }

Step "uv"
$uv = Join-Path $Bin "uv.exe"
if (-not (Test-Path $uv)) {
    $env:UV_INSTALL_DIR = $Bin
    $env:UV_NO_MODIFY_PATH = "1"
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    if (-not (Test-Path $uv)) {
        $found = Get-ChildItem -Path $Bin -Recurse -Filter uv.exe | Select-Object -First 1
        if (-not $found) { throw "uv was not installed" }
        $uv = $found.FullName
    }
}

Step "Application"
# /MIR keeps the destination identical to the package; the venv and Python are excluded (kept).
& robocopy $Src $Prefix /MIR /NFL /NDL /NJH /NJS /NP /XD .venv python bin ffmpeg uv-cache tests __pycache__ .git /XF "*.pyc" | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
$env:UV_PYTHON_INSTALL_DIR = Join-Path $Prefix "python"
$env:UV_CACHE_DIR = Join-Path $Prefix "uv-cache"
& $uv python install 3.12
if ($LASTEXITCODE -ne 0) { throw "uv python install failed" }
Push-Location $Prefix
try {
    & $uv sync --frozen --no-dev
    if ($LASTEXITCODE -ne 0) { throw "uv sync failed" }
} finally { Pop-Location }
$exe = Join-Path $Prefix ".venv\Scripts\retailguard-edge.exe"

Step "ffmpeg"
$ffmpeg = $null; $ffprobe = $null
$onPath = Get-Command ffmpeg -ErrorAction SilentlyContinue
$probeOnPath = Get-Command ffprobe -ErrorAction SilentlyContinue
$bundled = Join-Path $Prefix "ffmpeg\bin"
if ($onPath -and $probeOnPath) {
    $ffmpeg = $onPath.Source; $ffprobe = $probeOnPath.Source
} elseif (Test-Path (Join-Path $bundled "ffmpeg.exe")) {
    $ffmpeg = Join-Path $bundled "ffmpeg.exe"; $ffprobe = Join-Path $bundled "ffprobe.exe"
} else {
    $zip = Join-Path $env:TEMP "retailguard-ffmpeg.zip"
    $tmp = Join-Path $env:TEMP "retailguard-ffmpeg"
    Invoke-WebRequest -Uri $FfmpegZipUrl -OutFile $zip -UseBasicParsing
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive -Path $zip -DestinationPath $tmp
    $exeFound = Get-ChildItem -Path $tmp -Recurse -Filter ffmpeg.exe | Select-Object -First 1
    if (-not $exeFound) { throw "ffmpeg.exe not found in $FfmpegZipUrl" }
    New-Item -ItemType Directory -Force -Path $bundled | Out-Null
    Copy-Item -Path (Join-Path $exeFound.DirectoryName "*") -Destination $bundled -Recurse -Force
    Remove-Item -Recurse -Force $tmp, $zip
    $ffmpeg = Join-Path $bundled "ffmpeg.exe"; $ffprobe = Join-Path $bundled "ffprobe.exe"
}

Step "Configuration"
if (-not (Test-Path $Config)) {
    $text = Get-Content -Raw -Path (Join-Path $Prefix "deploy\config.example.toml")
    $text = $text -replace '(?m)^api_base_url = .*$', "api_base_url = `"$Api`""
    $text = $text -replace '(?m)^state_dir = .*$', "state_dir = '$State'"
    $text = $text -replace '(?m)^\[edge\][ \t]*$', "[edge]`r`nffmpeg_path = '$ffmpeg'`r`nffprobe_path = '$ffprobe'"
    [IO.File]::WriteAllText($Config, $text, (New-Object Text.UTF8Encoding($false)))
}

Step "Command"
$cmd = @"
@echo off
rem RetailGuard edge CLI with the installed config and state. Run from an elevated prompt.
set "RETAILGUARD_EDGE_CONFIG=$Config"
"$exe" --state-dir "$State" %*
"@
[IO.File]::WriteAllText((Join-Path $Bin "retailguard-edge.cmd"), $cmd, (New-Object Text.ASCIIEncoding))
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
if (-not ($machinePath -split ";" | Where-Object { $_ -eq $Bin })) {
    [Environment]::SetEnvironmentVariable("Path", "$machinePath;$Bin", "Machine")
}

Step "Scheduled task"
$action = New-ScheduledTaskAction -Execute $exe `
    -Argument "--config `"$Config`" --state-dir `"$State`" --log-file `"$Logs\edge.log`" run" -WorkingDirectory $Prefix
$trigger = New-ScheduledTaskTrigger -AtStartup
$runAs = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $runAs -Settings $settings `
    -Description "Ayonix RetailGuard store edge agent" -Force | Out-Null

$version = & $exe --version
if (Test-Path (Join-Path $State "edge.json")) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "==> RetailGuard edge $version updated and started." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "==> RetailGuard edge $version installed." -ForegroundColor Green
    Write-Host "Next (open a NEW elevated PowerShell so PATH includes $Bin):"
    Write-Host "  retailguard-edge pair --api $Api --code <CODE> --name `"<appliance name>`""
    Write-Host "  Start-ScheduledTask -TaskName `"$TaskName`""
    Write-Host "  retailguard-edge status"
    Write-Host "Logs: $Logs\edge.log"
}
