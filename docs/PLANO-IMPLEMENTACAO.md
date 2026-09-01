# Goiás Tec + — Plano de implementação

**Produto:** catálogo interno de vídeo sob demanda para professores e gestores da rede.
**Escopo:** 50 títulos, 6h48, uso interno, sem login federado.
**Decisão de arquitetura:** página estática (HTML + CSS + JS, sem framework, sem build) lendo um
catálogo em JSON, com os vídeos hospedados no **Bunny Stream** e reproduzidos pelo iframe do
player do Bunny. Some-se a isso uma **área de administração no próprio site**, protegida por senha,
por onde o admin envia novos títulos sem tocar em script nem em planilha.

> **Por que não é 100% estático.** Enviar vídeo pelo site exige assinar a requisição com a
> `AccessKey` do Bunny, e essa chave não pode viver no JavaScript da página — qualquer visitante
> leria. A solução é três funções serverless minúsculas (Cloudflare Pages Functions, plano
> gratuito, sem servidor para manter e sem build). O arquivo de vídeo **não passa por elas**: elas
> só devolvem uma assinatura, e o navegador envia direto para o Bunny. Continua sem infraestrutura
> — só deixa de ser um diretório de arquivos soltos.

**Data do plano:** 19/08/2026 · **Conta Bunny:** já criada.

---

## 0. Contexto para quem for implementar

Este plano pressupõe uma sessão nova, sem memória do trabalho anterior. O que já foi feito:

- O acervo bruto (1,31 TB, 12.766 arquivos, 6 HDs consolidados) foi inventariado e reorganizado
  em `F:\GOIAS_TEC_MAIS\`.
- 50 títulos finalizados estão em `F:\GOIAS_TEC_MAIS\01_CATALOGO\`, já renomeados no padrão
  `GTM_<SERIE>_S<temp>E<ep>_<TITULO>_<ANO>_<VERSAO>.mp4`.
- **55 capas** foram geradas (`*_CAPA.jpg`, 1920×1080, frame a 35% da duração), ao lado de cada master.
- **8 legendas** `.srt` foram baixadas do YouTube e estão ao lado dos masters correspondentes.
- A titularidade foi apurada: **21 confirmados como Goiás Tec, 4 prováveis, 7 confirmados como
  UEG TV e 30 sem evidência** (canais da UEG despublicados pela vedação eleitoral até 04/10/2026).
  Os 7 da UEG TV estão em `F:\GOIAS_TEC_MAIS\00_A_VALIDAR\` e **não entram** neste catálogo —
  a confirmação veio da extração com cookies, que resolveu 309 links, todos no canal UEG TV.
- `catalogo.seed.json` (entregue junto com este plano) já traz os 50 títulos com metadados,
  caminhos locais, titularidade e campos vazios a preencher.

Planilhas de apoio em `F:\GOIAS_TEC_MAIS\00_INDICE\`:
`Goias_Tec_Mais_planilha_mestre.xlsx`, `Goias_Tec_Mais_titularidade.xlsx`,
`Goias_Tec_Mais_catalogo_e_inventario.xlsx`, `LEIA-ME_ESTRUTURA.md`.

### Restrições inegociáveis do produto

1. **Sem loop.** O vídeo não recomeça ao terminar.
2. **Sem autoplay.** Nada toca sozinho ao abrir a página ou ao abrir o vídeo.
3. **Sem avanço automático.** Ao terminar um episódio, não vai para o próximo. Nem no player,
   nem na interface que construirmos.
4. **Uso interno.** Não indexável, não divulgado publicamente.

> O player do Bunny **não tem** recurso de playlist ou "próximo vídeo" — o item 3 já vem
> satisfeito pelo lado do player. O cuidado é não implementarmos isso por conta própria na grade.

---

## 1. Fase 1 — Configuração do Bunny Stream

### Task 1.1 — Criar a Video Library
No painel do Bunny: **Stream → Add Video Library**.

- Nome: `goias-tec-mais`
- Região de replicação: marque **apenas Brasil / South America** (e opcionalmente US East).
  Cada região replicada multiplica o custo de armazenamento; o público é todo em Goiás.
- Anote o **Video Library ID** (numérico) e o **hostname da pull zone** (`vz-xxxxxxxx-xxx.b-cdn.net`).

### Task 1.2 — Obter a chave de API
Em **Stream → sua library → API**. Copie a **Stream API Key** dessa library.

> Não confundir com a *Account API Key* do painel geral. Os endpoints de vídeo usam a chave
> **da library**, no header `AccessKey`.

Guarde em variável de ambiente, nunca no código:
```powershell
setx BUNNY_LIBRARY_ID "123456"
setx BUNNY_API_KEY "xxxxxxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### Task 1.3 — Configurar o player e a segurança da library
Ainda em **Stream → sua library**:

