# Cliente customizado — Goiás Tec + (fork do jellyfin-vue)

**Status: fork criado e customizado.** O repositório do Jellyfin Vue está clonado em
`client/jellyfin-vue/` com todas as customizações do Goiás Tec + aplicadas, e o
**build de produção já foi gerado** em `client/jellyfin-vue/packages/frontend/dist/`.

## O que foi integrado

| Recurso | Arquivo (no fork `packages/frontend/src/`) |
|---|---|
| API client do plugin (`/GoiasTec`) | `plugins/goiastec/goiastec-api.ts` |
| Estado reativo (categorias, comentários, pendências, on/off) | `store/goias-tec-comments.ts` |
| Atalho configurável (padrão **C**) | `composables/use-comments-shortcut.ts` + integrado em `composables/use-playback.ts` |
| Overlay de comentários no player | `components/Comments/CommentsPanel.vue` + `CommentItem.vue` (em `pages/playback/video.vue`) |
| Marcadores coloridos na timeline | `components/Comments/CommentTimeline.vue` (dentro de `components/Layout/TimeSlider.vue`) |
| Seção de comentários na página do vídeo | `components/Comments/CommentsSection.vue` (em `pages/item/[itemId].vue`) |
| Sino de notificações in-app | `components/Notifications/NotificationBell.vue` (em `components/Layout/AppBar/AppBar.vue`) |

> A tecla do atalho é lida de `localStorage["goiastec:commentsShortcut"]` (padrão `c`).
> Um futuro menu de configurações pode chamar `setCommentsShortcut('x')`.

## Como rodar

```bash
cd client/jellyfin-vue
corepack pnpm install        # já feito; rode de novo se o lockfile mudar
corepack pnpm --filter @jellyfin-vue/frontend start     # dev (aponta p/ http://localhost:8096)
corepack pnpm --filter @jellyfin-vue/frontend build     # produção → packages/frontend/dist
```

## Como servir o build de produção

Opção A — servidor estático simples (recomendado para começar):

```bash
cd client/jellyfin-vue/packages/frontend/dist
npx serve -l 3000            # http://localhost:3000 → tela de seleção de servidor → http://localhost:8096
```

Opção B — dentro do container Jellyfin (substitui o web padrão; caminho da imagem atual):

```powershell
docker cp "client\jellyfin-vue\packages\frontend\dist\*" goiastec-jellyfin:/jellyfin/jellyfin-web/
docker restart goiastec-jellyfin
```

> O `docker cp` é temporário (some ao recriar o container). Para fixar, monte um volume no
> `docker-compose.yml`: `./client/jellyfin-vue/packages/frontend/dist:/jellyfin/jellyfin-web:ro`

> ⚠️ Para o mobile futuro: a mesma base vira app com Capacitor (`pnpm build:android` / `build:ios`).

## Validação feita

- `check:types` (vue-tsc): nenhum erro novo introduzido pelos arquivos do Goiás Tec +.
  (O repositório do jellyfin-vue tem erros de tipo pré-existentes — ruído de versão
  Vuetify/vue-router — que também afetam os arquivos originais e não impedem o build.)
- `build` (vite): concluído com sucesso; o bundle contém `CommentsPanel`,
  `CommentItem`, `goias-tec-comments` e `goiastec-api`.

## Nota

Este fork deve ser **mantido** (rebase com `jellyfin/jellyfin-vue` de tempos em tempos).
As customizações estão isoladas em pastas próprias (`components/Comments`,
`components/Notifications`, `plugins/goiastec`, `store/goias-tec-comments.ts`,
`composables/use-comments-shortcut.ts`) + poucos pontos de integração nos arquivos do
fork (`use-playback.ts`, `video.vue`, `TimeSlider.vue`, `AppBar.vue`, item page),
facilitando o merge.
