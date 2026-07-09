param(
  [int]$Port = 5000
)

$connections = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue

if (-not $connections) {
  Write-Host "Port $Port is free"
  exit 0
}

$processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique

foreach ($processId in $processIds) {
  if ($processId -eq $PID) { continue }

  try {
    $proc = Get-Process -Id $processId -ErrorAction Stop
    Write-Host "Stopping process on port ${Port} - PID=${processId} Name=$($proc.ProcessName)"
    Stop-Process -Id $processId -Force -ErrorAction Stop
  }
  catch {
    Write-Host "Could not stop PID ${processId} - $($_.Exception.Message)"
  }
}

Start-Sleep -Milliseconds 500

$stillListening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($stillListening) {
  Write-Host "Warning: port $Port is still in use"
  exit 1
}

Write-Host "Port $Port is now free"
