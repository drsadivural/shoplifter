# Install or update the RetailGuard edge software on Windows 10/11 or Windows Server 2019+ (x64).
#
#   Right-click PowerShell > Run as administrator, then in the extracted package folder:
#   powershell -ExecutionPolicy Bypass -File .\deploy\install-windows.ps1 -Api https://shoplifter.ayonix.com
#
# Installs uv, a private Python 3.12 and the locked dependencies under
# %ProgramFiles%\RetailGuard\Edge, ffmpeg (unless already on PATH), the config and state under
# %ProgramData%\RetailGuard\Edge (SYSTEM and Administrators only), a "RetailGuard Edge" scheduled
# task that runs the agent as SYSTEM at startup and restarts it, and a `retailguard-edge` command.
#
# The setup wizard (RetailGuardEdgeSetup.exe) copies the files itself and runs one -Phase at a time
# to show progress: Prepare, Runtime, Dependencies, Ffmpeg, Configure, Service. Every phase can be
# re-run; running all of them again is an update.
[CmdletBinding()]
param(
    [string]$Api = "https://shoplifter.ayonix.com",
    [ValidateSet("All", "Prepare", "Runtime", "Dependencies", "Ffmpeg", "Configure", "Service")]
    [string]$Phase = "All",
    # A zip already downloaded (and checksum-verified) by the setup wizard.
    [string]$FfmpegZip = ""
)
# Pinned ffmpeg build (gyan.dev "essentials", GPLv3) from GitHub's CDN; only ffmpeg.exe, ffprobe.exe and
# the license are unpacked. The download is verified against this SHA-256.
$FfmpegUrl = "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip"
$FfmpegSha256 = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba"
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
$Exe = Join-Path $Prefix ".venv\Scripts\retailguard-edge.exe"
$env:UV_PYTHON_INSTALL_DIR = Join-Path $Prefix "python"
$env:UV_CACHE_DIR = Join-Path $Prefix "uv-cache"

function Want([string]$name) { return $Phase -eq "All" -or $Phase -eq $name }
function Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

function Get-Uv {
    $uv = Join-Path $Bin "uv.exe"
    if (Test-Path $uv) { return $uv }
    $found = Get-ChildItem -Path $Bin -Recurse -Filter uv.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

# ffmpeg/ffprobe already on PATH, or the copy this installer downloaded; $null when neither exists.
function Get-Ffmpeg {
    $onPath = Get-Command ffmpeg -ErrorAction SilentlyContinue
    $probeOnPath = Get-Command ffprobe -ErrorAction SilentlyContinue
    if ($onPath -and $probeOnPath) { return @($onPath.Source, $probeOnPath.Source) }
    $bundled = Join-Path $Prefix "ffmpeg\bin"
    if (Test-Path (Join-Path $bundled "ffmpeg.exe")) {
        return @((Join-Path $bundled "ffmpeg.exe"), (Join-Path $bundled "ffprobe.exe"))
    }
    return $null
}

if (Want "Prepare") {
    Step "Folders"
    # A running agent holds files open; stop it while files are replaced.
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Force -Path $Prefix, $Bin, $Data, $State, $Logs | Out-Null
    # Config, keys, camera credentials and spool: SYSTEM and Administrators only (the Linux 0600/0700).
    # Set on the folder only, then make everything inside inherit it: applying /inheritance:r to files
    # would leave them with an empty ACL.
    & icacls $Data /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls failed ($LASTEXITCODE)" }
    if (Get-ChildItem -LiteralPath $Data -Force) {
        & icacls "$Data\*" /reset /T /C /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "icacls reset failed ($LASTEXITCODE)" }
    }
}

if (Want "Runtime") {
    Step "uv and Python 3.12"
    New-Item -ItemType Directory -Force -Path $Bin | Out-Null
    if (-not (Get-Uv)) {
        $env:UV_INSTALL_DIR = $Bin
        $env:UV_NO_MODIFY_PATH = "1"
        Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
        if (-not (Get-Uv)) { throw "uv was not installed" }
    }
    & (Get-Uv) python install 3.12
    if ($LASTEXITCODE -ne 0) { throw "uv python install failed" }
}

