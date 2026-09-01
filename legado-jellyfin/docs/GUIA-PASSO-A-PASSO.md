# Guia passo a passo — Goiás Tec +

Guia **didático** para fazer o que depende de você. Cada etapa tem:
o que fazer → o que deve acontecer → se der errado.

> Projeto: `C:\Users\FGC\Desktop\programas\goias-tec-+`
> Comandos são em **PowerShell** (abra o Terminal do VS Code com o projeto aberto).

---

## Etapa 0 — Pré-requisitos (5 min)

1. Abra o **Docker Desktop** e espere a engrenagem parar de girar (daemon pronto).
2. Confirme no terminal:
   ```powershell
   docker version --format "{{.Server.Version}}"
   ```
   → Deve imprimir um número (ex.: `29.6.2`). Se der erro "cannot connect", o Docker Desktop ainda não está pronto.

---

## Etapa 1 — Conectar o Google Drive (só você tem as credenciais)

O rclone é quem "enxerga" o Shared Drive como uma pasta. Ele precisa de um arquivo de
configuração com **sua** conta Google.

1. Instale o rclone no Windows:
   ```powershell
   winget install Rclone.Rclone
   ```
   Feche e abra o terminal depois de instalar.

2. Rode o assistente de configuração:
   ```powershell
   rclone config
   ```
   Responda:
   - `n` (novo remote) → nome: **goiastec**
   - Tipo de storage: escolha **drive** (o número que aparece ao lado de "Google Drive")
   - `client_id` / `client_secret`: **deixe em branco** (o rclone abre o navegador para logar)
   - Scope: escolha **drive.readonly** (só leitura — é o mais seguro)
   - Abre o navegador → faça login com a conta do Goiás Tec → "Permitir"
   - "Configure this as a Shared Drive (Team Drive)?" → **y** → escolha o Shared Drive da equipe
   - Confirme (y) no final

3. Teste se funcionou:
   ```powershell
   rclone lsd goiastec:
   ```
   → Deve listar as pastas do Shared Drive. Se listar, está pronto.

4. Descubra onde o rclone salvou o arquivo:
   ```powershell
   rclone config file
   ```
   → Mostra um caminho como `C:\Users\FGC\.config\rclone\rclone.conf`.

5. Copie esse arquivo para dentro do projeto (o Docker vai usá-lo):
   ```powershell
   Copy-Item "$env:USERPROFILE\.config\rclone\rclone.conf" "rclone\rclone.conf"
   ```
   > ⚠️ Esse arquivo contém seu token — já está no `.gitignore`, não compartilhe.

**Se der errado:**
- Se o navegador não abriu, diga `n` no "Use web browser" e cole o link manualmente.
- Se o Shared Drive não aparece, confira se sua conta tem acesso de editor/gerente a ele.

---

## Etapa 2 — Subir o Docker (jellyfin + rclone)

1. Confirme que o `rclone\rclone.conf` existe (Etapa 1).
2. Suba tudo:
   ```powershell
   docker compose up -d --build
   ```
   → A primeira vez demora (baixa imagens e instala yt-dlp/deno na imagem do Jellyfin).
3. Veja se subiu:
   ```powershell
   docker compose ps
   ```
   → `goiastec-jellyfin` e `goiastec-rclone` devem aparecer como "Up".

4. Confira o rclone (se ele não montar, o resto não aparece):
   ```powershell
   docker logs goiastec-rclone
   ```
   → Deve terminar com algo como "mount... GoiasTec".

**Se der errado:**
- Jellyfin não sobe → `docker compose logs jellyfin` e me conte o erro.
- rclone com erro de "failed to connect" / "403" → o `rclone.conf` está com problema; refaça a Etapa 1.
- FUSE error → rode `docker compose up -d` de novo (Docker Desktop WSL2 costuma precisar do `/dev/fuse`, já configurado no compose).

---

## Etapa 3 — Setup inicial do Jellyfin (cria o `superadmin`)

1. Abra no navegador: **http://localhost:8096**
2. Complete o assistente:
   - Idioma: português
   - Crie o **usuário administrador** (ex.: `superadmin` + senha forte)
   - **Guarde essa senha** — é o seu acesso de dono.
3. Depois de criar, você já está logado como admin.

> Esse usuário é o seu **superadmin** do Goiás Tec + (controle total).

---

## Etapa 4 — Instalar o plugin GoiasTecPlus (comentários/papéis/sync)

O plugin já está **compilado e pronto** em `plugin\publish`. Só falta copiar para o container:

1. Copie a pasta do plugin para dentro do container:
   ```powershell
   docker cp "plugin\publish" goiastec-jellyfin:/config/plugins/GoiasTecPlus
   ```
   > ✅ O `plugin\publish` atual já contém **apenas** a runtime `linux-x64` (foi publicado
   > num container Linux), então **nada a fazer**. Se um dia você republicar no Windows e o
   > log acusar `BadImageFormatException` em `runtimes/.../e_sqlite3.dll`, apague tudo dentro
   > de `plugin\publish\runtimes\` exceto `linux-x64` e recopie o plugin.
2. Reinicie o Jellyfin:
   ```powershell
   docker restart goiastec-jellyfin
   ```
3. Confirme: **Dashboard → Plugins** deve mostrar **GoiasTecPlus**.

> Se um dia atualizar o Jellyfin para outra versão, será preciso recompilar o plugin
> (ver `docs/SETUP.md`, seção 5) — a versão dos pacotes precisa casar com a do servidor.

---

## Etapa 5 — Instalar o WhisperSubs (legendas automáticas locais)

1. No Jellyfin: **Dashboard → Plugins → Repositories** → Adicionar:
   ```
   https://geiserx.github.io/whisper-subs/manifest.json
   ```
2. Vá em **Catalog** → procure **WhisperSubs** → **Install** → reinicie quando pedir.
3. Abra **Dashboard → Plugins → WhisperSubs**:
   - Em "Whisper Engine": baixe o **whisper-cli (CPU)** e o modelo **`ggml-large-v3-turbo-q5_0`**
     (o botão "Download" faz isso sozinho).
   - **Enable Auto-Generation**: ligue.
   - **Enabled Libraries**: selecione a biblioteca do Goiás Tec (crie na Etapa 6).
   - **Default Language**: `auto` (ou `pt`).
4. Teste: peça geração num vídeo curto (botão na própria página do plugin) → deve gerar um `.srt` ao lado do arquivo.

> Em CPU, um vídeo de 10 min demora alguns minutos — normal. Com GPU (futuro) fica bem mais rápido.

---

## Etapa 6 — Criar a biblioteca (a pasta do Drive)

1. **Dashboard → Libraries → Add media library**:
   - Content type: **Movies** (ou "Other" se preferir)
   - Pastas: **`/media/goiastec`** (é onde o rclone monta o Shared Drive dentro do container)
   - Desmarque provedores de arte online (os vídeos são internos)
2. Salve → o Jellyfin varre e lista os vídeos do Drive.
3. **Teste do "aparecer sozinho"**: suba um vídeo novo no Shared Drive (na pasta `Videos`);
   em ~1–2 min ele deve aparecer no player (a tarefa "Goiás Tec +: detectar novos vídeos no Drive" cuida disso).

---

## Etapa 7 — Configurar o plugin

**Dashboard → Plugins → GoiasTecPlus**:
| Campo | Valor |
|---|---|
| Handle do canal YouTube | `@goiastec` **quando a conta existir** (por enquanto deixe vazio) |
| yt-dlp / deno | `yt-dlp` / `deno` (já instalados na imagem) |
| Baixar legenda automática | ✔ ligado |
| Idioma da legenda | `pt` |
| Pasta do Drive | `/media/goiastec` |
| Intervalo de varredura | 30 min |

---

## Etapa 8 — Criar usuários e atribuir papéis

1. **Dashboard → Users** → crie os usuários:
   - `admin` (marque como **admin** do Jellyfin — mesma tela, checkbox "admin")
   - `editor` (ex.: a equipe da CriaLab) — usuário comum
   - `convidado` (ex.: cliente Goiás Tec) — usuário comum
2. Crie uma **API Key** para você: **Dashboard → API Keys → New API key** (dê um nome, ex.: `admin`)
   e copie o token gerado.
3. No terminal, guarde o token e veja quem está na lista de usuários com papéis:
   ```powershell
   $token = "COLE_O_TOKEN_AQUI"
   curl.exe -H "Authorization: MediaBrowser Token=$token" "http://localhost:8096/GoiasTec/Roles"
   ```
   → Vai listar `userId`, `userName`, `role` (tudo `guest` por enquanto).
4. Atribua os papéis (troque `<ID>` pelo `userId` da pessoa):
   ```powershell
   # admin da plataforma
   curl.exe -X PUT -H "Authorization: MediaBrowser Token=$token" -H "Content-Type: application/json" -d '{"Role":"admin"}' "http://localhost:8096/GoiasTec/Roles/<ID>"

   # produtora (edita/comenta privado/avança revisão)
   curl.exe -X PUT -H "Authorization: MediaBrowser Token=$token" -H "Content-Type: application/json" -d '{"Role":"editor"}' "http://localhost:8096/GoiasTec/Roles/<ID>"

   # cliente (assiste e comenta público)
   curl.exe -X PUT -H "Authorization: MediaBrowser Token=$token" -H "Content-Type: application/json" -d '{"Role":"guest"}' "http://localhost:8096/GoiasTec/Roles/<ID>"
   ```
5. Confira: `curl.exe -H "Authorization: MediaBrowser Token=$token" "http://localhost:8096/GoiasTec/Roles/Me"` → mostra seu papel.

---

## Etapa 9 — Testar os comentários (verificação rápida)

1. Descubra o ID de um vídeo (troque `Movie` por `Video`/`Episode` se for o caso):
   ```powershell
   curl.exe -H "Authorization: MediaBrowser Token=$token" "http://localhost:8096/Items?Recursive=true&IncludeItemTypes=Movie"
   ```
   → Anote o `Id` do vídeo (a string entre aspas).
2. Veja as categorias já criadas:
   ```powershell
   curl.exe -H "Authorization: MediaBrowser Token=$token" "http://localhost:8096/GoiasTec/Categories"
   ```
   → Deve vir: roteiro, montagem, cor, tema, geral.
3. Crie um comentário ancorado em **30 segundos** (30s = 300.000.000 ticks):
   ```powershell
   curl.exe -X POST -H "Authorization: MediaBrowser Token=$token" -H "Content-Type: application/json" -d '{"ItemId":"<ID_DO_VIDEO>","TimestampTicks":300000000,"CategoryId":1,"Body":"Teste na marca de 30s"}' "http://localhost:8096/GoiasTec/Comments"
   ```
4. Liste e veja o contador de pendências:
   ```powershell
   curl.exe -H "Authorization: MediaBrowser Token=$token" "http://localhost:8096/GoiasTec/Comments?itemId=<ID_DO_VIDEO>"
   curl.exe -H "Authorization: MediaBrowser Token=$token" "http://localhost:8096/GoiasTec/Comments/Items/<ID_DO_VIDEO>/PendingCount"
   ```

---

## Etapa 10 — Usar o cliente customizado (a interface do Goiás Tec +)

O cliente já está **buildado** em `client\jellyfin-vue\packages\frontend\dist`.

**Opção A — rápido (servidor de teste):**
```powershell
cd client\jellyfin-vue\packages\frontend\dist
npx serve -l 3000
```
→ Abra **http://localhost:3000** → tela de seleção de servidor → adicione `http://localhost:8096` → login.