- **Player** → desligue *Show heatmap*; mantenha controles padrão.
- **Security → Allowed Referrers**: adicione apenas o domínio onde o site será publicado
  (ex.: `goiastec-mais.pages.dev`). Isso impede que o embed funcione em qualquer outro site.
- **Security → Token Authentication**: deixe **desligado** por ora. Ligue só se o allow-list
  de referrer não bastar — ele exige gerar uma assinatura por vídeo no servidor, e o site é estático.
- **Encoding → resoluções**: limite o ladder em **1080p**. Não habilite 1440p nem 2160p.
  Correção de uma afirmação anterior deste plano: **nem todos os masters são 1080p**. A varredura
  com `ffprobe` nos 50 arquivos encontrou 45 em 1080p, **3 em 4K** (Aula Explicação, Leitura S01E01
  Cora Coralina e Depoimento Claudia Oliveira), 1 em 720p e 1 em 480×360. Habilitar 2160p geraria
  renditions 4K desses três — para um público que assiste em celular e notebook de escola, é custo
  puro. O Bunny não faz upscale, então limitar em 1080p não estraga nada: o de 360p continua 360p.
- **Encoding → codecs**: confira **quais codecs estão habilitados** (H.264, HEVC, AV1, VP9).
  Este é o ajuste que mais mexe na fatura, e o mais fácil de deixar passar: cada codec habilitado
  gera um jogo **completo** de renditions, multiplicando o armazenamento por 2, 3 ou 4. Para uso
  interno, só H.264 basta — é o que toca em qualquer navegador e celular da rede.
- **Encoding → qualidade**: se quiser cortar mais, limitar a entrega em 720p reduz o armazenamento
  pela metade (~30 GB → ~16 GB) e é pouco perceptível em tela de celular ou notebook. Só pese que
  parte do acervo tem texto na tela (Matematicidades, cards institucionais), onde 720p custa
  legibilidade.

> **Não recodifique os masters antes de subir.** O Bunny não cobra pelo upload, não cobra
> transcodificação, e **descarta o arquivo original** depois de codificar (a menos que
> *Keep original files* seja ligado). Subir 48 GB ou 12 GB dá a mesma conta de armazenamento —
> recomprimir só adicionaria uma geração de perda e rebaixaria o teto de qualidade de todas as
> renditions. Todos os 50 masters são H.264/yuv420p em MP4, o formato de entrada ideal.
>
> Exceção a vigiar: **Depoimento Claudia Oliveira** tem áudio **PCM não comprimido** dentro do MP4
> (2.084 MB para 2min58). É válido, mas incomum. Se o encoding desse título falhar no Bunny
> (`status.mjs` acusa `FALHOU`), corrija só o áudio, sem tocar no vídeo:
> `ffmpeg -i <master> -c:v copy -c:a aac -b:a 192k <novo>.mp4`

**Critério de aceite:** library criada, ID e chave anotados, referrer restrito.

---

## 2. Fase 2 — Upload: primeiro o lote-piloto, depois o resto

**Não subir os 50 de uma vez.** Comece por um lote de 6 títulos escolhidos para exercitar todos
os caminhos do sistema. Se algo estiver errado — parâmetro do player, thumbnail, legenda,
encoding — o erro aparece em 8 GB, não em 40, e o conserto não exige refazer 50 uploads.

### Task 2.0 — Lote-piloto (6 títulos, 7,9 GB)

| Arquivo | Duração | Tamanho | Legenda | Pendência | Por que está no piloto |
|---|---|---|---|---|---|
| `GTM_CURTA_LEITURA_2024_V2.mp4` | 00:01:42 | 225 MB | não | — | ciclo rápido: sobe, codifica e testa em minutos |
| `GTM_CAMPANHA_VOLTA_AS_AULAS_2024_MASTER.mp4` | 00:02:14 | 298 MB | não | — | avulso, sem série — testa a grade sem agrupamento |
| `GTM_FESTAS_S01E01_CAVALHADAS_2025_MASTER.mp4` | 00:08:35 | 748 MB | sim | — | série com temporada/episódio + legenda |
| `GTM_DOF_DENTISTA_2023_MASTER.mp4` | 00:08:05 | 1.100 MB | sim | — | segunda série, valida o agrupamento |
| `GTM_PARAQUEDISMO_S01E01_2024_SEM_TRILHA.mp4` | 00:21:25 | 1.857 MB | sim | `audio_sem_trilha` | testa como a interface sinaliza pendência |
| `GTM_ESPORTES_S01E01_VAMOS_FALAR_DE_FUTEBOL_2024_MASTER.mp4` | 00:27:06 | 3.904 MB | não | — | **maior arquivo do acervo — valida o TUS** |

