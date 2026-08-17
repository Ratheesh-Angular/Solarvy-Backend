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

function Set-BackupDuration($ws, $hours) {
  if ($null -eq $hours -or "$hours" -eq "") { return $false }
  $addr = "B25"
  try {
    $cell = $ws.Range($addr)
    # Dropdown validation can reject/ silently block numeric writes; relax for this cell.
    try { $cell.Validation.ShowError = $false } catch { }
    try { $cell.Validation.Delete() } catch { }
    $cell.Value2 = [double]$hours
    $written = $cell.Value2
    Write-Output "COM_SET B25=$written (requested=$hours)"
    return ($null -ne $written -and [Math]::Abs([double]$written - [double]$hours) -lt 0.01)
  } catch {
    Write-Output "COM_SET B25 FAILED: $_"
    return $false
  }
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
      $okBackup = Set-BackupDuration $ui $inputs.backupDuration
      if (-not $okBackup) {
        # Retry as text matching the dropdown list ("1"…"8")
        try {
          $ui.Range("B25").Value2 = [string]([int][double]$inputs.backupDuration)
          Write-Output "COM_SET B25 retry text=$($ui.Range('B25').Value2)"
        } catch {
          Write-Output "COM_SET B25 retry failed: $_"
        }
      }
    }
    if ($null -ne $inputs.gridTariff -and "$($inputs.gridTariff)" -ne "") {
      Set-CellValue $ui "B30" ([double]$inputs.gridTariff)
    }
    if ($null -ne $inputs.monthlySpend -and "$($inputs.monthlySpend)" -ne "") {
      $bill.Range("B6").Value2 = [double]$inputs.monthlySpend
      Write-Output "COM_SET B6spend=$($bill.Range('B6').Value2)"
    }

    # Appliance rows (user + template zone values) when provided
    if ($null -ne $inputs.applianceRows) {
      $app = $wb.Worksheets.Item("Appliance_Input")
      $table = $inputs.applianceTable
      $startRow = 4
      $templateEnd = 20
      $endRow = 40
      if ($null -ne $table) {
        if ($null -ne $table.startRow) { $startRow = [int]$table.startRow }
        if ($null -ne $table.templateEndRow) { $templateEnd = [int]$table.templateEndRow }
        if ($null -ne $table.endRow) { $endRow = [int]$table.endRow }
      }

      $referenced = @{}
      foreach ($row in @($inputs.applianceRows)) {
        $r = [int]$row.excelRow
        if ($r -lt $startRow -or $r -gt $endRow) { continue }
        $referenced[$r] = $true
        if ($row.source -eq "user" -or $r -gt $templateEnd) {
          Set-CellValue $app ("A" + $r) $row.name
        }
        $app.Range("B$r").Value2 = [double](0 + $row.qty)
        $app.Range("C$r").Value2 = [double](0 + $row.watts)
        $app.Range("D$r").Value2 = [double](0 + $row.hours)
        $app.Range("E$r").Value2 = [double](0 + $row.dutyCycle)
      }

      # Clear unused template-zone input cells (keep name formulas in A)
      for ($r = $startRow; $r -le $templateEnd; $r++) {
        if ($referenced.ContainsKey($r)) { continue }
        $app.Range("B$r").Value2 = $null
        $app.Range("C$r").Value2 = $null
        $app.Range("D$r").Value2 = $null
        $app.Range("E$r").Value2 = $null
      }

      # Clear unused user-zone rows entirely (A–E)
      $userStart = $templateEnd + 1
      for ($r = $userStart; $r -le $endRow; $r++) {
        if ($referenced.ContainsKey($r)) { continue }
        $app.Range("A$r").Value2 = $null
        $app.Range("B$r").Value2 = $null
        $app.Range("C$r").Value2 = $null
        $app.Range("D$r").Value2 = $null
        $app.Range("E$r").Value2 = $null
      }
    }

    if ($null -ne $inputs.customRows) {
      $cust = $wb.Worksheets.Item("Custom_Equipment")
      $ctable = $inputs.customTable
      $cStart = 4
      $cEnd = 23
      if ($null -ne $ctable) {
        if ($null -ne $ctable.startRow) { $cStart = [int]$ctable.startRow }
        if ($null -ne $ctable.endRow) { $cEnd = [int]$ctable.endRow }
      }

      $customRef = @{}
      $customRowsList = @($inputs.customRows)
      Write-Output "COM_CUSTOM rows=$($customRowsList.Count)"
      foreach ($row in $customRowsList) {
        $r = [int]$row.excelRow
        if ($r -lt $cStart -or $r -gt $cEnd) { continue }
        $customRef[$r] = $true
        Set-CellValue $cust ("A" + $r) $row.name
        # Always write numerics (including 0). Avoid $null -ne checks that miss JSON note properties.
        $cust.Range("B$r").Value2 = [double](0 + $row.watts)
        $cust.Range("C$r").Value2 = [double](0 + $row.loadFactor)
        $cust.Range("D$r").Value2 = [double](0 + $row.qty)
        $cust.Range("E$r").Value2 = [double](0 + $row.hours)
        Write-Output "COM_CUSTOM r=$r B=$($cust.Range('B'+$r).Value2) C=$($cust.Range('C'+$r).Value2) D=$($cust.Range('D'+$r).Value2) E=$($cust.Range('E'+$r).Value2)"
      }

      for ($r = $cStart; $r -le $cEnd; $r++) {
        if ($customRef.ContainsKey($r)) { continue }
        $cust.Range("A$r").Value2 = $null
        $cust.Range("B$r").Value2 = $null
        $cust.Range("C$r").Value2 = $null
        $cust.Range("D$r").Value2 = $null
        $cust.Range("E$r").Value2 = $null
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
  try { Materialize-RangeValues $wb.Worksheets.Item("Appliance_Input") @(
      "L4", "L5", "L6",
      "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "G13", "G14", "G15", "G16", "G17", "G18", "G19", "G20",
      "G21", "G22", "G23", "G24", "G25", "G26", "G27", "G28", "G29", "G30", "G31", "G32", "G33", "G34", "G35", "G36", "G37", "G38", "G39", "G40"
    ) } catch { }
  try { Materialize-RangeValues $wb.Worksheets.Item("Custom_Equipment") @(
      "M4", "M5", "M7",
      "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "G13", "G14", "G15", "G16", "G17", "G18", "G19", "G20", "G21", "G22", "G23"
    ) } catch { }
  try {
    Materialize-RangeValues $wb.Worksheets.Item("Outputs") @(
      "B4", "B5", "B6", "B7", "B8", "B9",
      "B10", "B11", "B12", "B13", "B14", "B15", "B16", "B17", "B18", "B19", "B20",
      "B21", "B22", "B23", "B24", "B25",
      "B27", "B28", "B29",
      "B31",
      "B34", "B35", "B36", "B40", "B41", "B46"
    )
  } catch { }

  try {
    $loadB4 = $wb.Worksheets.Item("Load_Estimation").Range("B4").Value2
    $loadB8 = $wb.Worksheets.Item("Load_Estimation").Range("B8").Value2
    $outB10 = $wb.Worksheets.Item("Outputs").Range("B10").Value2
    $outB11 = $wb.Worksheets.Item("Outputs").Range("B11").Value2
    $uiB25 = $wb.Worksheets.Item("User_Inputs").Range("B25").Value2
    Write-Output "COM_DIAG method=$loadB4 monthly=$loadB8 solar=$outB10 battery=$outB11 backup=$uiB25"
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
