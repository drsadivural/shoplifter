# CI only: drive the setup wizard and capture each page (Windows runner desktop session).
#   screenshots.ps1 -Setup <exe> -Out <dir> -Lang en|ja -Mode fresh|update
param([string]$Setup, [string]$Out, [string]$Lang = "en", [string]$Mode = "fresh")
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public static class W {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[W]::SetProcessDPIAware() | Out-Null
New-Item -ItemType Directory -Force -Path $Out | Out-Null

function Wizard {
    for ($i = 0; $i -lt 60; $i++) {
        $p = Get-Process | Where-Object { $_.MainWindowTitle -like "*RetailGuard Edge*" -and $_.MainWindowHandle -ne 0 } |
            Select-Object -First 1
        if ($p) { return $p }
        Start-Sleep -Milliseconds 500
    }
    throw "setup window not found"
}

function Shot([string]$name) {
    Start-Sleep -Milliseconds 900
    $p = Wizard
    [W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 300
    $r = New-Object RECT
    [W]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
    $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
    $bmp.Save((Join-Path $Out "$Lang-$Mode-$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}

function Keys([string]$k) {
    $p = Wizard
    [W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait($k)
}

$proc = Start-Process $Setup -ArgumentList "/LANG=$Lang" -PassThru
try {
    Shot "1-welcome"
    if ($Mode -eq "fresh") {
        Keys "{ENTER}"; Shot "2-license"
        Keys "%a"; Keys "{ENTER}"; Shot "3-server"
        Keys "{ENTER}"; Shot "4-ready"
    } else {
        Keys "{ENTER}"; Shot "2-ready"
        $log = "$env:ProgramData\RetailGuard\Edge\logs\setup.log"
        $offset = (Get-Item $log).Length
        Keys "{ENTER}"                                   # install (update) starts
        Start-Sleep -Seconds 4; Shot "3-installing"
        # wait until this run's last phase has written to the log: the "Connect" page follows
        for ($i = 0; $i -lt 150; $i++) {
            Start-Sleep -Seconds 2
            $fs = [IO.File]::Open($log, "Open", "Read", "ReadWrite")
            try { $fs.Seek($offset, "Begin") | Out-Null; $new = (New-Object IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Dispose() }
            if ($new -match "Scheduled task") { break }
        }
        Start-Sleep -Seconds 6; Shot "4-connect"
        Keys "AAAA-BBBB-CCCC"; Keys "{ENTER}"            # a code the server rejects
        Start-Sleep -Seconds 6; Shot "5-pair-error"
    }
} finally {
    Get-Process | Where-Object { $_.MainWindowTitle -like "*RetailGuard Edge*" -or $_.Path -like "*\is-*.tmp\*" } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    if (-not $proc.HasExited) { $proc | Stop-Process -Force -ErrorAction SilentlyContinue }
}