Cobertura do piloto: curto e longo, com e sem legenda, com e sem pendência, PUT direto e TUS,
três agrupamentos diferentes na grade. Custo no Bunny: centavos.

**Critério de saída do piloto:** os 6 tocam, nenhum inicia sozinho, nenhum repete, as legendas
aparecem, as capas estão corretas e o upload pela área de admin funcionou pelo menos uma vez.
Só então subir os 44 restantes.

### Task 2.1 — Preparar o script de upload (para a carga em lote)
Linguagem livre (PowerShell ou Node). Fluxo por título:

1. **Criar o vídeo** e obter o `guid`:
   ```
   POST https://video.bunnycdn.com/library/{libraryId}/videos
   Header: AccessKey: {BUNNY_API_KEY}
   Body:   {"title": "<titulo de exibição>"}
   → resposta contém "guid": "<videoId>"
   ```
2. **Enviar o arquivo**:
   ```
   PUT https://video.bunnycdn.com/library/{libraryId}/videos/{videoId}
   Header: AccessKey: {BUNNY_API_KEY}
   Body:   bytes do .mp4 (application/octet-stream)
   ```
3. Gravar o `videoId` de volta no `catalogo.json`, em `fonte.videoId`.

### Task 2.2 — Tratar os 3 arquivos grandes com TUS
A documentação do Bunny recomenda **upload resumível (TUS)** para arquivos acima de 2 GB ou
conexões instáveis. Três títulos passam disso:

| Arquivo | Tamanho |
|---|---|
| `GTM_ESPORTES_S01E01_VAMOS_FALAR_DE_FUTEBOL_2024_MASTER.mp4` | 3.904 MB |
| `GTM_DOF_BOMBEIRO_2024_MASTER.mp4` | 2.792 MB |
| `GTM_DEPOIMENTO_MEDIADORA_CLAUDIA_OLIVEIRA_2024_MASTER.mp4` | 2.084 MB |

Use o endpoint TUS (`https://video.bunnycdn.com/tusupload`) ou uma biblioteca cliente TUS.
Não tente PUT direto nesses três — uma queda no meio reinicia do zero.

### Task 2.3 — Registrar os IDs
Ao fim, `catalogo.json` deve ter **50 entradas com `fonte.videoId` preenchido** e `libraryId`
igual em todas. O script deve ser **idempotente**: se `videoId` já existe, pula o upload.

### Task 2.4 — Aguardar o encoding
O Bunny transcodifica após o upload. Antes de publicar, verifique o status:
```
GET https://video.bunnycdn.com/library/{libraryId}/videos/{videoId}
Header: AccessKey: {BUNNY_API_KEY}
```
Confira os campos de status/progresso de encoding na resposta e só marque o título como pronto
quando concluído. Um vídeo ainda em fila embeda, mas não toca.

### Task 2.5 — Carga dos 44 restantes
Só depois do critério de saída do piloto. Mesmo script, mesma idempotência.

**Critério de aceite:** piloto validado; depois, os 50 no painel do Bunny com encoding concluído.

---

## 3. Fase 3 — Capas e legendas

> Nas Fases 3 a 6, onde se lê "50 títulos", entenda "os 6 do piloto primeiro, os 50 depois".

### Task 3.1 — Enviar as capas
```
POST https://video.bunnycdn.com/library/{libraryId}/videos/{videoId}/thumbnail
Header: AccessKey: {BUNNY_API_KEY}
Body:   bytes do JPG (application/octet-stream)
```
O endpoint também aceita `?thumbnailUrl=` com uma URL pública — como as capas são locais,
envie o corpo binário.

Cada capa está ao lado do master, com o mesmo nome + `_CAPA.jpg`. O caminho já está em
`capa_local` no seed JSON.

### Task 3.2 — Enviar as 8 legendas existentes
```
POST https://video.bunnycdn.com/library/{libraryId}/videos/{videoId}/captions/pt
Header: AccessKey: {BUNNY_API_KEY}
Body:   {"srclang":"pt","label":"Português","captionsFile":"<conteúdo do .srt em base64>"}
```
Os 8 títulos com legenda estão marcados em `legenda_local` no seed JSON.

