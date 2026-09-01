# Sync do Google Drive (Goiás Tec +) para uma pasta local
#
# Faz rclone sync do remote goiastec (pasta do Drive) para D:\GoiasTecMedia,
# que é a pasta bind-mountada no Jellyfin como biblioteca.
#
# Uso:
#   .\rclone\sync.ps1
#   .\rclone\sync.ps1 -Remote "goiastec:03. Midias e Fotos/Backup 11／2025/Mudança CriaLab "
#
# Dica: agende no Agendador do Windows (ex.: a cada 30 min ou diário) para manter
# a cópia local atualizada com o Drive.

param(
    [string]$Remote = "goiastec:03. Midias e Fotos/Backup 11／2025/Mudança CriaLab ",
    [string]$Destiny = "D:\GoiasTecMedia",
    [string]$Config = (Join-Path $PSScriptRoot "rclone.conf")
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
    Write-Host "rclone não encontrado. Instale: winget install Rclone.Rclone" -ForegroundColor Red
    exit 1
}

Write-Host "Sincronizando:" -ForegroundColor Cyan
Write-Host "  Origem : $Remote"
Write-Host "  Destino: $Destiny"

New-Item -ItemType Directory -Force -Path $Destiny | Out-Null

rclone sync $Remote $Destiny `
    --config $Config `
    --transfers 4 `
    --progress

Write-Host "`nSync concluído." -ForegroundColor Green
