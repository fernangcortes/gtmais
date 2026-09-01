# Goiás Tec + — Resumo da Sessão de Implantação

**Data:** 2026-08-04/05 · **Ambiente:** Windows 10, Docker Desktop (WSL2), terminal Git Bash
**Projeto:** `C:\Users\FGC\Desktop\programas\goias-tec-+`

---

## 1. Visão geral do sistema

Servidor de mídia **Jellyfin** com plugin de comentários/colaboração **GoiasTecPlus**, alimentado por um **Google Drive** (fonte de vídeos), com player customizado baseado em **Jellyfin Vue**.

```
Google Drive (pessoal do FGC, pasta de teste)
        │  rclone sync → D:\GoiasTecMedia
        ▼
   ┌─────────────────────────────────────┐
   │  Jellyfin (Docker, porta mínima)    │
   │   • Plugin GoiasTecPlus (comentários)│
   │   • 7 vídeos em /media/goiastec      │
   │   • Cache em D: (D:\JellyfinCache)   │
   └──────────────┬──────────────────────┘
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
  :8096 Jellyfin Web   :3000 Vue Goiás Tec+
  (ADMINISTRAÇÃO)      (PLAYER/EQUIPE)
```

---

## 2. Estado final (TUDO FUNCIONANDO)

| Item | Portal | Status |
|---|---|---|
| **Admin (Jellyfin Web)** | `http://localhost:8096` | ✅ Healthy |
| **Player (Vue Goiás Tec +)** | `http://localhost:3000` | ✅ Ativo |
| **Usuário superadmin** | — | ✅ Criado e autenticado |
| **Biblioteca GoiasTec** | `/media/goiastec` | ✅ 7 vídeos aparecendo |
| **Plugin GoiasTecPlus 0.1.0.0** | — | ✅ Carregado |
| **Cache/transcodes** | `D:\JellyfinCache` | ✅ No D: (334 GB livres) |
| **Vídeos (Drive)** | `D:\GoiasTecMedia` | ✅ 7 mp4 (706 MB) |

---

## 3. Arquitetura de mídia — DECISÃO CHAVE

### O problema

Tentou-se **3 abordagens** para expor o Google Drive ao Jellyfin (Docker no Windows):

| Abordagem | Resultado |
|---|---|
| ❌ **FUSE dentro do container Docker** | `readdir` sempre vazio (limitação do Docker Desktop/WSL2) |
| ⚠️ **WinFsp no Windows** | Funciona no Windows, mas o Docker não enxerga o mount (vira symlink quebrado via 9P) |
| ✅ **FUSE nativo no WSL2 (Ubuntu)** | Funciona perfeitamente (lista os vídeos), mas expor ao container é frágil |

### A solução adotada: **rclone sync → pasta local no D: → bind-mount**

Em vez de montar via FUSE (que não funciona de forma confiável no Docker Desktop/WSL2), o conteúdo é **sincronizado** do Drive para uma pasta local no **D:** e essa pasta é **bind-mountada** no container Jellyfin.

```yaml
# docker-compose.yml (essencial)
services:
  jellyfin:
    volumes:
      - ./data/jellyfin/config:/config
      - D:/JellyfinCache:/cache                # cache/transcodes no D:
      - D:/GoiasTecMedia:/media/goiastec       # cópia local do Drive -> biblioteca
```

### Comando de sync (manter atualizado)
```bash
rclone sync "goiastec:03. Midias e Fotos/Backup 11／2025/Mudança CriaLab " \
  D:/GoiasTecMedia --config=rclone/rclone.conf --transfers 4 --progress
```
> **Nota:** a pasta do Drive usa **barra larga `／` (U+FF0F)** e **espaço no final** ("Mudança CriaLab ") — caminhos com barra normal falham.

**Pendência:** o sync **não está automatizado** (não agendado). Criado `rclone\sync.ps1` para agendar no Agendador do Windows.

---

## 4. Interface dupla (DESCOBERTA IMPORTANTE)

O **fork do Jellyfin Vue** do Goiás Tec + é **apenas um player** — **não serve para administração**. Confirmado:
1. **Documentação oficial Jellyfin**: *"Jellyfin Vue is an experimental, alternative web client... NOT planned to replace the main Jellyfin Web client, and is NOT feature-complete."*
2. **Código do fork**: várias telas de admin (Bibliotecas, Plugins, Tarefas, Rede, Transcodificação) estão com `link: undefined` (placeholders removidos de propósito).

Por isso, **há 2 interfaces**:

| Interface | URL | Uso |
|---|---|---|
| **Jellyfin Web** | `http://localhost:8096` | 🔧 **Administração** (bibliotecas, plugins, usuários, tarefas, WhisperSubs) |
| **Jellyfin Vue Goiás Tec +** | `http://localhost:3000` | 🎬 **Player/uso diário** (assistir + comentários) |