### Task 3.3 — Gerar as 42 legendas faltantes
A máquina não tem GPU. Use `faster-whisper` com modelo `medium` em CPU, `--language pt`,
rodando fora do horário de trabalho. Saída `.srt` ao lado do master, mesmo nome. Depois,
repetir a Task 3.2 para elas.

Não bloqueia a estreia do site, **mas é pré-requisito das sinopses** (Task 3.4). Comece cedo:
é a tarefa mais longa do projeto em tempo de máquina, e roda sozinha à noite.

### Task 3.4 — Gerar as sinopses a partir das legendas
Com o `.srt` de cada título em mãos, a sinopse deixa de exigir que alguém assista ao vídeo.

1. Concatene o texto do `.srt` (descartando timecodes e numeração).
2. Peça um resumo de 2 a 3 frases, em português, em terceira pessoa, descrevendo **do que trata**
   o vídeo — sem "neste vídeo", sem juízo de valor, sem inventar nome de pessoa ou lugar que não
   apareça na transcrição.
3. Grave em `sinopse` e marque `sinopse_origem: "auto"` no item do catálogo.

Regras que valem a pena impor:

- **Toda sinopse automática nasce marcada como não revisada.** A tela de admin mostra um aviso
  discreto até alguém confirmar; ao confirmar, `sinopse_origem` vira `"revisada"`.
- A transcrição do Whisper erra nomes próprios — e o acervo é cheio de topônimos goianos
  (Muquém, Kalunga, Cavalhadas, Bernardo Élis). Trate nome próprio na sinopse como suspeito
  até revisão.
- Títulos com `pendencia: sem_identificacao` (o "Card GoiasTEC_1", 20 minutos sem nome) são
  justamente os que mais ganham com isso: a transcrição deve revelar do que se trata.

**Critério de aceite:** vídeos com thumbnail própria e legenda; sinopses geradas e marcadas como
não revisadas, prontas para a revisão pela tela.

---

## 4. Fase 4 — O site

### Task 4.1 — Estrutura de arquivos
```
goias-tec-mais-site/
├── index.html              catálogo (público interno)
├── admin.html              área de administração, protegida por senha
├── app.js                  grade, busca, player
├── admin.js                formulário + upload TUS direto para o Bunny
├── style.css               estilos (compartilhado)
├── catalogo.seed.json      carga inicial, importada uma vez para o KV
└── functions/api/
    ├── catalogo.js         GET público / PUT autenticado — lê e grava no KV
    ├── upload-token.js     cria o vídeo no Bunny e devolve a assinatura TUS
    └── _auth.js            confere a senha do admin
```

Sem `node_modules`, sem framework, sem etapa de build. As funções em `functions/` são arquivos
soltos que o Cloudflare Pages executa sozinho — não há nada a compilar nem a manter no ar.

### Task 4.2 — Onde o catálogo vive, e seu esquema

Como o admin passa a editar pelo site, o catálogo não pode ser um arquivo fixo no repositório —
ele precisa de um lugar gravável. Use **Cloudflare KV**, uma chave só (`catalogo`), guardando o
JSON inteiro. Para 50 títulos isso é trivial e continua no plano gratuito.

- `GET /api/catalogo` — público interno, devolve o JSON (a página pública consome daqui).
- `PUT /api/catalogo` — exige a senha de admin, grava o JSON de volta.
- `catalogo.seed.json` é importado **uma vez** para popular o KV, e depois serve só de backup.

O esquema é o do `catalogo.seed.json` já entregue. Campos por item:

| Campo | Tipo | Observação |
|---|---|---|
| `id` | string | slug único, usado na URL (`#/ep/<id>`) |
| `titulo` | string | nome exibido |
| `serie` | string | agrupa na grade |
| `temporada`, `episodio` | int/null | ordena dentro da série |
| `duracao`, `duracao_seg` | string/int | exibição e ordenação |
| `ano`, `data_publicacao_original` | string | |
| `sinopse` | string | vazio no seed; preenchido pela Task 3.4 a partir da legenda |
| `sinopse_origem` | string | `auto` \| `revisada` \| `manual` — controla o aviso de "não revisada" |
| `tema`, `publico_alvo`, `tags` | string/array | **vazios — a preencher pela equipe** |
| `fonte` | objeto | `{tipo, libraryId, videoId}` |
| `titularidade`, `nivel_evidencia` | string | exibir discretamente na ficha |
| `pendencia` | string/null | `audio_sem_trilha`, `sem_identificacao`, `direitos_a_verificar`, `piloto_decidir`, `material_bruto`, `versao_duplicada` |
| `nota_curadoria` | string | achado da curadoria, só para a tela de admin — **não sai no JSON público** |
| `publicar` | bool | **a grade só mostra `true`** |

