# Legado — a primeira arquitetura, em Jellyfin

Esta pasta guarda a **primeira tentativa** do Goiás Tec +: uma plataforma de vídeo própria
construída sobre o [Jellyfin](https://jellyfin.org), com os vídeos vindo do Google Drive por
rclone e um plugin C# para comentários ancorados no tempo.

**Foi substituída** pela arquitetura atual (`../catalogo/`): página estática no Cloudflare
Pages, vídeos no Bunny Stream, catálogo em KV. Nada aqui está em produção. Está guardado porque
o plugin e os componentes de comentário são código escrito à mão, não descartável.

Trabalho de 04–06/08/2026.

## O que tem aqui

| Caminho | O que é |
|---|---|
| `plugin/` | Plugin Jellyfin `GoiasTecPlus` (C# / .NET 9) — comentários, papéis, notificações, sync YouTube |
| `client/src/` | Componentes Vue customizados, versão de referência |
| `client/aplicado-no-fork/` | Os mesmos componentes, na versão que estava **realmente aplicada** no fork — difere de `src/` |
| `client/patches/` | `goiastec-customizacoes.patch` + `BASE-COMMIT.txt` — as alterações em arquivos upstream |
| `docker/`, `docker-compose.yml` | Imagem Jellyfin + yt-dlp + deno + Whisper, e o stack completo |
| `rclone/` | Config e scripts de mount do Shared Drive |
| `data/` | Dados locais do Jellyfin (banco, config, usuários) — fora do git |
| `docs/` | `SETUP.md`, `ARCHITECTURE.md`, `GUIA-PASSO-A-PASSO.md`, `RESUMO-SESSAO.md` |

## O que foi apagado, e por quê

`client/jellyfin-vue/` — o clone do upstream com `node_modules`, 865 MB e 34 mil arquivos.
Era 98% do peso do repositório inteiro e é integralmente reproduzível.

**Nada de autoral se perdeu**, mas a restauração tem três passos, não um — o fork tinha
alterações que não estavam em `client/src/`:

```bash
git clone https://github.com/jellyfin/jellyfin-vue.git
cd jellyfin-vue
git checkout $(cat ../client/patches/BASE-COMMIT.txt)   # 01f11ae
pnpm install

# 1. arquivos upstream modificados (7 arquivos, 277 linhas)
git apply ../client/patches/goiastec-customizacoes.patch

# 2. arquivos novos (8), na versão que estava aplicada
cp -r ../client/aplicado-no-fork/packages ./
```

> `client/src/` e `client/aplicado-no-fork/` **não são iguais**. `src/` é a versão de referência,
> organizada por tipo (`components/`, `composables/`, `stores/`); `aplicado-no-fork/` é a que
> estava de fato dentro do clone, no layout de pastas do jellyfin-vue. Ao restaurar, use
> `aplicado-no-fork/` — é o estado real em que o trabalho parou.
