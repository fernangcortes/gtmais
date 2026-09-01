<#
  scripts/legendas-whisper.ps1 — Task 3.3: transcrever o acervo em CPU.

  A máquina não tem GPU, então isto é a tarefa mais longa do projeto em tempo
  de máquina. Roda sozinha: deixe rodando fora do horário de trabalho.

  A saída .srt fica AO LADO do master, com o mesmo nome — é onde
  scripts/capas-legendas.mjs e scripts/sinopses.mjs vão procurar.

  Pré-requisito (uma vez só):
      pip install whisper-ctranslate2

  Uso:
      .\scripts\legendas-whisper.ps1                 todos os que faltam
      .\scripts\legendas-whisper.ps1 -Piloto         só o lote-piloto
      .\scripts\legendas-whisper.ps1 -Modelo small   mais rápido, menos preciso

  Retomável: pula qualquer título que já tenha .srt ao lado. Interromper com
  Ctrl+C e recomeçar depois não perde trabalho.
#>

[CmdletBinding()]
param(
  [string]$Catalogo = (Join-Path $PSScriptRoot '..\..\catalogo.seed.json'),
  [string]$Modelo   = 'medium',
  [int]$Threads     = 0,
  [switch]$Piloto
)

$ErrorActionPreference = 'Stop'

$exe = Get-Command whisper-ctranslate2 -ErrorAction SilentlyContinue
if (-not $exe) {
  Write-Error @'
whisper-ctranslate2 não está no PATH.

  pip install whisper-ctranslate2

(é o CLI do faster-whisper; o pacote faster-whisper sozinho é só biblioteca)
'@
  exit 1
}

if ($Threads -le 0) {
  $Threads = [Math]::Max(1, [Environment]::ProcessorCount - 2)
}

$dados = Get-Content -Path $Catalogo -Raw -Encoding UTF8 | ConvertFrom-Json
$itens = $dados.itens
if ($Piloto) { $itens = $itens | Where-Object { $_.piloto -eq $true } }

$fila = @()
foreach ($item in $itens) {
  $mp4 = $item.caminho_local
  if (-not (Test-Path -LiteralPath $mp4)) {
    Write-Warning "arquivo ausente, pulando: $mp4"
    continue
  }
  $srt = [IO.Path]::ChangeExtension($mp4, '.srt')
  if (Test-Path -LiteralPath $srt) { continue }
  $fila += [pscustomobject]@{ Titulo = $item.titulo; Mp4 = $mp4; Srt = $srt; Seg = $item.duracao_seg }
}

if ($fila.Count -eq 0) {
  Write-Host 'nada a transcrever — todos já têm .srt ao lado do master.'
  exit 0
}

$totalSeg = ($fila | Measure-Object -Property Seg -Sum).Sum
Write-Host ''
Write-Host "a transcrever: $($fila.Count) títulos, $([Math]::Round($totalSeg/3600,1)) h de vídeo"
Write-Host "modelo: $Modelo   threads: $Threads"
Write-Host 'em CPU, conte com algo entre 1x e 3x a duração do vídeo por título.'
Write-Host ''

$feitos = 0
$inicio = Get-Date

foreach ($t in $fila) {
  $feitos++
  $marca = Get-Date -Format 'HH:mm:ss'
  Write-Host "$marca  [$feitos/$($fila.Count)] $($t.Titulo)"

  $pasta = Split-Path -Parent $t.Mp4
  $argsWhisper = @(
    $t.Mp4,
    '--model', $Modelo,
    '--language', 'pt',
    '--task', 'transcribe',
    '--output_format', 'srt',
    '--output_dir', $pasta,
    '--threads', $Threads,
    '--vad_filter', 'True'
  )

  $t0 = Get-Date
  try {
    & whisper-ctranslate2 @argsWhisper
    if ($LASTEXITCODE -ne 0) { throw "whisper-ctranslate2 saiu com código $LASTEXITCODE" }
    $gasto = [Math]::Round(((Get-Date) - $t0).TotalMinutes, 1)
    Write-Host "          ok em $gasto min -> $(Split-Path -Leaf $t.Srt)"
  } catch {
    Write-Warning "          falhou: $($_.Exception.Message)"
  }
}

$total = [Math]::Round(((Get-Date) - $inicio).TotalHours, 2)
Write-Host ''
Write-Host "concluído em $total h."
Write-Host 'próximos passos:'
Write-Host '  node scripts/sinopses.mjs        (Task 3.4 — sinopses a partir das legendas)'
Write-Host '  node scripts/capas-legendas.mjs  (Task 3.2 — subir as legendas ao Bunny)'