**Opção B — dev com hot-reload (para mexer no código):**
```powershell
cd client\jellyfin-vue
corepack pnpm install
corepack pnpm --filter @jellyfin-vue/frontend start
```

**Opção C — substituir o web padrão do Jellyfin:**
> ⚠️ Na imagem recente do Jellyfin o caminho do web é `/jellyfin/jellyfin-web` (não `/usr/share/jellyfin/web`).
```powershell
docker cp "client\jellyfin-vue\packages\frontend\dist\*" goiastec-jellyfin:/jellyfin/jellyfin-web/
docker restart goiastec-jellyfin
```

Testes na interface:
- Assistir um vídeo → tecla **C** liga/desliga o painel de comentários (ou o botão de balão de comentário).
- Clicar num marcador colorido na barra de tempo busca o vídeo naquele momento.
- Página do vídeo → seção de comentários embaixo (com contador de pendentes).
- Sino 🔔 no topo → notificações de respostas/menções.

---

## Etapa 11 — YouTube (quando a conta existir)

1. Quando criarem o canal do Goiás Tec, ponha o handle em **Dashboard → Plugins → GoiasTecPlus**.
2. O sync roda sozinho (diário + a cada 12h). Para rodar na hora:
   **Dashboard → Scheduled Tasks → "Goiás Tec +: sincronizar legendas com o YouTube" → Executar**.
3. Como funciona: casa o vídeo pelo **nome do arquivo** com o título no YouTube; se achar,
   baixa a **legenda automática** (`pt`) e coloca ao lado do vídeo. Se não casar, fica como
   "not_found" (você pode vincular manualmente via API `POST /GoiasTec/Youtube/Link`).

---

## Etapa 12 — Marca (quando tiver logo e cores)

- Envie a **logo do Goiás Tec +** (PNG/SVG) e as **cores** (hex) → eu aplico no tema do cliente
  (`store/settings/theme.ts` + `JApp.vue`) e troco o logo/splash.

---

## Resumo do que NÃO precisa de você (já pronto)
- ✅ Plugin compilado (`plugin\publish`)
- ✅ Cliente buildado (`client\jellyfin-vue\packages\frontend\dist`)
- ✅ Infra (docker-compose, imagem custom, scripts rclone)
- ✅ Docs (este guia + `docs/SETUP.md` + `docs/ARCHITECTURE.md`)

## Dúvidas / erros
Guarde a saída do comando que falhou e me mande — a maioria dos erros aqui tem conserto simples.