> O campo `fonte` é a peça central do desacoplamento: hoje `tipo: "bunny"`, amanhã pode ser
> `"hls"` ou `"mp4"`. O `app.js` decide o player por esse campo. Não espalhe URL do Bunny pelo código.

### Task 4.3 — Construir o embed corretamente
```js
function urlEmbed(fonte) {
  const p = new URLSearchParams({
    autoplay: 'false',   // OBRIGATÓRIO: o padrão do Bunny é true
    loop: 'false',
    preload: 'false',
    rememberPosition: 'false'
  });
  return `https://player.mediadelivery.net/embed/${fonte.libraryId}/${fonte.videoId}?${p}`;
}
```

**Armadilha principal do projeto:** `autoplay` no Bunny tem **padrão `true`**. Omitir o parâmetro
faz o vídeo tocar sozinho — exatamente o que não pode acontecer. Cubra isso com um teste.

Para a capa na grade, prefira o thumbnail servido pela pull zone
(`https://{pullzone}.b-cdn.net/{videoId}/thumbnail.jpg`) em vez de embutir 55 JPGs no repositório.

### Task 4.4 — Comportamento da interface

- **Grade inicial**: cards agrupados por série, ordenados por temporada/episódio. Cada card mostra
  capa, título, duração e série. Só entram itens com `publicar: true`.
- **Busca**: campo único filtrando em título, série, sinopse e tags, ao vivo, sem botão.
- **Filtro por série**: lista lateral ou chips no topo.
- **Página do título**: player + título + série/episódio + duração + sinopse + tema + público-alvo.
- **Ao terminar o vídeo: não fazer nada.** Sem sugestão automática, sem contagem regressiva,
  sem tocar o próximo. Se quiser oferecer navegação, um botão explícito "Próximo episódio"
  que o usuário clica.
- **Rota por hash** (`#/ep/<id>`) para o link de um título ser copiável. Sem servidor, sem history API.
- **Estado vazio**: se `catalogo.json` não carregar, mensagem clara — não tela branca.
- Responsivo até 360px de largura; será aberto em celular por gestores.

### Task 4.5 — Gerar o `catalogo.json` a partir da planilha
Script que lê `Goias_Tec_Mais_planilha_mestre.xlsx` e escreve o JSON, preservando os `videoId`
já gravados. Assim a equipe edita sinopse na planilha, roda o script, e o site atualiza.
Este é o fluxo de manutenção — documente-o no README.

**Critério de aceite:** site abre, lista os títulos publicáveis, toca ao clicar em play, não toca
sozinho, não repete, não avança.

---

## 4-B. Fase 4-B — Área de administração

O requisito: **o admin adiciona títulos pelo próprio site**, sem rodar script nem editar planilha.

### Task 4B.1 — Autenticação
Senha única compartilhada, guardada como variável de ambiente do Pages (`ADMIN_PASSWORD`).
O `admin.html` pede a senha, guarda o token em `sessionStorage` e o envia no header das chamadas
às funções. As funções conferem antes de qualquer coisa.

Não é login por usuário — é uma porta trancada para uma equipe pequena. Se um dia precisar de
rastreabilidade por pessoa, aí sim vale um provedor de identidade.

### Task 4B.2 — Função `upload-token`
```
POST /api/upload-token   { titulo }          (autenticado)
```
A função, com a `BUNNY_API_KEY` no ambiente:
1. Cria o vídeo: `POST https://video.bunnycdn.com/library/{libraryId}/videos` → obtém o `guid`.
2. Calcula `expire = agora + 3600` (UNIX, em segundos).
3. Calcula `signature = SHA256(libraryId + apiKey + expire + videoId)`.
4. Devolve `{ libraryId, videoId, signature, expire }`.

**A chave nunca sai da função.** O que chega ao navegador é uma assinatura de uso único, válida
por uma hora, para aquele vídeo específico.

### Task 4B.3 — Upload direto do navegador (TUS)
Com `tus-js-client` (um `<script>` via CDN, sem build), enviando para
`https://video.bunnycdn.com/tusupload` com os headers `AuthorizationSignature`,
`AuthorizationExpire`, `LibraryId` e `VideoId`.

O arquivo vai **do navegador direto para o Bunny** — não passa pela função. Isso evita o limite de
tamanho de requisição das serverless e faz o upload de um arquivo de 3,9 GB ser viável. O TUS
ainda retoma de onde parou se a conexão cair, usando o armazenamento local do navegador.

