# Imagem custom do Jellyfin para o Goiás Tec +
#
# Adiciona sobre a imagem oficial:
#   - libgomp1        : dependência de runtime do whisper-cli (CPU)
#   - yt-dlp + deno   : download de legendas automáticas do YouTube
#
# O binário whisper-cli e os modelos GGML são baixados pela UI do plugin
# WhisperSubs (Dashboard > Plugins > WhisperSubs) ou montados em /opt/whisper.

FROM jellyfin/jellyfin:latest

# libs de runtime do Whisper (CPU)
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp + deno (legendas automáticas do YouTube)
# unzip é necessário: o script de instalação do Deno exige unzip ou 7z no container.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates python3 python3-pip unzip \
 && pip3 install --break-system-packages --no-cache-dir -U yt-dlp \
 && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh -s -- -y \
 && rm -rf /var/lib/apt/lists/*

ENV PATH="${PATH}:/usr/local/bin"

# Healthcheck básico (opcional)
# HEALTHCHECK --interval=30s --timeout=10s --start-period=40s \
#   CMD wget -q -O /dev/null http://localhost:8096/health || exit 1
