# Alternativa: montar o Shared Drive direto no Windows (exige WinFsp)
#
#   winget install WinFsp.WinFsp
#
# Uso:  .\rclone\mount.ps1 -DriveLetter X
# Ctrl+C para desmontar.

param(
    [string]$DriveLetter = "X",
    [string]$Remote = "goiastec:Videos"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
    Write-Host "rclone não encontrado. Instale: winget install Rclone.Rclone" -ForegroundColor Red
    exit 1
}

Write-Host "Montando $Remote em ${DriveLetter}: ..." -ForegroundColor Cyan
rclone mount $Remote "${DriveLetter}:" `
    --config (Join-Path $PSScriptRoot "rclone.conf") `
    --vfs-cache-mode full `
    --vfs-cache-max-size 100G `
    --read-only `
    --volname "GoiasTec"
