# Solarvy local dev setup (Windows)
# Installs LibreOffice for Excel recalculation and verifies the API.

$ErrorActionPreference = "Stop"

$soffice = "C:\Program Files\LibreOffice\program\soffice.com"
$msi = "$env:TEMP\solarvy-libreoffice.msi"
$msiUrl =
  "https://download.documentfoundation.org/libreoffice/stable/26.2.4/win/x86_64/LibreOffice_26.2.4_Win_x86-64.msi"

Write-Host "=== Solarvy local setup ===" -ForegroundColor Cyan

if (Test-Path $soffice) {
  Write-Host "LibreOffice already installed:" -ForegroundColor Green
  & $soffice --version
} else {
  if (-not (Test-Path $msi) -or (Get-Item $msi).Length -lt 300MB) {
    Write-Host "Downloading LibreOffice (~340 MB). This may take a few minutes..."
    Import-Module BitsTransfer
    Start-BitsTransfer -Source $msiUrl -Destination $msi -DisplayName "LibreOffice"
  }

  $sizeMb = [math]::Round((Get-Item $msi).Length / 1MB, 1)
  Write-Host "Installing LibreOffice ($sizeMb MB)..."
  Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /quiet /norestart" -Wait -NoNewWindow

  if (-not (Test-Path $soffice)) {
    throw "LibreOffice install failed — soffice.com not found at $soffice"
  }
  Write-Host "LibreOffice installed:" -ForegroundColor Green
  & $soffice --version
}

$envFile = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $PSScriptRoot "..\.env.example") $envFile
  Write-Host "Created .env from .env.example — set DATABASE_URL before starting."
}

Write-Host ""
Write-Host "Recalculation engine on Windows:" -ForegroundColor Cyan
if (Test-Path "C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE") {
  Write-Host "  Microsoft Excel COM is available (used when LibreOffice is not installed)."
}
Write-Host "  cd Backend && npm run dev"
Write-Host ""
Write-Host "Start the frontend (separate terminal):" -ForegroundColor Cyan
Write-Host "  cd Frontend && npm run dev"
Write-Host ""
Write-Host "Test Excel flows:" -ForegroundColor Cyan
Write-Host "  cd Backend && node scripts/test-excel.mjs"