> ⚠️ O web padrão do Jellyfin foi **restaurado na :8096** (antes estava sobrescrito pelo Vue). O Vue roda separado na :3000 via `npx serve`.

---

## 5. Configuração do Jellyfin / API

### Criação do superadmin (via API — schema correto)
As rotas de setup do Jellyfin recente usam **`Name`/`Password`** (não `NewUserName`/`NewPassword`):
```bash
# 1. Configurar servidor
curl -X POST http://localhost:8096/Startup/Configuration -H "Content-Type: application/json" \
  -d '{"ServerName":"GoiasTec Plus","Locale":"pt-BR","UICulture":"pt-BR"}'

# 2. Criar admin (SCHEMA: Name/Password)
curl -X POST http://localhost:8096/Startup/User -H "Content-Type: application/json" \
  -d '{"Name":"superadmin","Password":"SUA_SENHA"}'

# 3. Finalizar setup
curl -X POST http://localhost:8096/Startup/Complete

# 4. Se der 404 nas rotas, reverter IsStartupWizardCompleted p/ false:
#    editar data/jellyfin/config/config/system.xml -> <IsStartupWizardCompleted>false</...> + restart
```

### Autenticação API (precisa de header de cliente)
```bash
curl -X POST "http://localhost:8096/Users/AuthenticateByName" \
  -H "Content-Type: application/json" \
  -H "X-Emby-Authorization: MediaBrowser *** " \
  -d '{"Username":"superadmin","Pw":"SENHA"}'
# retorna .AccessToken
```

### Biblioteca criada
- **Nome**: GoiasTec · **Tipo**: Filmes · **Pasta**: `/media/goiastec`
- **Método**: via UI do Jellyfin Web (:8096) — usuário criou manualmente

---

## 6. Problemas resolvidos (log de debugging)

| Problema | Causa | Solução |
|---|---|---|
| Build da imagem falha | Deno install exige `unzip` ausente | adicionei `unzip` ao Dockerfile |
| Plugin não carrega | pasta `runtimes/` com DLLs Windows inválidas no Linux | podar p/ só `linux-x64` + recopiar |
| Web substituído errado | caminho da imagem é `/jellyfin/jellyfin-web` (não `/usr/share/jellyfin/web`) | doc atualizado |
| rclone não monta (FUSE) | Docker Desktop/WSL2 não propaga readdir FUSE | mudar para **sync** no D: (Opção D) |
| Setup do Jellyfin falha | API mudou schema p/ `Name`/`Password` | usar schema correto via API |
| Vue não tem admin | fork é só player | Jellyfin Web (:8096) p/ admin; Vue (:3000) p/ player |
| Cache no C: | compose apontava p/ `./data/jellyfin/cache` | mover p/ `D:/JellyfinCache` |

---

## 7. Pendências / próximos passos (não concluídos)

1. **Automatizar o sync do rclone** (agendar `rclone\sync.ps1` no Agendador do Windows ou pm2) — hoje é manual.
2. **Player :3000 não é permanente** — `npx serve` cai ao reiniciar; precisa de serviço (pm2/agendado no boot).
3. **Trickplay/thumbnails não gerando** — tarefas rodam em 0 min porque **trickplay não está habilitado por biblioteca** no Jellyfin Web (:8096 → Bibliotecas → GoiasTec → habilitar imagem Trickplay).
4. **Usuários + papéis** (admin/editor/convidado) via API `/GoiasTec/Roles/{userId}` — não feitos.
5. **API key** do Jellyfin p/ automação — não criada.
6. **WhisperSubs** (legendas automáticas) — não instalado.
7. **YouTube** (handle @goiastec) — aguardando a conta existir.
8. **CriaLab (Team Drive)** — quando a TI liberar, trocar a origem do `rclone sync` do Drive pessoal para o Shared Drive.

---

## 8. Arquivos-chave do projeto

| Arquivo | Função |
|---|---|
| `docker-compose.yml` | Stack (jellyfin; cache e media no D:) |
| `docker/jellyfin/Dockerfile` | Imagem custom (yt-dlp + deno + unzip) |
| `rclone/rclone.conf` | Token do Drive (**ignorado pelo git, não compartilhar**) |
| `rclone/sync.ps1` | Script de sync p/ D:\GoiasTecMedia |
| `data/jellyfin/config/` | Config, plugins, banco do plugin |
| `client/jellyfin-vue/.../dist` | Build do player Vue (serve na :3000) |
| `docs/GUIA-PASSO-A-PASSO.md` | Guia do projeto (atualizado com gotchas) |
| `docs/ARCHITECTURE.md` | Arquitetura |

---

*Resumo gerado ao final da sessão de implantação 2026-08-04/05.*
