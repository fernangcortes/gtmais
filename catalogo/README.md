# Catálogo Goiás Tec + — manual de operação

Manual de operação do catálogo. **O que é cada pasta do repositório e por que o
`legado-jellyfin/` existe está no [README da raiz](../README.md); aqui é só como operar isto.**

Este arquivo descreve como o projeto funciona e como operá-lo. Os números do acervo — quantos
títulos no ar, o que falta decidir — ficam num diário de bordo que não é publicado, junto com os
dados de origem do acervo.

Implementação do [`../docs/PLANO-IMPLEMENTACAO.md`](../docs/PLANO-IMPLEMENTACAO.md): página
estática lendo um catálogo em JSON, vídeos no Bunny Stream, administração protegida por senha e
funções serverless no Cloudflare Pages. Sem framework, sem etapa de build, sem `node_modules` no
que vai para o ar.

---

## Estrutura

```
catalogo/
├── site/                      ← ISTO, e só isto, é publicado
│   ├── index.html             catálogo (público interno)
│   ├── admin.html             a mesa de curadoria (o /admin)
│   ├── app.js                 grade, busca, ficha do título, lista de capítulos
│   ├── mesa-base.js           sessão, API, rascunho, Publicar, permissões
│   ├── mesa-painel.js         a coluna da direita: visão geral e inspetor
│   ├── mesa-telas.js          catálogo, envio, capa, contas, pendências, estrutura, histórico
│   ├── mesa.js                menu, barra, o site no quadro, eventos
│   ├── mesa.css
│   ├── catalogo-core.js       funções puras, compartilhadas com os testes
│   ├── style.css
│   ├── robots.txt
│   └── functions/api/
│       ├── _middleware.js     autenticação + acesso ao Bunny (a AccessKey mora aqui)
│       ├── login.js           POST /api/login
│       ├── catalogo.js        GET público / GET completo / PUT autenticado
│       ├── historico.js       linha do tempo, cópias e a restauração
│       ├── contas.js          contas de admin (só o superadmin)
│       ├── conta.js           a própria conta e a própria senha
│       ├── autorizacoes.js    pedidos de envio que esperam aprovação
│       ├── upload-token.js    cria o vídeo e assina o upload TUS
│       └── midia.js           status do encoding, capa e legenda
├── scripts/                   ferramentas de carga — NÃO são publicadas
├── tests/catalogo.test.js     node --test
└── capitulos.json             os cortes, escritos à mão
```

> **Por que `site/` é uma pasta separada.** No Cloudflare Pages, todo arquivo do diretório
> publicado vira ativo público. Se `scripts/` e `tests/` estivessem lá, qualquer pessoa poderia
> baixá-los.

> **`catalogo.seed.json` e `.env` ficam na raiz do repositório, de propósito** — o seed carrega os
> caminhos em `F:\` e os links de origem no Drive. Os caminhos são fixos em `scripts/lib/env.mjs`
> e `scripts/lib/catalogo.mjs`. Não mova nenhum dos dois.

---

## O dia a dia

Os scripts leem o `.env` da raiz sozinhos — não precisa exportar nada.

```bash
cd catalogo