if (Want "Dependencies") {
    Step "Application and dependencies"
    # The zip package copies itself into place; the setup wizard has already placed the files.
    $srcFull = (Resolve-Path $Src).Path.TrimEnd("\")
    if ($srcFull -ne $Prefix.TrimEnd("\")) {
        # /MIR keeps the destination identical to the package; runtime folders are excluded (kept).
        & robocopy $Src $Prefix /MIR /NFL /NDL /NJH /NJS /NP /XD .venv python bin ffmpeg uv-cache tests __pycache__ .git /XF "*.pyc" "unins*.*" "retailguard.ico" | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
    }
    $uv = Get-Uv
    if (-not $uv) { throw "uv is missing: run the Runtime phase first" }
    Push-Location $Prefix
    try {
        & $uv sync --frozen --no-dev
        if ($LASTEXITCODE -ne 0) { throw "uv sync failed" }
    } finally { Pop-Location }
}

function Install-FfmpegFromZip([string]$zip) {
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
    if ($hash -ne $FfmpegSha256) { throw "ffmpeg download is corrupt or not the expected build (SHA-256 $hash)" }
    $bundled = Join-Path $Prefix "ffmpeg\bin"
    New-Item -ItemType Directory -Force -Path $bundled | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
        $wanted = $archive.Entries | Where-Object { $_.FullName -match '/bin/(ffmpeg|ffprobe)\.exe$' -or $_.FullName -match '^[^/]+/LICENSE$' }
        if (@($wanted | Where-Object { $_.Name -like "*.exe" }).Count -ne 2) { throw "ffmpeg.exe/ffprobe.exe not found in the archive" }
        foreach ($e in $wanted) {
            $dest = if ($e.Name -eq "LICENSE") { Join-Path (Split-Path $bundled) "LICENSE.txt" } else { Join-Path $bundled $e.Name }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
        }
    } finally { $archive.Dispose() }
}

if (Want "Ffmpeg") {
    Step "ffmpeg"
    if ($FfmpegZip) {
        Install-FfmpegFromZip $FfmpegZip
    } elseif (-not (Get-Ffmpeg)) {
        $zip = Join-Path $env:TEMP "retailguard-ffmpeg.zip"
        $curl = Join-Path $env:SystemRoot "System32\curl.exe"
        Write-Host "Downloading $FfmpegUrl"
        if (Test-Path $curl) {
            # Give up instead of hanging when the transfer stalls (< 10 KB/s for 60 s).
            & $curl -L --fail --retry 3 --retry-delay 5 --connect-timeout 30 --speed-time 60 --speed-limit 10240 `
                --silent --show-error -o $zip $FfmpegUrl
            if ($LASTEXITCODE -ne 0) { throw "ffmpeg download failed (curl exit $LASTEXITCODE)" }
        } else {
            Invoke-WebRequest -Uri $FfmpegUrl -OutFile $zip -UseBasicParsing -TimeoutSec 900
        }
        try { Install-FfmpegFromZip $zip } finally { Remove-Item -Force $zip -ErrorAction SilentlyContinue }
    }
}

if (Want "Configure") {
    Step "Configuration"
    if (-not (Test-Path $Config)) {
        $ff = Get-Ffmpeg
        if (-not $ff) { $ff = @("ffmpeg", "ffprobe") }
        $text = Get-Content -Raw -Path (Join-Path $Prefix "deploy\config.example.toml")
        $text = $text -replace '(?m)^api_base_url = .*$', "api_base_url = `"$Api`""
        $text = $text -replace '(?m)^state_dir = .*$', "state_dir = '$State'"
        $text = $text -replace '(?m)^\[edge\][ \t]*$', "[edge]`r`nffmpeg_path = '$($ff[0])'`r`nffprobe_path = '$($ff[1])'"
        [IO.File]::WriteAllText($Config, $text, (New-Object Text.UTF8Encoding($false)))
    }
    $cmd = @"
@echo off
rem RetailGuard edge CLI with the installed config and state. Run from an elevated prompt.
set "RETAILGUARD_EDGE_CONFIG=$Config"
"$Exe" --state-dir "$State" %*
"@
    [IO.File]::WriteAllText((Join-Path $Bin "retailguard-edge.cmd"), $cmd, (New-Object Text.ASCIIEncoding))
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    if (-not ($machinePath -split ";" | Where-Object { $_ -eq $Bin })) {
        [Environment]::SetEnvironmentVariable("Path", "$machinePath;$Bin", "Machine")
    }
}

if (Want "Service") {
    Step "Scheduled task"
    $action = New-ScheduledTaskAction -Execute $Exe `
        -Argument "--config `"$Config`" --state-dir `"$State`" --log-file `"$Logs\edge.log`" run" -WorkingDirectory $Prefix
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $runAs = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $runAs -Settings $settings `
        -Description "Ayonix RetailGuard store edge agent" -Force | Out-Null

    $version = & $Exe --version
    if (Test-Path (Join-Path $State "edge.json")) {
        Start-ScheduledTask -TaskName $TaskName
        Write-Host "==> RetailGuard edge $version installed and running." -ForegroundColor Green
    } elseif ($Phase -eq "All") {
        Write-Host ""
        Write-Host "==> RetailGuard edge $version installed." -ForegroundColor Green
        Write-Host "Next (open a NEW elevated PowerShell so PATH includes $Bin):"
        Write-Host "  retailguard-edge pair --api $Api --code <CODE> --name `"<appliance name>`""
        Write-Host "  Start-ScheduledTask -TaskName `"$TaskName`""
        Write-Host "  retailguard-edge status"
        Write-Host "Logs: $Logs\edge.log"
    }
}