Mostre barra de progresso: um upload de 4 GB numa conexão comum leva bastante tempo, e sem
indicação visual o admin acha que travou.

### Task 4B.4 — Formulário de metadados
Campos: título, série, temporada, episódio, sinopse, tema, público-alvo, tags, titularidade e
`publicar`. Ao concluir o upload, o `admin.js` monta o item e faz `PUT /api/catalogo`.

Gere o `id` a partir do título (slug), garantindo que não colida com um já existente.

### Task 4B.5 — Edição e despublicação
A mesma tela lista os títulos existentes e permite editar metadados e alternar `publicar`.

O caso mais frequente do dia a dia é **revisar a sinopse gerada pela Task 3.4** — não digitá-la do
zero. Mostre a sinopse automática com um aviso de "não revisada", um campo editável e um botão de
confirmar que grava `sinopse_origem: "revisada"`. Um filtro "só não revisadas" transforma a
revisão dos 50 numa fila que dá para vencer numa sentada.

Excluir de vez: deixe fora por ora. Alternar `publicar` para falso já resolve, e é reversível.

### Task 4B.6 — Capa e legenda pela tela
- Capa: envio opcional de JPG → `POST /library/{libraryId}/videos/{videoId}/thumbnail` (via função,
  arquivo pequeno, pode passar por ela).
- Legenda: envio de `.srt` → `POST /library/{libraryId}/videos/{videoId}/captions/pt` com o
  conteúdo em base64.

Se o prazo apertar, isto pode ficar para depois da estreia — capas e legendas do acervo atual já
serão carregadas em lote na Fase 3.

**Critério de aceite:** subir um vídeo novo do zero pelo site, com título e sinopse, e vê-lo
aparecer na grade — sem tocar em nenhum script.

---

## 5. Fase 5 — Publicação

### Task 5.1 — Hospedar
**Cloudflare Pages**, plano gratuito, apontando para o repositório. Sem build: "deploy do
diretório como está". As funções em `functions/` são detectadas automaticamente.

Netlify serve igualmente bem — só troque Pages Functions por Netlify Functions e KV por Netlify
Blobs. O plano assume Cloudflare porque KV e Functions vêm no mesmo lugar.

### Task 5.1b — Variáveis de ambiente e KV
No painel do Pages, em Settings → Environment variables:

| Variável | Conteúdo |
|---|---|
| `BUNNY_LIBRARY_ID` | ID numérico da library |
| `BUNNY_API_KEY` | Stream API key da library — **só aqui, nunca no repositório** |
| `ADMIN_PASSWORD` | senha da área de administração |

Criar um namespace KV (`CATALOGO`) e vinculá-lo ao projeto. Importar o `catalogo.seed.json`
uma vez para a chave `catalogo`.

### Task 5.2 — Restringir acesso
Sendo uso interno de professores e gestores:

- **Mínimo**: endereço não divulgado + `<meta name="robots" content="noindex, nofollow">` +
  `robots.txt` com `Disallow: /`.
- **Recomendado**: proteção por senha do próprio host (Cloudflare Access ou Netlify
  password protection), senha única compartilhada com a equipe.

### Task 5.3 — Fechar o allow-list do Bunny
Voltar na Task 1.3 e colocar o domínio real de produção em **Allowed Referrers**.
Sem isso, qualquer site pode embedar os vídeos.

---

## 6. Fase 6 — Verificação

| # | Verificação | Como |
|---|---|---|
| 6.1 | Nenhum vídeo toca sozinho | Abrir 5 títulos e confirmar que o player fica parado |
| 6.2 | Nenhum vídeo repete | Deixar um curto (1min42) terminar e observar |
| 6.3 | Não avança para o próximo | Deixar terminar e confirmar que nada acontece |
| 6.4 | Todos tocam | Primeiro os 6 do piloto; depois roteiro pelos 50, anotando falhas |
| 6.5 | Legendas aparecem | Botão CC — 3 dos 6 do piloto têm legenda |
| 6.6 | Capas corretas | Conferir se nenhuma caiu em frame ruim; regerar as que caírem |
| 6.7 | Embed bloqueado fora do domínio | Colar o iframe num JSFiddle e confirmar que falha |
| 6.8 | Não indexado | `site:` no buscador após uma semana |
| 6.9 | Mobile | Abrir em celular real, retrato e paisagem |
| 6.10 | Custo | Conferir o painel do Bunny na primeira semana e projetar o mês |
| 6.11 | Admin exige senha | Abrir `/admin.html` numa aba anônima e confirmar que barra |
| 6.12 | Chave não vaza | Ver o código-fonte e a aba Network: a `AccessKey` não pode aparecer em lugar nenhum |
| 6.13 | Upload grande pelo site | Enviar o arquivo de 3,9 GB pela área de admin, com barra de progresso |
| 6.14 | Upload retoma | Desligar a rede no meio de um upload e religar |
| 6.15 | `PUT /api/catalogo` sem senha falha | Chamar direto com `curl` e esperar 401 |
| 6.16 | Sinopse automática vem marcada | Conferir o aviso de "não revisada" e o filtro na tela de admin |

