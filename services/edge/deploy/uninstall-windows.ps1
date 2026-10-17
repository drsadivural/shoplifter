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

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
[Environment]::SetEnvironmentVariable("Path", (($machinePath -split ";") | Where-Object { $_ -and $_ -ne $Bin }) -join ";", "Machine")
if (Test-Path $Prefix) { Remove-Item -Recurse -Force $Prefix }
if ($RemoveData -and (Test-Path $Data)) { Remove-Item -Recurse -Force $Data }
Write-Host "RetailGuard edge removed$(if (-not $RemoveData) { ' (data kept in ' + $Data + ')' })."
