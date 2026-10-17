# CI only: drive the setup wizard on the runner's desktop, capture each page and check the Cancel paths.
#   screenshots.ps1 -Setup <exe> -Out <dir> -Lang en|ja -Mode fresh|update|cancel [-Log <file>]
#   fresh:  welcome, license, server, mode, ready (then closed before installing)
#   update: welcome, ready, installing, connect, rejected code, Cancel on the connect page -> finished
#   cancel: Cancel while the installation steps run -> confirm -> finished page says where it stopped
param([string]$Setup, [string]$Out, [string]$Lang = "en", [string]$Mode = "fresh", [string]$Log = "")
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  // A visible standard dialog (message box) owned by the process.
  public static IntPtr Dialog(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h)) return true;
      var sb = new StringBuilder(64); GetClassName(h, sb, 64);
      if (sb.ToString() == "#32770") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
[W]::SetProcessDPIAware() | Out-Null
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$IDOK = 1; $IDYES = 6; $WM_COMMAND = 0x0111

function Wizard {
    for ($i = 0; $i -lt 60; $i++) {
        $p = Get-Process | Where-Object { $_.MainWindowTitle -like "*RetailGuard*" -and $_.MainWindowHandle -ne 0 } |
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

function ShotScreen([string]$name) {
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save((Join-Path $Out "$Lang-$Mode-$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}

function Keys([string]$k) {
    $p = Wizard
    [W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait($k)
}

# Answers the wizard's message box with a button id (IDYES/IDOK); returns false when none appeared.
function Answer([int]$id, [int]$waitS = 15) {
    $p = Wizard
    for ($i = 0; $i -lt $waitS * 4; $i++) {
        $d = [W]::Dialog([uint32]$p.Id)
        if ($d -ne [IntPtr]::Zero) {
            [W]::PostMessage($d, $WM_COMMAND, [IntPtr]$id, [IntPtr]::Zero) | Out-Null
            Start-Sleep -Milliseconds 500
            return $true
        }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

function WaitForLog([datetime]$started, [string]$pattern, [int]$timeoutS = 300) {
    for ($i = 0; $i -lt $timeoutS * 4; $i++) {
        Start-Sleep -Milliseconds 250
        $log = Get-ChildItem "$env:ProgramData\RetailGuard\Edge\logs\setup-*.log" -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -ge $started } | Sort-Object LastWriteTime | Select-Object -Last 1
        if ($log) {
            $fs = [IO.File]::Open($log.FullName, "Open", "Read", "ReadWrite")
            try { $text = (New-Object IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Dispose() }
            if ($text -match $pattern) { return }
        }
    }
}

$setupArgs = @("/LANG=$Lang")
if ($Log) { $setupArgs += "/LOG=$Log" }
$proc = Start-Process $Setup -ArgumentList $setupArgs -PassThru
try {
    Shot "1-welcome"
    if ($Mode -eq "fresh") {
        Keys "{ENTER}"; Shot "2-license"
        Keys "%a"; Keys "{ENTER}"; Shot "3-server"
        Keys "{ENTER}"; Shot "4-mode"
        Keys "{ENTER}"; Shot "5-ready"
    } elseif ($Mode -eq "update") {
        Keys "{ENTER}"; Shot "2-ready"
        $started = Get-Date
        Keys "{ENTER}"                                   # install (update) starts
        Start-Sleep -Milliseconds 300; Shot "3-installing"
        WaitForLog $started "Scheduled task"             # the "Connect" page follows the last step
        Start-Sleep -Seconds 6; Shot "4-connect"
        Keys "AAAA-BBBB-CCCC"; Keys "{ENTER}"            # a code the server rejects
        Start-Sleep -Seconds 6; Shot "5-pair-error"
        if (-not (Answer $IDOK)) { throw "pairing error message not shown" }
        Keys "{ESC}"                                     # Cancel on the connect page
        Start-Sleep -Seconds 1; ShotScreen "6-skip-connect-question"
        if (-not (Answer $IDYES)) { throw "Cancel on the connect page did not ask to finish without connecting" }
        Start-Sleep -Seconds 2; Shot "7-finished"
    } elseif ($Mode -eq "cancel") {
        Keys "{ENTER}"
        $started = Get-Date
        Keys "{ENTER}"                                   # install (update) starts
        WaitForLog $started "==> Folders" 60             # a step is running
        Keys "{ESC}"                                     # Cancel while the steps run
        Start-Sleep -Seconds 1; ShotScreen "2-cancel-question"
        if (-not (Answer $IDYES)) { throw "Cancel during the steps did not ask for confirmation" }
        Start-Sleep -Seconds 8; Shot "3-finished"
    }
} finally {
    Get-Process | Where-Object { $_.MainWindowTitle -like "*RetailGuard*" -or $_.Path -like "*\is-*.tmp\*" } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    if (-not $proc.HasExited) { $proc | Stop-Process -Force -ErrorAction SilentlyContinue }
}