---

## 7. Tabela de tasks

| # | Task | Depende de | Esforço | Bloqueia estreia? |
|---|---|---|---|---|
| 1.1 | Criar Video Library | — | 10 min | sim |
| 1.2 | Obter chave de API | 1.1 | 5 min | sim |
| 1.3 | Configurar player e segurança | 1.1 | 15 min | sim |
| 2.0 | **Lote-piloto (6 títulos)** | 1.2 | 1 h | sim |
| 2.1 | Script de upload em lote | 1.2 | 2 h | sim |
| 2.2 | TUS para os arquivos grandes | 2.1 | 1 h | sim |
| 2.3 | Registrar videoIds | 2.1 | incluso | sim |
| 2.4 | Aguardar encoding | 2.3 | passivo | sim |
| 2.5 | Carga dos 44 restantes | critério de saída do piloto | 2 h | não |
| 3.1 | Enviar capas | 2.4 | 1 h | não |
| 3.2 | Enviar legendas existentes | 2.4 | 30 min | não |
| 3.3 | Gerar 42 legendas (Whisper CPU) | — | noturno | não |
| 3.4 | Gerar sinopses a partir das legendas | 3.3 | 2 h | não |
| 4.1 | Esqueleto do site | — | 30 min | sim |
| 4.2 | KV + `/api/catalogo` | 5.1b | 2 h | sim |
| 4.3 | Embed com autoplay/loop off | 4.2, 2.0 | 1 h | sim |
| 4.4 | Grade, busca, ficha do título | 4.2 | 4 h | sim |
| 4B.1 | Senha do admin | 5.1b | 1 h | sim |
| 4B.2 | Função `upload-token` | 4B.1 | 2 h | sim |
| 4B.3 | Upload TUS do navegador | 4B.2 | 3 h | sim |
| 4B.4 | Formulário de metadados | 4B.3 | 2 h | sim |
| 4B.5 | Editar e despublicar | 4B.4 | 2 h | não |
| 4B.6 | Capa e legenda pela tela | 4B.4 | 2 h | não |
| 5.1 | Publicar no Cloudflare Pages | 4.1 | 30 min | sim |
| 5.1b | Variáveis de ambiente e KV | 5.1 | 30 min | sim |
| 5.2 | Restringir acesso | 5.1 | 30 min | sim |
| 5.3 | Allow-list do Bunny | 5.1 | 10 min | sim |
| 6.* | Verificação | 5.1 | 3 h | sim |

**Caminho crítico:** 1.1 → 1.2 → 2.0 → 5.1 → 5.1b → 4.2 → 4.3 → 4.4 → 4B.1 → 4B.2 → 4B.3 → 4B.4 → 6.

**Fora do caminho crítico:** a carga dos 44, as capas, as legendas, a edição pela tela.

**Ordem sugerida na prática:** publique o site vazio primeiro (5.1 + 5.1b), porque as funções só
rodam de verdade no ambiente do Pages e depurar isso localmente custa mais caro do que subir. Com
o ambiente de pé, faça o piloto e construa a interface em cima de dados reais.

---

## 8. Armadilhas conhecidas

1. **`autoplay` do Bunny é `true` por padrão.** Este é o erro mais provável do projeto inteiro.
2. **Chave errada.** Os endpoints de vídeo usam a chave *da library*, não a do painel geral.
3. **PUT direto em arquivo de 3,9 GB.** Use TUS nos três grandes.
4. **Embedar antes do encoding terminar.** O player abre e não toca; parece bug do site.
5. **Regiões de replicação demais.** Cada uma multiplica o custo de armazenamento.
6. **Chave de API no JavaScript.** A `AccessKey` do Bunny só existe como variável de ambiente da
   função. Nunca no `catalogo.json`, nunca no `admin.js`, nunca no repositório. O navegador só
   recebe assinatura de uso único, com validade de uma hora.
7. **Mandar o arquivo de vídeo através da função.** Serverless tem limite de tamanho de requisição
   e um vídeo de 3,9 GB não passa. O TUS existe justamente para o navegador falar direto com o
   Bunny — a função só assina.
