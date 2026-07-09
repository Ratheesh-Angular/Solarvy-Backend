# Recalculate an Excel workbook using Microsoft Excel COM (Windows local dev fallback).
param(
  [Parameter(Mandatory = $true)][string]$InputPath
)

$InputPath = (Resolve-Path $InputPath).Path

if (-not (Test-Path $InputPath)) {
  Write-Error "Workbook not found: $InputPath"
  exit 1
}

$excel = $null
$wb = $null

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  $excel.ScreenUpdating = $false

  # ReadWrite:=False lets Excel open faster; we save back to the same path.
  $wb = $excel.Workbooks.Open($InputPath, 0, $false)
  $excel.CalculateFullRebuild()
  $wb.Save()
  $wb.Close($false)
}
finally {
  if ($wb) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb) }
  if ($excel) {
    $excel.Quit()
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

Write-Output "OK"
