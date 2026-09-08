# gtmais — Goiás Tec +

Código de um catálogo interno de vídeo sob demanda, feito para professores e gestores da rede
estadual de Goiás — 66 títulos produzidos pelo **CriaLab UEG** para o **Goiás Tec**.

Página estática — HTML, CSS e JavaScript, **sem framework e sem etapa de build** — lendo um
catálogo em JSON, com os vídeos no **Bunny Stream**, o catálogo no **KV** e cinco funções
serverless no **Cloudflare Pages**. Nenhum `node_modules` no que vai para o ar.

> O site em si é de uso interno e não está aberto ao público. Este repositório traz o código,
> não o acervo — ver [O que não está aqui](#o-que-não-está-aqui).

## Estrutura

```
gtmais/
├── catalogo/                a aplicação
│   ├── site/                o que é publicado no Pages
│   │   └── functions/api/   login, catálogo, token de upload, mídia
│   ├── scripts/             carga: upload, encoding, capas, legendas, sinopses, capítulos
│   ├── tests/               node --test
│   └── capitulos.json
├── docs/PLANO-IMPLEMENTACAO.md
└── legado-jellyfin/         a primeira arquitetura, substituída
```

[`catalogo/README.md`](catalogo/README.md) é o manual de operação: o que cada script faz, o
deploy, a configuração do Bunny e do Pages, a segurança e a manutenção do catálogo.

## Três decisões que explicam o resto

**O vídeo não passa pelo servidor.** O arquivo vai do navegador direto para o Bunny, por TUS
resumível — é o que torna viável subir 3,9 GB de dentro de uma aba. A função só assina uma
credencial de uso único, válida por uma hora, para um vídeo específico. A chave de API do Bunny
existe apenas como variável de ambiente da função e nunca chega ao navegador; há teste que falha
se ela aparecer em qualquer arquivo servido.

**Nada toca sozinho.** Não repete e não avança para o próximo. Num catálogo usado em sala de aula
isso não é preferência, é requisito — e é a armadilha principal do projeto, porque o padrão do
player do Bunny é o contrário.

Desde que o player passou a ser nosso, a regra vale em **dois lugares**, e os dois têm teste. No
player próprio: uma única chamada de `play()` no projeto inteiro — o teste conta as ocorrências, e
se o número subir é porque alguém arrumou um segundo lugar de onde o vídeo pode começar sozinho —,
o `<video>` nascendo sem `loop`, e nenhum arquivo servido ao navegador escutando o fim do vídeo. A
regra 3 é uma AUSÊNCIA de código, e é assim de propósito: sem esse ouvinte não existe lugar
conveniente para pendurar um "próximo episódio" automático.

No embed do Bunny, que continua sendo o plano B a uma URL de distância (`?player=embed`), a
garantia é a de sempre: os parâmetros na URL e o `allow` do iframe sem `autoplay`. Os testes falham
se qualquer uma das duas cair.

**A rota nova nasce fechada.** No Cloudflare Pages, `_middleware.js` é o único nome garantidamente
tratado como middleware e não como rota. Concentrar ali a autenticação faz com que uma função
acrescentada depois precise ser explicitamente liberada para ficar pública, em vez de nascer
aberta e depender de alguém lembrar de protegê-la.

## Rodar os testes

264 testes, sem rede e sem credenciais — cobrem as regras do produto, não a infraestrutura. A maior
parte deles chegou com o player próprio, e boa parte prova SEQUÊNCIAS de gesto — dois dedos que
abrem, um toque duplo, um arrasto que é cancelado no meio — sem navegador e sem dedo, porque a
decisão de cada gesto mora numa camada sem DOM:

```bash
cd catalogo && node --test
```

## O que não está aqui

O código está completo; o acervo não vem junto, de propósito:

- **`catalogo.seed.json`** — o catálogo de origem, com os caminhos dos masters em disco, os links
  de origem no Google Drive e o estado de titularidade de cada título.
- **O diário de bordo** — decisões editoriais em aberto e material de terceiros ainda sem direitos
  confirmados.
- **O inventário** — as planilhas e varreduras de 1,2 TB de material de onde o catálogo saiu.

Por isso os scripts de `catalogo/scripts/` não rodam a partir de um clone: além desses arquivos,
eles precisam das credenciais do Bunny e do disco com os masters. Os testes rodam.

## `legado-jellyfin/`

A primeira tentativa: uma plataforma própria sobre o [Jellyfin](https://jellyfin.org), com os
vídeos vindo do Google Drive por rclone e um plugin em C# para comentários ancorados no tempo.
Foi substituída pela arquitetura atual e está guardada porque o plugin e os componentes Vue são
código escrito à mão. Nada ali está em produção — ver
[`legado-jellyfin/README.md`](legado-jellyfin/README.md).

## Licença

Sem licença definida. Todos os direitos reservados — o código está público para leitura e
referência, não para reuso.