8. **CORS ao criar o vídeo.** O `POST /library/{id}/videos` deve ser chamado **pela função**, não
    pelo navegador: só o endpoint TUS tem CORS documentado para uso client-side.
9. **Assinatura expirada.** `AuthorizationExpire` é UNIX em **segundos**, não milissegundos. Uma
    hora costuma bastar; para uploads muito longos, gere de novo e retome.
10. **Subir os 50 antes de validar o piloto.** É o erro que custa mais tempo neste plano.
11. **Ordenar por nome de arquivo.** Use `temporada`/`episodio`; `V1` e `MASTER` bagunçam a ordem alfabética.
12. **Publicar os 7 títulos em `00_A_VALIDAR`.** Eles têm indício de titularidade da UEG e estão
   fora do catálogo de propósito. Não os traga de volta sem decisão.

---

## 9. Referência rápida

**API (host `https://video.bunnycdn.com`, header `AccessKey`)**

| Ação | Método | Caminho |
|---|---|---|
| Criar vídeo | POST | `/library/{libraryId}/videos` |
| Enviar arquivo | PUT | `/library/{libraryId}/videos/{videoId}` |
| Buscar de URL remota | POST | `/library/{libraryId}/videos/fetch` |
| Definir thumbnail | POST | `/library/{libraryId}/videos/{videoId}/thumbnail` |
| Adicionar legenda | POST | `/library/{libraryId}/videos/{videoId}/captions/{srclang}` |
| Consultar vídeo | GET | `/library/{libraryId}/videos/{videoId}` |
| Upload resumível | TUS | `https://video.bunnycdn.com/tusupload` |

**Player — `https://player.mediadelivery.net/embed/{libraryId}/{videoId}`**

| Parâmetro | Padrão | Usar |
|---|---|---|
| `autoplay` | **true** | `false` |
| `loop` | — | `false` |
| `preload` | true | `false` |
| `rememberPosition` | false | `false` |
| `muted`, `captions`, `t`, `playsinline`, `showSpeed`, `compactControls` | — | conforme necessidade |

**Upload resumível (TUS) — `https://video.bunnycdn.com/tusupload`**

Headers obrigatórios: `AuthorizationSignature`, `AuthorizationExpire`, `LibraryId`, `VideoId`.

```
signature = SHA256( libraryId + apiKey + expire + videoId )
expire    = timestamp UNIX em segundos
```

A assinatura tem de ser gerada onde a `apiKey` está protegida — no nosso caso, na função
`upload-token`. Cliente sugerido: `tus-js-client` via CDN.

**Custo estimado.** O Bunny cobra **só duas coisas**: armazenamento (US$ 0,01–0,02/GB) e tráfego
de entrega (US$ 0,005/GB). Upload, ingest, transcodificação, player e segurança são gratuitos.

O que conta como armazenamento **não é o master que você sobe** — é o conjunto de renditions que o
Bunny gera (o original é descartado, salvo se *Keep original files* for ligado). Para as 6h48 do
acervo, só H.264:

| Ladder | Armazenado | Custo/mês |
|---|---|---|
| Completo, 240p→1080p | ~30 GB | ~US$ 0,60 |
| Limitado até 720p | ~16 GB | ~US$ 0,33 |

Cada codec extra habilitado (HEVC, AV1, VP9) multiplica esses números. Com tráfego interno baixo,
o total fica **abaixo de US$ 1/mês**. Cloudflare Pages, Functions e KV ficam dentro do plano
gratuito nessa escala. Confirmar no painel após a primeira semana.

---

## 10. O que continua pendente fora deste plano

- **Sinopses dos 50 títulos** — serão geradas automaticamente a partir das legendas, na Task 3.4,
  assim que a Task 3.3 tiver transcrito o acervo. Deixa de ser trabalho manual e passa a ser
  trabalho de revisão: alguém lê e corrige pela tela de admin. Isso **inverte a prioridade da
  Task 3.3** — o Whisper deixa de ser só acessibilidade e vira pré-requisito do catálogo.
- **Titularidade dos 30 em aberto** — a extração com cookies resolveu 309 dos 894 links, todos do
  canal UEG TV, e confirmou os 7 títulos que ficaram fora do catálogo. Os 30 seguem sem evidência:
  dependem de acesso a mais canais ou de 04/10/2026, quando a vedação eleitoral termina.
- **Pendências técnicas de 6 títulos** — áudio sem trilha (2), sem identificação (1),
  direitos de terceiros (1), pilotos de aula (2).
