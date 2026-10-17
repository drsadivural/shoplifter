# Remove the RetailGuard edge software from Windows. Run from an elevated PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\deploy\uninstall-windows.ps1 [-RemoveData]
# Without -RemoveData the pairing identity, config and camera credentials in
# %ProgramData%\RetailGuard\Edge are kept (revoke the appliance in the console if it will not return).
[CmdletBinding()]
param([switch]$RemoveData)
$ErrorActionPreference = "Stop"
$Prefix = Join-Path $env:ProgramFiles "RetailGuard\Edge"
$Bin = Join-Path $Prefix "bin"
$Data = Join-Path $env:ProgramData "RetailGuard\Edge"
$TaskName = "RetailGuard Edge"

function Remove-Tree([string]$Path) {
    # Files can stay locked for a moment after the agent stops (or while antivirus scans them).
    for ($i = 1; $i -le 10; $i++) {
        if (-not (Test-Path $Path)) { return }
        try {
            Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue |
                ForEach-Object { try { $_.Attributes = "Normal" } catch { } }
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
            return
        } catch {
            if ($i -eq 10) { throw }
            Start-Sleep -Seconds 2
        }
    }
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
# The agent and any ffmpeg it started must not hold files open.
Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and ($_.Path -like "$Prefix\*")
} | Stop-Process -Force -ErrorAction SilentlyContinue
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
[Environment]::SetEnvironmentVariable("Path", (($machinePath -split ";") | Where-Object { $_ -and $_ -ne $Bin }) -join ";", "Machine")
Remove-Tree $Prefix
if ($RemoveData) { Remove-Tree $Data }
Write-Host "RetailGuard edge removed$(if (-not $RemoveData) { ' (data kept in ' + $Data + ')' })."