node scripts/status.mjs      # estado do encoding no Bunny
node scripts/publicar.mjs    # publica o que ficou pronto (idempotente)
node --test tests/catalogo.test.js   # 410 testes, sem rede nem credenciais
```

Fora isso, a manutenção do catálogo é pela **mesa de curadoria** (`/admin.html`), não por
script e não por planilha — ver [Manutenção do catálogo](#manutenção-do-catálogo).

### Publicar uma alteração no site

**De dentro de `site/`, com `.` como diretório:**

```bash
cd catalogo/site
npx wrangler pages deploy . --project-name=goias-tec-mais
```

> **Não aponte o wrangler para a pasta de fora.** `wrangler pages deploy site --project-name=...`,
> rodado em `catalogo/`, sobe os arquivos estáticos normalmente mas **silenciosamente pula o
> build do `functions/`** — sem erro, sem aviso. O deploy "funciona", mas todo `/api/*` responde
> com o `index.html` (fallback de SPA) em vez de rodar as funções. O sintoma é
> `uses_functions: false` na resposta da API de deployments, e nenhuma linha "Compiled Worker" /
> "Uploading Functions bundle" no output — se você não vir essas duas linhas, o deploy não subiu
> as funções.

---

## Os scripts

Todos aceitam `--simular` (mostra o plano, não grava) e todos são **idempotentes**: rodar de novo
não duplica nada. Os que trabalham sobre o catálogo aceitam `--piloto`, `--item <id>[,<id>]` e
`--catalogo <caminho>`.

**Trabalham sobre o KV** (a fonte da verdade da grade, via `GTM_SITE` + senha de admin):

| Script | O que faz |
|---|---|
| `publicar.mjs` | Publica na grade quem passa nas três condições: sem pendência registrada, com `fonte.videoId`, e encoding concluído no Bunny. `--com-pendencia` força; `--despublicar <id>` desfaz. |
| `capitulos.mjs` | Grava os capítulos de `capitulos.json` **em dois lugares**: no Bunny (segmenta a linha do tempo do embed, que é iframe de outro domínio — lá só ele desenha aquilo) e no catálogo (de onde saem tanto a lista clicável da ficha quanto os segmentos que o player próprio pinta na barra). `--so bunny` / `--so site` separam. `--transcricao <id>` imprime a legenda em blocos, para escrever cortes novos. `--limpar <id>` desfaz. |
| `semear.mjs` | Leva o catálogo local para o KV. Recusa-se a sobrescrever um KV já populado; `--baixar backup.json` antes, `--sobrescrever` depois. |

**Trabalham sobre o Bunny e o `catalogo.seed.json` local:**

| Script | O que faz |
|---|---|
| `upload.mjs` | Sobe os vídeos. Pula quem já tem `fonte.videoId`. Acima de 1,5 GB vai por TUS automaticamente; pode interromper com Ctrl+C e retomar. |
| `status.mjs` | Estado do encoding. `--esperar` bloqueia até terminar. |
| `capas-legendas.mjs` | Envia capas e legendas ao Bunny. `--so legendas` / `--so capas`. |
| `sincronizar-capas.mjs` | Lê do Bunny o nome real do arquivo de capa e grava em `capa_arquivo`. **Existe porque** o Bunny grava a capa enviada com um hash no nome (`thumbnail_2c504259.jpg`) e mantém o `thumbnail.jpg` automático no mesmo lugar: quem monta o caminho fixo serve a capa velha para sempre, respondendo 200, sem sinal de erro. Rode depois de trocar capas pelo painel. |
| `legendas-assembly.mjs` | Transcreve pela API do AssemblyAI. **Extrai só o áudio** (mono, 16 kHz, 64 kbps): o acervo vira ~200 MB em vez de 48 GB. Retomável — os ids ficam em `assemblyai-jobs.json`, na raiz. Precisa de `ASSEMBLYAI_API_KEY`. |
| `legendas-whisper.ps1` | A alternativa local, em CPU, anterior ao AssemblyAI. Levava uma noite para o acervo. Mantido para quando não se quer pagar transcrição. |
| `sinopses.mjs` | Escreve as sinopses a partir dos `.srt`. Precisa de `ANTHROPIC_API_KEY` e de `npm install @anthropic-ai/sdk` dentro de `scripts/`. Toda sinopse nasce com `sinopse_origem: "auto"`. |

---

## Desenvolvimento local

### Ver e clicar a mesa, com um catálogo dentro

```bash
node scripts/mesa-local.mjs
```

Abre `http://127.0.0.1:8790/admin.html`, **senha `local`**, usuário em branco. É o
`site/` de verdade — o mesmo `admin.html`, o mesmo `mesa.js` — com um `/api` de mentira por cima,
alimentado por um `catalogo.seed.json` na raiz do repositório. **Esse arquivo não vem no clone**
(ver o README da raiz): para usar, ponha ali um JSON com a lista `itens`, no formato do catálogo.
Serve para mexer na tela: ordenar a tabela, filtrar, buscar, editar no painel, montar rascunho,
publicar (o PUT só sobe a `rev` na memória; o arquivo não é tocado).

Não confere senha, não expira token, não olha permissão — toda sessão é superadmin, e o GET público
ali **não** é o recorte de `paraPublico()`. Quem guarda essas regras é o `functions/api/`, e quem as
testa é o `tests/catalogo.test.js`. Para conferir servidor, use o wrangler abaixo.

> Um servidor de arquivos puro (`python -m http.server`) abre o `admin.html`, mas **nenhuma senha
> funciona ali**: não há `/api/login` para responder, e o formulário fala com um 404.

### Rodar as funções de verdade

As funções só rodam de verdade no runtime do Pages:

```bash
npx wrangler pages dev site --kv CATALOGO --binding ADMIN_PASSWORD=teste BUNNY_LIBRARY_ID=123456 BUNNY_API_KEY=xxx BUNNY_PULLZONE=vz-exemplo.b-cdn.net
```

O KV local sobe **vazio**: entra-se na mesa e o catálogo tem zero título até alguém semeá-lo.

Os testes das regras de produto não precisam de rede nem de credenciais:

```bash
node --test
```

### O que os testes garantem

`tests/catalogo.test.js` cobre as três restrições inegociáveis do produto. Desde que o player
passou a ser nosso, elas valem em **dois lugares** — o player próprio e o embed do Bunny, que
continua sendo o plano B —, e os dois têm teste:

- **não toca sozinho** — no player próprio, uma **única** chamada de `play()` no projeto inteiro,
  dentro de `alternarPlay`; o teste conta as ocorrências no arquivo, e se o número subir é porque
  alguém arrumou um segundo lugar de onde o vídeo pode começar sozinho. No embed, a URL sempre leva
  `autoplay=false` — a armadilha principal do projeto, porque o padrão do Bunny é `true`.
- **não repete** — o `<video>` nasce sem `loop`, e a URL do embed leva `loop=false`.
- **não avança** — nenhum arquivo servido ao navegador escuta o fim do vídeo (o teste varre os
  quatro atrás da string `'ended'`), e o `allow` do iframe **não** inclui `autoplay`. Esta regra é
  uma AUSÊNCIA de código, e é assim de propósito: sem o ouvinte não existe lugar conveniente para
  alguém pendurar um "próximo episódio" automático.

Mais: a AccessKey do Bunny não aparece em nenhum arquivo servido ao navegador; a grade só mostra
`publicar: true`; a ordenação usa temporada/episódio e não nome de arquivo; a lista de capítulos
só posiciona o vídeo, nunca chama `play()`; e todo título de `capitulos.json` está decidido —
com capítulos ou com o motivo escrito em `sem_capitulos`, nunca nos dois.

---

## Segurança

- A `BUNNY_API_KEY` existe só como variável de ambiente da função. O navegador recebe uma
  assinatura de uso único, válida por uma hora, para um vídeo específico.
- O arquivo de vídeo vai do navegador **direto** para o Bunny (TUS). Não passa pela função —
  é o que torna viável um upload de 3,9 GB.
- `GET /api/catalogo` devolve **só o que está publicado**, sem caminhos locais e sem links de
  origem. O catálogo completo exige o token de admin.
- Qualquer rota nova em `functions/api/` nasce exigindo admin: o `_middleware.js` libera apenas
  `/api/login` e o `GET /api/catalogo`.
- O login devolve um token HMAC com 8 h de validade, guardado em `sessionStorage`. A senha não
  trafega a cada requisição.

Verificação rápida — o `PUT` sem senha tem de falhar com 401:

```bash
curl -i -X PUT https://goias-tec-mais.pages.dev/api/catalogo -d '{"itens":[]}'
```

---

## Manutenção do catálogo

O fluxo do dia a dia é a **mesa de curadoria** (`/admin.html`): menu à esquerda, o site de
verdade no meio — dentro de um quadro, com o rascunho aplicado — e o painel de edição à direita.

- **Site**: o clique escolhe, o duplo clique abre a ficha. O que está escolhido se edita no painel.
- **Todos os títulos**: buscar, filtrar, ordenar pelo cabeçalho, editar em lote, pôr e tirar
  do ar. Cada coluna ordena em três batidas — ordena, inverte e volta à ordem do acervo; o que
  está vazio fica no fim nos dois sentidos.
- **Enviar título**: arquivo → upload direto ao Bunny com barra de progresso e retomada →
  metadados → entra no catálogo.
- **Filas de trabalho**: sinopses a revisar, pendências e sem sinopse, uma a uma e pelo teclado.
- **Estrutura**: o nome, a ordem e o esconder das prateleiras da chegada, a classe de cada série,
  o título em destaque e os textos fixos do site.
- **Histórico**: cada publicação, o que ela mudou campo a campo, e de onde dá para voltar.
- **Player** e **Contas**: os ajustes do player, e as contas de admin com o que cada uma pode fazer.

**Nada vai ao ar sozinho.** O que se edita entra num rascunho, que fica no navegador de quem
edita e sobrevive a fechar a aba; o botão **Publicar** relê o catálogo, confere campo a campo que
o valor de antes ainda é o do servidor e grava tudo num PUT só.

Editar a sinopse à mão já marca `sinopse_origem: "revisada"` — revisar é editar ou clicar em
"Confirmar sinopse". O filtro **"Só sinopses não revisadas"** transforma a revisão numa fila.

Duas telas abertas ao mesmo tempo não se sobrescrevem: cada gravação carrega o `rev` que leu, e o
servidor recusa com 409 se o catálogo mudou no meio — e o Publicar diz QUAL campo mudou, e deixa
escolher. O estado anterior fica no KV nas 30 últimas cópias (`versao:<rev>`), e o que mudou em
cada publicação fica em `historico:<rev>` — inclusive o que foi gravado por script, porque a
comparação é do servidor.

**Quem recusa é o servidor.** O PUT compara o documento velho com o novo e nega o que a conta não
pode mudar, campo a campo; a mesa esconder o botão é conveniência, não segurança.

Excluir de vez não existe por opção: despublicar já resolve e é reversível.

---

## Configuração da infraestrutura

Já está tudo montado e no ar. Esta seção é referência — para conferir um valor, ou para
reconstruir o ambiente do zero.

### Bunny Stream (no painel)

| Onde | O quê |
|---|---|
| Stream → Add Video Library | nome `goias-tec-mais`, replicação **só Brasil/South America** |
| Stream → library → API | a **Stream API Key da library** (não a Account API Key) |
| Player | *Show heatmap* desligado |
| Security → Allowed Referrers | o domínio do Pages |
| Security → Token Authentication | **desligado** |
| Encoding | ladder padrão 240p→1080p; nada acima de 1080p |

Anote o **Video Library ID** e o **hostname da pull zone** (`vz-xxxxxxxx-xxx.b-cdn.net`).

### Cloudflare Pages

O projeto usa **Direct Upload** — sem repositório Git, sem CI, sem a integração Git do painel.
Por isso **não há "Root directory" a configurar**: o diretório publicado é aquele de onde o
`wrangler pages deploy .` é executado, e é `site/`.

O que existe uma vez só: o projeto Pages, o namespace KV `CATALOGO` vinculado a ele com o nome de
binding **`CATALOGO`**, e as variáveis de ambiente (`BUNNY_API_KEY` e `ADMIN_PASSWORD` marcadas
*encrypted*). Os nomes e o formato de cada uma estão em [`../.env.example`](../.env.example).

> Sem o binding do KV, `/api/catalogo` responde 500 com a mensagem explicando o que falta.

### Restrição de acesso

`robots.txt` e `<meta robots="noindex">` já estão no repositório. **Recomendado**: Cloudflare
Access na frente do projeto, com senha única da equipe.

---

## Diferenças em relação ao plano

Três, todas deliberadas:

1. **`functions/api/_auth.js` virou `functions/api/_middleware.js`.** No Pages, `_middleware.js`
   é o único nome garantidamente tratado como middleware e não como rota. Concentrar ali a
   autenticação faz com que uma função nova nasça protegida, em vez de nascer aberta.
2. **`GET /api/catalogo` filtra no servidor.** O plano dizia "devolve o JSON". Devolver o JSON
   inteiro publicaria os caminhos em `F:\`, os links do Drive e os títulos não publicados para
   qualquer visitante. O público recebe só o publicado; o admin recebe tudo.
3. **`site/` separado de `scripts/` e `tests/`.** Pelo mesmo motivo: o diretório publicado
   inteiro é servido.

Uma variável a mais que o plano previa: `BUNNY_PULLZONE`, para montar a URL das capas sem
embutir o hostname no código.

E uma troca de ferramenta: a Task 3.3 previa **Whisper local**; na prática quem transcreveu foi o
**AssemblyAI** (`scripts/legendas-assembly.mjs`), por tempo de máquina. O script do Whisper
continua no repositório.

---

## O que este repositório não traz

Este é o código. O acervo não vem junto, e é de propósito:

- **`catalogo.seed.json`** — o catálogo de origem, com os caminhos dos masters em disco, os links
  de origem no Drive e o estado de titularidade de cada título.
- **`ESTADO.md` e `PROXIMA-SESSAO.md`** — o diário de bordo, com decisões editoriais em aberto e
  material de terceiros ainda sem direitos confirmados.
- **O inventário** — as planilhas e varreduras de onde o catálogo saiu.

Sem esses arquivos os scripts de carga não têm o que ler, e é o esperado: eles também precisam
das credenciais do Bunny e do disco com os masters. O que roda sem nada disso são os testes, que
é onde estão as regras do produto:

```bash
cd catalogo && node --test
```
