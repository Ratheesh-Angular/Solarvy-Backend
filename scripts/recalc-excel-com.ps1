# Recalculate workbook via Excel COM.
# Optionally force-write inputs from JSON so the calc chain is dirtied in Excel
# (ExcelJS writes alone often leave formula caches stale).
param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $false)][string]$InputsJson = ""
)

$InputPath = (Resolve-Path $InputPath).Path

if (-not (Test-Path $InputPath)) {
  Write-Error "Workbook not found: $InputPath"
  exit 1
}

$excel = $null
$wb = $null

function Materialize-RangeValues($ws, $addrs) {
  foreach ($addr in $addrs) {
    try {
      $cell = $ws.Range($addr)
      $val = $cell.Value2
      if ($null -ne $val) {
        $cell.Value2 = $val
      }
    } catch { }
  }
}

function Set-CellValue($ws, $addr, $value) {
  if ($null -eq $value) { return }
  if ($value -is [string] -and $value.Trim() -eq "") { return }
  try {
    $ws.Range($addr).Value2 = $value
  } catch { }
}

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  $excel.ScreenUpdating = $false
  $excel.EnableEvents = $false
  try { $excel.Calculation = -4135 } catch { } # manual while writing

  $wb = $excel.Workbooks.Open($InputPath, 0, $false)
  try { $excel.CalculateBeforeSave = $true } catch { }
  try { $wb.ForceFullCalculation = $true } catch { }

  foreach ($ws in $wb.Worksheets) {
    try { $ws.EnableCalculation = $true } catch { }
  }

  if ($InputsJson -and (Test-Path $InputsJson)) {
    $inputs = Get-Content -Raw -Path $InputsJson | ConvertFrom-Json
    $ui = $wb.Worksheets.Item("User_Inputs")
    $bill = $wb.Worksheets.Item("Bill_Input")

    Set-CellValue $ui "B7" $inputs.country
    Set-CellValue $ui "B8" $inputs.city
    Set-CellValue $ui "B10" $inputs.propertyType
    Set-CellValue $ui "B11" $inputs.template
    Set-CellValue $ui "B13" $inputs.powerSetup
    Set-CellValue $ui "B14" $inputs.mainObjective
    Set-CellValue $ui "B15" $inputs.inputMethod
    # Always write numeric usage/spend/tariff when present (including 0).
    if ($inputs.PSObject.Properties.Name -contains "monthlyUsageKwh" -and $null -ne $inputs.monthlyUsageKwh -and "$($inputs.monthlyUsageKwh)" -ne "") {
      $ui.Range("B18").Value2 = [double]$inputs.monthlyUsageKwh
      Write-Output "COM_SET B18=$($ui.Range('B18').Value2)"
    }
    if ($null -ne $inputs.roofArea -and "$($inputs.roofArea)" -ne "") {
      Set-CellValue $ui "B21" ([double]$inputs.roofArea)
    }
    if ($null -ne $inputs.backupDuration -and "$($inputs.backupDuration)" -ne "") {
      Set-CellValue $ui "B25" ([double]$inputs.backupDuration)
    }
    if ($null -ne $inputs.gridTariff -and "$($inputs.gridTariff)" -ne "") {
      Set-CellValue $ui "B30" ([double]$inputs.gridTariff)
    }
    if ($null -ne $inputs.monthlySpend -and "$($inputs.monthlySpend)" -ne "") {
      $bill.Range("B6").Value2 = [double]$inputs.monthlySpend
      Write-Output "COM_SET B6spend=$($bill.Range('B6').Value2)"
    }

    # Appliance rows (user + template zone values) when provided
    if ($inputs.applianceRows) {
      $app = $wb.Worksheets.Item("Appliance_Input")
      foreach ($row in $inputs.applianceRows) {
        $r = [int]$row.excelRow
        if ($r -lt 4) { continue }
        if ($row.source -eq "user" -or $r -ge 21) {
          Set-CellValue $app ("A" + $r) $row.name
        }
        if ($null -ne $row.qty) { Set-CellValue $app ("B" + $r) ([double]$row.qty) }
        if ($null -ne $row.watts) { Set-CellValue $app ("C" + $r) ([double]$row.watts) }
        if ($null -ne $row.hours) { Set-CellValue $app ("D" + $r) ([double]$row.hours) }
        if ($null -ne $row.dutyCycle) { Set-CellValue $app ("E" + $r) ([double]$row.dutyCycle) }
      }
    }

    if ($inputs.customRows) {
      $cust = $wb.Worksheets.Item("Custom_Equipment")
      foreach ($row in $inputs.customRows) {
        $r = [int]$row.excelRow
        if ($r -lt 4) { continue }
        Set-CellValue $cust ("A" + $r) $row.name
        if ($null -ne $row.watts) { Set-CellValue $cust ("B" + $r) ([double]$row.watts) }
        if ($null -ne $row.loadFactor) { Set-CellValue $cust ("C" + $r) ([double]$row.loadFactor) }
        if ($null -ne $row.qty) { Set-CellValue $cust ("D" + $r) ([double]$row.qty) }
        if ($null -ne $row.hours) { Set-CellValue $cust ("E" + $r) ([double]$row.hours) }
      }
    }
  } else {
    # Fallback: retouch existing User_Inputs / Bill values
    try {
      $ui = $wb.Worksheets.Item("User_Inputs")
      foreach ($addr in @("B7", "B8", "B10", "B11", "B13", "B14", "B15", "B18", "B21", "B25", "B30")) {
        $current = $ui.Range($addr).Value2
        if ($null -ne $current) { $ui.Range($addr).Value2 = $current }
      }
      $bill = $wb.Worksheets.Item("Bill_Input")
      $spend = $bill.Range("B6").Value2
      if ($null -ne $spend) { $bill.Range("B6").Value2 = $spend }
    } catch { }
  }

  try { $excel.Calculation = -4105 } catch { } # automatic
  try { $excel.CalculateFullRebuild() } catch { }
  Start-Sleep -Milliseconds 600
  try { $excel.CalculateFull() } catch { }
  Start-Sleep -Milliseconds 600
  foreach ($ws in $wb.Worksheets) {
    try { $ws.Calculate() } catch { }
  }
  try { $excel.CalculateUntilAsyncQueriesDone() } catch { }
  try { $excel.CalculateFull() } catch { }
  Start-Sleep -Milliseconds 400

  # Materialize Excel-calculated results into temp file for ExcelJS.
  try { Materialize-RangeValues $wb.Worksheets.Item("Bill_Input") @("B5", "B7", "B9", "B10", "B11") } catch { }
  try { Materialize-RangeValues $wb.Worksheets.Item("Load_Estimation") @("B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12") } catch { }
  try { Materialize-RangeValues $wb.Worksheets.Item("Solar_Sizing") @("B5", "B7", "B8", "B10", "B11", "B12", "B13", "B14") } catch { }
  try { Materialize-RangeValues $wb.Worksheets.Item("Battery_Sizing") @("B5", "B6", "B8", "B9", "B10", "B11", "B12") } catch { }
  try { Materialize-RangeValues $wb.Worksheets.Item("Diesel_Economics") @("B5", "B6", "B7", "B8", "B9") } catch { }
  try { Materialize-RangeValues $wb.Worksheets.Item("Financial_Model") @("B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12", "B13") } catch { }
  try { Materialize-RangeValues $wb.Worksheets.Item("Appliance_Input") @("L4", "L5", "L6") } catch { }
  try { Materialize-RangeValues $wb.Worksheets.Item("Custom_Equipment") @("M4", "M5", "M7") } catch { }
  try {
    Materialize-RangeValues $wb.Worksheets.Item("Outputs") @(
      "B4", "B5", "B6", "B7", "B8", "B9",
      "B10", "B11", "B12", "B13", "B14", "B15", "B16", "B17", "B18", "B19", "B20",
      "B21", "B22", "B23", "B24", "B25",
      "B27", "B28", "B29",
      "B31"
    )
  } catch { }

  try {
    $loadB4 = $wb.Worksheets.Item("Load_Estimation").Range("B4").Value2
    $loadB8 = $wb.Worksheets.Item("Load_Estimation").Range("B8").Value2
    $outB10 = $wb.Worksheets.Item("Outputs").Range("B10").Value2
    Write-Output "COM_DIAG method=$loadB4 monthly=$loadB8 solar=$outB10"
  } catch {
    Write-Output "COM_DIAG unavailable"
  }

  $wb.Save()
  $wb.Close($false)
  Write-Output "OK_RECALC"
}
catch {
  Write-Error $_
  exit 1
}
finally {
  if ($wb) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb) }
  if ($excel) {
    try { $excel.Quit() } catch { }
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
