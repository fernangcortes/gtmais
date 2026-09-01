# SETUP — Goiás Tec +

Guia de implantação passo a passo. Pressupõe **Docker Desktop (WSL2)** no Windows e **git**.

---

## 1. Pré-requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) rodando (WSL2 backend)
- [Git](https://git-scm.com/)
- Para compilar o plugin: **.NET SDK 9** **ou** Docker (recomendado, ver seção 6)

## 2. Google Drive (Shared Drive)

1. No Google Workspace, crie um **Shared Drive** (ex.: "Goiás Tec Vídeos") e compartilhe com a equipe.
2. Crie uma pasta dentro dele (ex.: `Videos`) que será a pasta assistida.
3. (Recomendado) Crie seu próprio **client_id/client_secret** do Google:
   `https://rclone.org/drive/#making-your-own-client-id`
4. Copie o template e configure o rclone:

   ```powershell
   copy rclone\rclone.conf.example rclone\rclone.conf
   rclone config   # siga o assistente: tipo drive, scope drive.readonly, shared drive = sim
   ```

   - Em `team_drive` preencha o ID do Shared Drive (final da URL da pasta:
     `https://drive.google.com/drive/folders/<ID>`).
   - **Alternativa (servidor sem browser):** service account. Crie a SA no Google Cloud Console,
     baixe o JSON, compartilhe a pasta do Shared Drive com o e-mail da SA e aponte
     `service_account_file` para ele.

5. Teste:

   ```powershell
   rclone lsd goiastec:   # deve listar o Shared Drive
   ```

## 3. Subir o stack

```powershell
docker compose up -d --build
```

O que sobe:
- **goiastec-jellyfin** — servidor Jellyfin (imagem custom: yt-dlp + deno + libgomp1/Whisper) na porta `8096`
- **goiastec-rclone** — monta `goiastec:Videos` em `/mnt/goiastec` (volume `media`), com cache local
  (`--vfs-cache-mode full`) para velocidade local em replays e transcrição

Verifique os logs do rclone:

```powershell
docker logs goiastec-rclone
```

> Se o mount falhar, confira `/dev/fuse` e `SYS_ADMIN` (já configurados no compose) e se o
> Docker Desktop está com WSL2. Em último caso, use o script alternativo
> `rclone\mount.ps1` (exige [WinFsp](https://winfsp.dev/)).

## 4. Setup inicial do Jellyfin

1. Abra `http://localhost:8096`
2. Complete o assistente (idioma, usuário admin — **este será o `superadmin`**).
3. Crie a biblioteca:
   - Tipo: **Filmes** (ou "Outros" se preferir)
   - Pasta: `/media/goiastec` (o mount do Drive dentro do container)
   - Desmarque "Baixar arte" de provedores online se os vídeos forem internos.
   - Defina "Mídia contida em pastas" conforme sua organização.
4. O plugin **detecta novos vídeos** automaticamente (tarefa "Goiás Tec +: detectar novos vídeos
   no Drive") e dispara o scan.

> A pasta inicial de vídeos que você receber pode ser enviada para `Videos` no Shared Drive —
> os arquivos aparecem no player em ~1–2 min.

## 5. Instalar o plugin GoiasTecPlus

### Opção A — repositório (após publicar o plugin)

Adicione o repositório em `Dashboard > Plugins > Repositories` apontando para o `manifest.json`
deste projeto, e instale pelo catálogo.

### Opção B — build manual (rápido para desenvolvimento)

```powershell
# Com o Docker rodando (recomendado — usa .NET 9 sem instalar nada no host):
docker run --rm -v "C:/Users/FGC/Desktop/programas/goias-tec-+:/src" -w /src/plugin `
  mcr.microsoft.com/dotnet/sdk:9.0 dotnet publish Jellyfin.Plugin.GoiasTecPlus/Jellyfin.Plugin.GoiasTecPlus.csproj -c Release

# Alternativa: instale o .NET SDK 9 e rode:
#   dotnet publish Jellyfin.Plugin.GoiasTecPlus/Jellyfin.Plugin.GoiasTecPlus.csproj -c Release

# Copie o resultado para dentro do container:
docker cp "plugin\Jellyfin.Plugin.GoiasTecPlus\bin\Release\net9.0\publish" goiastec-jellyfin:/config/plugins/GoiasTecPlus
docker restart goiastec-jellyfin
```

> ⚠️ As versões dos pacotes `Jellyfin.Controller`/`Jellyfin.Model` no `.csproj` devem coincidir
> com a versão do servidor. Se subir uma versão nova do Jellyfin, atualize o `.csproj` e republique.

### Instalar o WhisperSubs (legendas locais)

1. `Dashboard > Plugins > Repositories` → adicionar `https://geiserx.github.io/whisper-subs/manifest.json`
2. Catálogo → **WhisperSubs** → Instalar → Reiniciar.
3. `Dashboard > Plugins > WhisperSubs`:
   - Engine: baixar `whisper-cli` (CPU) e modelo **`ggml-large-v3-turbo-q5_0`** (ou `base` p/ testes)
   - **Enable Auto-Generation**: ON; biblioteca: Goiás Tec +
   - Idioma: **auto/pt**
4. Teste com um vídeo curto. (GPU Vulkan/CUDA: ativar quando a máquina tiver — ver `docker-compose.yml`.)

## 6. Configurar o plugin

`Dashboard > Plugins > GoiasTecPlus`:

| Campo | Valor |
|---|---|
| Handle do canal YouTube | `@goiastec` (quando a conta existir; vazio por enquanto) |
| yt-dlp / deno | `yt-dlp` / `deno` (já instalados na imagem custom) |
| Baixar legenda automática | ON |
| Idioma da legenda | `pt` |
| Pasta do mount do Drive | `/media/goiastec` |
| Intervalo de varredura | 30 min |

## 7. Criar usuários e atribuir papéis

1. `Dashboard > Users` → crie os usuários (admin Jellyfin para `superadmin`/`admin`; usuários
   comuns para `editor`/`convidado`).
2. Atribua o papel via API (apenas `superadmin`):

```powershell
$token = "<seu token/api-key>"
$base = "http://localhost:8096/GoiasTec"

# Meu papel
curl.exe -H "Authorization: MediaBrowser Token=$token" "$base/Roles/Me"

# Listar usuários e papéis
curl.exe -H "Authorization: MediaBrowser Token=$token" "$base/Roles"

# Atribuir papel (superadmin pode atribuir admin/editor/guest/superadmin)
curl.exe -X PUT -H "Authorization: MediaBrowser Token=$token" -H "Content-Type: application/json" `
  -d '{"Role":"editor"}' "$base/Roles/<userIdDoUsuario>"
```

> Dica: a interface customizada (fork jellyfin-vue) terá telas para isso; por ora use a API.

## 8. Usar a API de comentários (verificação rápida)

```powershell
# Categorias
curl.exe -H "Authorization: MediaBrowser Token=$token" "$base/Categories"

# Criar comentário ancorado em 30s (30s = 300.000.000 ticks)
curl.exe -X POST -H "Authorization: MediaBrowser Token=$token" -H "Content-Type: application/json" `
  -d '{"ItemId":"<itemId>","TimestampTicks":300000000,"CategoryId":1,"Body":"Teste na marca de 30s"}' `
  "$base/Comments"

# Listar
curl.exe -H "Authorization: MediaBrowser Token=$token" "$base/Comments?itemId=<itemId>"

# Pendências do item (badge do cliente)
curl.exe -H "Authorization: MediaBrowser Token=$token" "$base/Comments/Items/<itemId>/PendingCount"
```

## 9. Cliente customizado (fork jellyfin-vue)

O fork já está criado e buildado em `client/jellyfin-vue` (ver `client/README.md`). O build fica em
`client\jellyfin-vue\packages\frontend\dist`.

Para substituir o web padrão do Jellyfin (na imagem atual o caminho é `/jellyfin/jellyfin-web`):

```powershell
docker cp "client\jellyfin-vue\packages\frontend\dist\*" goiastec-jellyfin:/jellyfin/jellyfin-web/
docker restart goiastec-jellyfin
```

> O `docker cp` é temporário: some se o container for recriado. Para fixar, monte um volume
> no `docker-compose.yml` (ex.: `./client/jellyfin-vue/packages/frontend/dist:/jellyfin/jellyfin-web:ro`).

Desenvolvimento: `corepack pnpm --filter @jellyfin-vue/frontend start` dentro de `client/jellyfin-vue`.

## 10. Marca (logo + cores)

- O tema é controlado por `packages/frontend/src/store/settings/theme.ts` + CSS vars
  `--j-theme-color-*` em `JApp.vue`.
- Quando você tiver a **logo do Goiás Tec +** e as **cores**, substitua os placeholders
  (logo em `src/assets/branding/` e paleta no tema). Até lá, o cliente usa a marca padrão.

## 11. Troubleshooting

| Problema | Solução |
|---|---|
| `goiastec-rclone` não monta | Ver logs (`docker logs goiastec-rclone`); conferir token/client_id; testar `rclone lsd goiastec:` no host |
| Novos vídeos não aparecem | A tarefa "detectar novos vídeos no Drive" roda a cada 30 min; rode manualmente em `Dashboard > Tarefas`; confira se a pasta da biblioteca é `/media/goiastec` |
| Plugin não carrega | Verificar versão dos pacotes Jellyfin no `.csproj` vs servidor; conferir `docker logs goiastec-jellyfin` |
| Whisper lento | Esperado em CPU; usar modelo `base` para testes e GPU depois |
| yt-dlp falha | Manter yt-dlp atualizado (`yt-dlp -U`); canal ainda não existe → tarefa fica inativa (esperado) |
| Build `NETSDK1045` | Usar o comando Docker da seção 5 (SDK .NET 9) em vez do `dotnet` local (SDK 8) |
