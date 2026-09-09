/* Testes das regras que o produto não pode perder. Rodar com:
 *     node --test tests/catalogo.test.js
 * de dentro de `catalogo`. O ARQUIVO, não a pasta: `node --test tests/` falha
 * no Node 24 com um erro sem sentido (`test at tests:1:1`), e este comentário
 * mandava fazer exatamente isso — o item 6 de "Erros que custaram caro" do
 * ESTADO.md já apontava para cá desde então.
 * Sem dependências: só o test runner embutido do Node.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GTM = require('../site/catalogo-core.js');
const SITE = path.join(__dirname, '..', 'site');

/* Todo arquivo lido aqui passa por este helper, e o 
 vira 
.
 *
 * NÃO é enfeite, e custou uma investigação: a árvore de trabalho no Windows é
 * CRLF (`core.autocrlf=true`), o repositório guarda LF, e um regex que
 * atravessa uma quebra de linha — `/.pl-b {
/` — casa no blob e FALHA no
 * checkout. O teste "o painel de som encosta no ícone" ficou assim: passava no
 * CI (Linux, LF) e reprovava em qualquer clone Windows, inclusive no
 * repositório ABERTO, onde o README promete que os testes rodam.
 *
 * Normalizar na LEITURA resolve a classe inteira de uma vez, em vez de caçar
 * cada regex. Quem acrescentar um `fs.readFileSync` cru aqui reabre o buraco;
 * há teste varrendo o arquivo atrás disso. */
const lerTexto = (caminho) => fs.readFileSync(caminho, 'utf8').split('\r\n').join('\n');

const fonte = { tipo: 'bunny', libraryId: '123456', videoId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' };

/* ============================ as três restrições inegociáveis ============ */

test('o embed desliga autoplay — o padrão do Bunny é true', () => {
  const p = new URL(GTM.urlEmbed(fonte)).searchParams;
  assert.equal(p.get('autoplay'), 'false');
});

test('o embed desliga loop, preload e rememberPosition', () => {
  const p = new URL(GTM.urlEmbed(fonte)).searchParams;
  assert.equal(p.get('loop'), 'false');
  assert.equal(p.get('preload'), 'false');
  assert.equal(p.get('rememberPosition'), 'false');
});

test('nenhum dos quatro parâmetros pode faltar na URL do player', () => {
  const url = GTM.urlEmbed(fonte);
  for (const par of ['autoplay', 'loop', 'preload', 'rememberPosition']) {
    assert.ok(url.includes(par + '=false'), 'faltou ' + par + '=false em ' + url);
  }
});

test('a interface não reage ao fim do vídeo — nada de avanço automático', () => {
  for (const arquivo of ['app.js', 'admin.js', 'player.js', 'player-core.js']) {
    const fonteJs = lerTexto(path.join(SITE, arquivo));
    assert.ok(!/['"]ended['"]/.test(fonteJs), arquivo + ' escuta o fim do vídeo');
    assert.ok(!/autoplay\s*[:=]\s*['"]?true/.test(fonteJs), arquivo + ' liga autoplay');
    assert.ok(!/setTimeout[^)]*proximo/i.test(fonteJs), arquivo + ' agenda ir para o próximo');
  }
});

/* Bug real, achado no lote-piloto: `no-referrer` remove o cabeçalho Referer de
 * toda requisição que sai da página — inclusive as capas servidas pela pull zone
 * do Bunny, que é protegida justamente por Allowed Referrers. Resultado: 403 em
 * todas as capas, no próprio site. */
test('a página não usa no-referrer — quebraria as capas servidas pelo Bunny', () => {
  const html = lerTexto(path.join(SITE, 'index.html'));
  const m = html.match(/<meta\s+name="referrer"\s+content="([^"]*)"/);
  assert.ok(m, 'index.html precisa declarar uma política de referrer');
  assert.notEqual(m[1], 'no-referrer', 'no-referrer faz a pull zone do Bunny responder 403');
  assert.notEqual(m[1], 'same-origin', 'same-origin também não manda Referer para o Bunny');
});

/* Bug real, achado no piloto: voltar para a grade pelo botão do navegador
 * escondia a ficha com `hidden` mas deixava o iframe no DOM — e o vídeo seguia
 * tocando, com áudio, por cima da grade. Só remover o elemento interrompe. */
test('voltar para a grade destrói o player — esconder não para o vídeo', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const corpo = app.match(/function renderGrade\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei renderGrade em app.js');
  assert.match(corpo[1], /limpar\(el\.ficha\)/,
    'renderGrade precisa esvaziar el.ficha; só `el.ficha.hidden = true` mantém o iframe tocando');
});

/* Bug real: a capa trocada pela tela de admin aparecia na ficha mas não na grade.
 * `urlCapa` depende de `capa_versao` para furar o cache do CDN — e a projeção
 * pública não estava mandando esse campo. */
test('a projeção pública leva capa_versao — sem ela a grade mostra a capa em cache', () => {
  const fn = lerTexto(path.join(SITE, 'functions', 'api', 'catalogo.js'));
  const proj = fn.match(/function paraPublico\(item\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(proj, 'não achei paraPublico em functions/api/catalogo.js');
  assert.match(proj[1], /capa_versao/,
    'paraPublico precisa incluir capa_versao, senão a grade nunca vê a capa nova');
});

test('o iframe não recebe permissão de autoplay na permission policy', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const m = app.match(/setAttribute\('allow',\s*'([^']*)'/);
  assert.ok(m, 'não achei o atributo allow do iframe');
  assert.ok(!m[1].includes('autoplay'), 'allow do iframe contém autoplay: ' + m[1]);
});

/* ============================ player e capa ============================== */

test('embed sem videoId ou sem libraryId não vira URL', () => {
  assert.equal(GTM.urlEmbed(null), null);
  assert.equal(GTM.urlEmbed({ libraryId: '1' }), null);
  assert.equal(GTM.urlEmbed({ videoId: 'x' }), null);
});

test('embed recusa fonte que não seja bunny — o app decide o player pelo campo `fonte`', () => {
  assert.equal(GTM.urlEmbed({ tipo: 'hls', libraryId: '1', videoId: 'x' }), null);
});

test('resolverFonte usa o libraryId do item e, na falta, o do ambiente', () => {
  const item = { fonte: { tipo: 'bunny', libraryId: null, videoId: 'abc' } };
  assert.equal(GTM.resolverFonte(item, { libraryId: '999' }).libraryId, '999');
  assert.equal(GTM.resolverFonte({ fonte: { videoId: null } }, { libraryId: '999' }), null);
});

test('a capa vem da pull zone, não do repositório', () => {
  const item = { fonte };
  assert.equal(
    GTM.urlCapa(item, { pullzone: 'vz-abc123-4f5.b-cdn.net' }),
    'https://vz-abc123-4f5.b-cdn.net/' + fonte.videoId + '/thumbnail.jpg'
  );
  assert.equal(GTM.urlCapa(item, {}), null);
});

test('o trecho animado do hover vem do preview.webp da pull zone', () => {
  const item = { fonte };
  assert.equal(
    GTM.urlPreview(item, { pullzone: 'vz-abc123-4f5.b-cdn.net' }),
    'https://vz-abc123-4f5.b-cdn.net/' + fonte.videoId + '/preview.webp'
  );
  assert.equal(GTM.urlPreview(item, {}), null);
  assert.equal(GTM.urlPreview({ fonte: { videoId: null } }, { pullzone: 'x.b-cdn.net' }), null);
});

/* O preview.webp varia de 779 KB a 2,1 MB. Pedir os 66 junto com a grade são
 * dezenas de MB e a tela inicial morre no celular — por isso o <img> só pode nascer no mouseenter e
 * tem que morrer no mouseleave. */
test('o preview do hover não é carregado junto com a grade', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));

  const feitura = app.match(/function cartao\(item\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(feitura, 'não achei cartao() em app.js');
  assert.ok(!/card-previa/.test(feitura[1]),
    'cartao() monta o preview junto com a grade; ele só pode nascer no mouseenter');

  const hover = app.match(/function ligarPreview\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(hover, 'não achei ligarPreview() em app.js');
  assert.match(hover[1], /addEventListener\('mouseenter'/,
    'o preview precisa ser pedido no mouseenter');
  assert.match(hover[1], /addEventListener\('mouseleave'/,
    'o preview precisa ser descartado no mouseleave');
  assert.match(hover[1], /removeChild/,
    'sair do cartão tem que remover o <img>; escondê-lo mantém os 450 KB vivos');
});

/* Em tela de toque não existe hover, e quem pediu menos movimento não quer um
 * trecho rodando sozinho: nesses casos o cartão fica só com a capa. */
test('o preview do hover se protege contra toque e prefers-reduced-motion', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  assert.match(app, /\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/,
    'falta a guarda de hover/pointer antes de carregar o preview');
  assert.match(app, /prefers-reduced-motion:\s*reduce/,
    'falta respeitar prefers-reduced-motion antes de carregar o preview');
});

/* Mesma armadilha do <meta> do index.html, agora dentro do JS: qualquer imagem
 * marcada com referrerpolicy="no-referrer" leva 403 da pull zone. */
test('nenhuma imagem da grade define referrerpolicy por conta própria', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const semComentarios = app.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/referrerpolicy/i.test(semComentarios),
    'app.js define referrerpolicy numa imagem; a política tem que vir do <meta>');
});

/* ============================ mini-sinopse =============================== */

test('a mini-sinopse corta na palavra e marca o corte com reticências', () => {
  const longa = 'palavra '.repeat(50);
  const resumo = GTM.resumoSinopse({ sinopse: longa });
  assert.ok(resumo.endsWith('…'), 'o corte precisa de reticências: ' + resumo);
  assert.ok(resumo.length <= 191, 'resumo longo demais: ' + resumo.length);
  assert.ok(!/ …$/.test(resumo), 'sobrou espaço antes das reticências');
});

test('a mini-sinopse não corta o que já cabe', () => {
  assert.equal(GTM.resumoSinopse({ sinopse: 'Curta e direta.' }), 'Curta e direta.');
});

test('a mini-sinopse achata quebras de linha — o cartão é de uma coluna só', () => {
  assert.equal(GTM.resumoSinopse({ sinopse: ' Uma linha.\n\n  Outra linha. ' }),
    'Uma linha. Outra linha.');
});

/* Há título publicado sem sinopse (inst-video-geral-goias-tec-2025-master):
 * o cartão não pode quebrar nem ganhar um parágrafo vazio por causa disso. */
test('a mini-sinopse some quando não há sinopse, sem quebrar o cartão', () => {
  assert.equal(GTM.resumoSinopse({ sinopse: '' }), '');
  assert.equal(GTM.resumoSinopse({ sinopse: '   \n ' }), '');
  assert.equal(GTM.resumoSinopse({}), '');
  assert.equal(GTM.resumoSinopse(null), '');

  const app = lerTexto(path.join(SITE, 'app.js'));
  const feitura = app.match(/function cartao\(item\)\s*\{([\s\S]*?)\n  \}/);
  assert.match(feitura[1], /if \(resumo\)/,
    'cartao() precisa pular o parágrafo da sinopse quando o resumo vem vazio');
});

/* ============================ grade e ordenação ========================== */

const acervo = [
  { id: 'b', titulo: 'Cavalhadas', serie: 'Festas', temporada: 1, episodio: 2, publicar: true, fonte },
  { id: 'a', titulo: 'Muquém', serie: 'Festas', temporada: 1, episodio: 1, publicar: true, fonte },
  { id: 'c', titulo: 'Kalunga V1', serie: 'Festas', temporada: 2, episodio: 1, publicar: true, fonte },
  { id: 'd', titulo: 'Avulso', serie: 'A classificar', temporada: null, episodio: null, publicar: true, fonte },
  { id: 'e', titulo: 'Escondido', serie: 'Festas', temporada: 1, episodio: 3, publicar: false, fonte }
];

test('a grade só mostra itens com publicar: true', () => {
  const ids = GTM.publicaveis(acervo).map(i => i.id);
  assert.deepEqual(ids.sort(), ['a', 'b', 'c', 'd']);
});

test('ordena por temporada e episódio, nunca por nome de arquivo', () => {
  const ids = GTM.ordenar(GTM.filtrarPorSerie(acervo, 'Festas')).map(i => i.id);
  assert.deepEqual(ids, ['a', 'b', 'e', 'c']);
});

test('séries de triagem vão para o fim da grade', () => {
  const grupos = GTM.agrupar(GTM.publicaveis(acervo)).map(g => g.serie);
  assert.equal(grupos[grupos.length - 1], 'A classificar');
});

/* A aba "Todas" virou uma grade única: os blocos por série deixavam um cartão
 * sozinho por faixa e a tela inteira vazia à direita. Filtrar por um chip
 * continua valendo — o que saiu foi só o agrupamento visual. */
test('a aba "Todas" é uma grade única, sem cabeçalho de série', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const corpo = app.match(/function renderGrade\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei renderGrade em app.js');
  assert.ok(!/serie-bloco|serie-titulo/.test(corpo[1]),
    'renderGrade voltou a quebrar a grade em blocos por série');
  assert.match(corpo[1], /GTM\.ordenar\(/,
    'a grade única ainda precisa da ordem de ordenar(): série, temporada, episódio');

  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.ok(!/\.serie-titulo/.test(css), 'sobrou CSS morto do cabeçalho de série');
});

/* agrupar() saiu da grade mas continua no core, com teste em cima. */
test('agrupar continua exportado mesmo sem a grade por série', () => {
  assert.equal(typeof GTM.agrupar, 'function');
});

/* ============================ busca ===================================== */

const comAcento = [
  { id: 'x', titulo: 'Festas Típicas de Goiás', serie: 'Festas', sinopse: 'Cavalhadas em Pirenópolis', tags: ['cultura'], publicar: true },
  { id: 'y', titulo: 'Matemática', serie: 'Curtas', sinopse: '', tags: ['ensino médio'], publicar: true }
];

test('a busca ignora acentos', () => {
  assert.equal(GTM.buscar(comAcento, 'goias')[0].id, 'x');
  assert.equal(GTM.buscar(comAcento, 'GOIÁS')[0].id, 'x');
});

test('a busca exige todos os termos', () => {
  assert.equal(GTM.buscar(comAcento, 'festas cavalhadas').length, 1);
  assert.equal(GTM.buscar(comAcento, 'festas matematica').length, 0);
});

test('a busca alcança sinopse e tags', () => {
  assert.equal(GTM.buscar(comAcento, 'pirenopolis')[0].id, 'x');
  assert.equal(GTM.buscar(comAcento, 'ensino')[0].id, 'y');
});

test('busca vazia devolve tudo', () => {
  assert.equal(GTM.buscar(comAcento, '   ').length, 2);
});

/* ============================ navegação ================================= */

test('os vizinhos ficam dentro da própria série e param nas pontas', () => {
  const publicados = GTM.publicaveis(acervo);
  const meio = GTM.vizinhos(publicados, 'b');
  assert.equal(meio.anterior.id, 'a');
  assert.equal(meio.proximo.id, 'c');

  const primeiro = GTM.vizinhos(publicados, 'a');
  assert.equal(primeiro.anterior, null);

  const sozinho = GTM.vizinhos(publicados, 'd');
  assert.equal(sozinho.anterior, null);
  assert.equal(sozinho.proximo, null);
});

/* ============================ admin ===================================== */

test('o id sai do título, sem acento e sem colidir', () => {
  assert.equal(GTM.slug('Festas Típicas de Goiás — Cavalhadas'), 'festas-tipicas-de-goias-cavalhadas');
  const itens = [{ id: 'cavalhadas' }, { id: 'cavalhadas-2' }];
  assert.equal(GTM.idUnico(itens, 'Cavalhadas'), 'cavalhadas-3');
  assert.equal(GTM.idUnico(itens, 'Muquém'), 'muquem');
});

test('sinopse automática nasce marcada como não revisada', () => {
  assert.equal(GTM.precisaRevisao({ sinopse_origem: 'auto' }), true);
  assert.equal(GTM.precisaRevisao({ sinopse_origem: 'revisada' }), false);
  assert.equal(GTM.precisaRevisao({ sinopse_origem: '' }), false);
});

test('item novo nasce não publicado e no esquema do seed', () => {
  const item = GTM.itemNovo({ titulo: 'Teste', videoId: 'abc', libraryId: '1' });
  assert.equal(item.publicar, false);
  assert.equal(item.fonte.tipo, 'bunny');
  assert.equal(item.fonte.videoId, 'abc');
  for (const campo of ['id', 'titulo', 'serie', 'temporada', 'episodio', 'sinopse',
    'tema', 'publico_alvo', 'tags', 'titularidade', 'nivel_evidencia', 'pendencia',
    'publicar', 'sinopse_origem', 'fonte']) {
    assert.ok(campo in item, 'faltou o campo ' + campo);
  }
});

test('duração legível', () => {
  assert.equal(GTM.formatarDuracao({ duracao_seg: 614 }), '10:14');
  assert.equal(GTM.formatarDuracao({ duracao_seg: 3723 }), '1:02:03');
  assert.equal(GTM.formatarDuracao({ duracao_seg: 9 }), '0:09');
});

/* ============================ capítulos ================================= */

const LIB = path.join(__dirname, '..', 'scripts', 'lib');
const CAP = require(path.join(LIB, 'capitulos.mjs'));
const LEG = require(path.join(LIB, 'legenda.mjs'));

/* A legenda do Bunny começa com BOM (`EF BB BF`) antes do `WEBVTT`. Conferido
 * na pull zone em 31/08/2026. Sem cortar isso, `startsWith('WEBVTT')` é falso e
 * o parser morre na primeira linha — nenhum capítulo sairia de lugar nenhum. */
test('o parser de legenda aguenta o BOM que o Bunny põe antes do WEBVTT', () => {
  const comBom = '﻿WEBVTT\n\n1\n00:00:02.930 --> 00:00:05.958\nVai logo!\n';
  const cues = LEG.analisarVtt(comBom);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].texto, 'Vai logo!');
  assert.equal(cues[0].inicio, 2.93);
});

test('o parser aceita carimbo com e sem hora, e ignora NOTE e cue torta', () => {
  assert.equal(LEG.paraSegundos('00:01:02.930'), 62.93);
  assert.equal(LEG.paraSegundos('01:02.930'), 62.93);
  assert.equal(LEG.paraSegundos('sem tempo'), null);
  const vtt = 'WEBVTT\n\nNOTE isto não é fala\n\n1\nsem seta aqui\ntexto solto\n\n2\n00:00:10.000 --> 00:00:12.000\nvale\n';
  assert.deepEqual(LEG.analisarVtt(vtt).map(c => c.texto), ['vale']);
});

/* ARMADILHA achada em 31/08/2026: metade das legendas é ROLANTE — cada cue
 * repete o fim da anterior. Concatenar na marra triplica o texto e o
 * transcrito fica ilegível (foi o que aconteceu no Paraquedismo, 836 cues, e
 * no Bombeiro, 856). O merge tem que descontar a sobreposição. */
test('a junção de cues desconta o texto repetido das legendas rolantes', () => {
  const junto = LEG.juntarSemRepetir(
    'Esse aí sou eu e dá para notar que eu me',
    'Esse aí sou eu e dá para notar que eu me envolvi numa aventura');
  assert.equal(junto, 'Esse aí sou eu e dá para notar que eu me envolvi numa aventura');

  /* pontuação e acento não podem impedir o encaixe */
  assert.equal(
    LEG.juntarSemRepetir('o professor Carlos César Iga,', 'Carlos César Iga, explica'),
    'o professor Carlos César Iga, explica');

  /* sem sobreposição, junta inteiro — não pode comer palavra */
  assert.equal(LEG.juntarSemRepetir('nada em comum', 'texto novo'), 'nada em comum texto novo');
});

test('condensar não repete o texto das legendas rolantes', () => {
  const cues = [
    { inicio: 0, fim: 3, texto: 'as aves podem voar porque' },
    { inicio: 3, fim: 6, texto: 'as aves podem voar porque toda sua estrutura' },
    { inicio: 6, fim: 9, texto: 'toda sua estrutura foi feita para isso' }
  ];
  const blocos = LEG.condensar(cues, 30);
  assert.equal(blocos.length, 1);
  assert.equal(blocos[0].texto, 'as aves podem voar porque toda sua estrutura foi feita para isso');
});

/* O Bunny exige `end` em cada capítulo. Guardamos só `inicio` em
 * capitulos.json: com dois campos por capítulo, mover um corte obriga a mexer
 * no vizinho, e um esquecido deixa buraco na linha do tempo. */
test('cada capítulo fecha onde o seguinte começa, e o último na duração', () => {
  const fechados = CAP.fecharCapitulos(
    [{ inicio: 0, titulo: 'Abertura' }, { inicio: 67, titulo: 'A aula' }, { inicio: 109, titulo: 'O que é' }],
    1626);
  assert.deepEqual(fechados, [
    { titulo: 'Abertura', inicio: 0, fim: 67 },
    { titulo: 'A aula', inicio: 67, fim: 109 },
    { titulo: 'O que é', inicio: 109, fim: 1626 }
  ]);
});

test('a linha do tempo fica contígua: sem buraco e sem sobreposição', () => {
  const fechados = CAP.fecharCapitulos(
    [{ inicio: 300, titulo: 'c' }, { inicio: 0, titulo: 'a' }, { inicio: 90, titulo: 'b' }], 400);
  assert.deepEqual(fechados.map(c => c.titulo), ['a', 'b', 'c'], 'fora de ordem no arquivo deve sair ordenado');
  for (let i = 1; i < fechados.length; i++) assert.equal(fechados[i - 1].fim, fechados[i].inicio);
  assert.equal(fechados[fechados.length - 1].fim, 400);
});

/* Lança em vez de consertar: isto grava no player de um vídeo que está no ar. */
test('capítulo depois do fim do vídeo é erro, não é para ser consertado calado', () => {
  assert.throws(() => CAP.fecharCapitulos([{ inicio: 0, titulo: 'a' }, { inicio: 900, titulo: 'b' }], 600),
    /depois do fim/);
  assert.throws(() => CAP.fecharCapitulos([{ inicio: 10, titulo: 'a' }, { inicio: 10, titulo: 'b' }], 600),
    /mesmo segundo/);
  assert.throws(() => CAP.fecharCapitulos([{ inicio: 0, titulo: 'a' }], 0), /duração inválida/);
  assert.throws(() => CAP.fecharCapitulos([], 600), /nenhum capítulo/);
});

/* Sem isto o script reescreveria os 11 títulos a cada execução: requisição à
 * toa no Bunny e `rev` subindo no KV sem nada ter mudado. */
test('o script reconhece o que já está gravado — rodar de novo não escreve nada', () => {
  const meus = CAP.fecharCapitulos([{ inicio: 0, titulo: 'Abertura' }, { inicio: 67, titulo: 'A aula' }], 200);
  assert.equal(CAP.iguaisNoBunny(meus, [
    { title: 'Abertura', start: 0, end: 67 },
    { title: 'A aula', start: 67, end: 200 }
  ]), true);
  assert.equal(CAP.iguaisNoBunny(meus, [{ title: 'Abertura', start: 0, end: 67 }]), false);
  assert.equal(CAP.iguaisNoBunny(meus, []), false);

  assert.deepEqual(CAP.paraCatalogo(meus), [{ inicio: 0, titulo: 'Abertura' }, { inicio: 67, titulo: 'A aula' }]);
  assert.equal(CAP.iguaisNoCatalogo(meus, CAP.paraCatalogo(meus)), true);
  assert.equal(CAP.iguaisNoCatalogo(meus, [{ inicio: 0, titulo: 'Outro' }]), false);
});

/* O KV é editado pela tela de admin e por script. Capítulo torto não pode
 * derrubar a ficha: ela tem que abrir com o vídeo de qualquer jeito. */
test('a ficha sobrevive a capítulo torto vindo do catálogo', () => {
  const caps = GTM.capitulos({ capitulos: [
    { inicio: '109', titulo: '  O que  é\nfutebol ' },   /* texto e quebra de linha */
    { inicio: 0, titulo: 'Abertura' },                   /* fora de ordem */
    { inicio: 5, titulo: '   ' },                        /* título vazio */
    { inicio: 0, titulo: 'Repetido' },                   /* mesmo segundo */
    { inicio: -3, titulo: 'negativo' },
    null,
    { inicio: 'abc', titulo: 'sem número' }
  ] });
  assert.deepEqual(caps, [{ inicio: 0, titulo: 'Abertura' }, { inicio: 109, titulo: 'O que é futebol' }]);

  /* 27 dos 66 no ar não têm capítulo nenhum: [] é o caminho normal, não erro. */
  assert.deepEqual(GTM.capitulos({}), []);
  assert.deepEqual(GTM.capitulos(null), []);
  assert.deepEqual(GTM.capitulos({ capitulos: 'nada disso' }), []);
});

test('capituloEm acha o capítulo que está tocando', () => {
  const caps = [{ inicio: 0, titulo: 'a' }, { inicio: 67, titulo: 'b' }, { inicio: 109, titulo: 'c' }];
  assert.equal(GTM.capituloEm(caps, 0), 0);
  assert.equal(GTM.capituloEm(caps, 66.9), 0);
  assert.equal(GTM.capituloEm(caps, 67), 1);
  assert.equal(GTM.capituloEm(caps, 5000), 2);
  /* antes do primeiro capítulo é caso real: a Jornada só tem fala em 1:58 */
  assert.equal(GTM.capituloEm([{ inicio: 119, titulo: 'a' }], 10), -1);
  assert.equal(GTM.capituloEm(caps, NaN), -1);
});

test('o tempo do capítulo é escrito como o resto do site', () => {
  assert.equal(GTM.formatarTempo(0), '0:00');
  assert.equal(GTM.formatarTempo(67), '1:07');
  assert.equal(GTM.formatarTempo(3723), '1:02:03');
});

/* A lista clicável fala com DOIS alvos desde a fase 0: o embed do Bunny, do
 * outro lado de uma fronteira de domínio (só o Player.js atravessa), e o
 * player nosso, que está do lado e responde direto.
 *
 * O que não muda em nenhum dos dois: ela NÃO pode chamar play(). Pular para um
 * capítulo posiciona o vídeo; quem decide tocar é quem aperta o play. */
test('a lista de capítulos só posiciona o vídeo — nunca manda tocar', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const corpo = app.match(/function listaCapitulos\(item, alvo\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei listaCapitulos em app.js');
  assert.match(corpo[1], /setCurrentTime/,
    'o caminho do embed precisa posicionar o vídeo pelo Player.js');
  assert.match(corpo[1], /irPara/,
    'o caminho do player nosso precisa posicionar o vídeo por irPara()');
  assert.ok(!/\.play\s*\(/.test(corpo[1]), 'listaCapitulos manda o vídeo tocar');
});

/* ACHADO NO DEDO em 03/09, num aparelho de verdade, e as duas metades do
 * mesmo estrago: **a página não rolava em cima da lista de capítulos**, e às
 * vezes o arrasto virava seleção de texto, com as alças de copiar.
 *
 * 1. `max-height: none` no celular tirava o TETO da lista mas deixava o
 *    `overflow-y: auto`. Um contêiner de rolagem que não rola engole o dedo e
 *    não passa a rolagem adiante — medido em 375 px: `scrollHeight` e
 *    `clientHeight` iguais em 624 px, com `overscroll-behavior: contain` por
 *    cima. E a lista é o pedaço mais alto da ficha no celular.
 * 2. A linha do capítulo é um `<button>` com texto selecionável. Arrastar o
 *    dedo por cima dele seleciona, e a seleção come a rolagem.
 *
 * Nada disso aparece com mouse, e nada disso apareceu em cinco fases de
 * emulação de toque. Por isso tem teste. */
test('a lista de capítulos não engole o dedo de quem está rolando a página', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));

  /* Onde o teto sai, o contêiner de rolagem sai junto. Há mais de um bloco de
   * 900 px na folha — o que importa é o que fala da lista. */
  const blocos = css.match(/@media \(max-width: 900px\) \{[\s\S]*?\n\}/g) || [];
  const daLista = blocos.find((b) => b.includes('.capitulos-lista'));
  assert.ok(daLista, 'não achei a regra de celular da lista de capítulos');
  assert.match(daLista, /\.capitulos-lista \{[^}]*max-height: none/);
  assert.match(daLista, /\.capitulos-lista \{[^}]*overflow-y: visible/,
    'sobrou um overflow-y: auto que não rola nada e trava a página');

  /* A linha é alvo de toque, não texto para copiar. */
  const linha = css.match(/\n\.capitulo \{([\s\S]*?)\n\}/);
  assert.ok(linha, 'não achei .capitulo em style.css');
  assert.match(linha[1], /user-select: none/);
  assert.match(linha[1], /-webkit-touch-callout: none/,
    'sem isto o iOS abre a lupa e o menu de copiar em cima do arrasto');
});

/* O Player.js é externo. Carregá-lo na tela inicial custaria um script a quem
 * só está olhando a grade — e ele só serve na ficha de quem tem capítulos. */
test('o Player.js é carregado sob demanda, não junto com a página', () => {
  const html = lerTexto(path.join(SITE, 'index.html'));
  assert.ok(!/playerjs/i.test(html), 'index.html carrega o Player.js de saída');
  const app = lerTexto(path.join(SITE, 'app.js'));
  assert.match(app, /function carregarPlayerjs\(\)/);
  assert.match(app, /iframe\.isConnected/,
    'voltar para a grade destrói a ficha; o Player.js só pode se ligar a um iframe ainda vivo');
});

/* Mesmo bug da capa: campo que não sai por paraPublico não existe para a
 * grade, e a lista de capítulos sumiria da ficha sem ninguém entender por quê. */
test('a projeção pública leva os capítulos — sem eles a lista some da ficha', () => {
  const fn = lerTexto(path.join(SITE, 'functions', 'api', 'catalogo.js'));
  const proj = fn.match(/function paraPublico\(item\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(proj, 'não achei paraPublico em functions/api/catalogo.js');
  assert.match(proj[1], /capitulos/, 'paraPublico precisa incluir capitulos');
});

/* Terceira vez que este mesmo bug é guardado — capa, capítulos e agora o
 * framerate. O passo de quadro da fase 9 faz `currentTime += 1/framerate`, e o
 * acervo é MISTO (23,976 ×39 · 29,97 ×19 · 30 ×17 · 24 ×4 · 25 ×3, medido
 * contra a library em 09/09/2026): um passo fixo de 1/30 erraria em 65 dos 82.
 * Sem esta linha o número chega ao KV por `scripts/framerate.mjs` e nunca
 * chega ao navegador — e o sintoma seria o atalho simplesmente não existir. */
test('a projeção pública leva o framerate — sem ele o passo de quadro não tem régua', () => {
  const fn = lerTexto(path.join(SITE, 'functions', 'api', 'catalogo.js'));
  const proj = fn.match(/function paraPublico\(item\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(proj, 'não achei paraPublico em functions/api/catalogo.js');
  assert.match(proj[1], /framerate/, 'paraPublico precisa incluir framerate');
});

/* O script que colhe o número tem que sair do KV e voltar para o KV. O seed
 * está com `publicar: false` em tudo desde 20/08 e não sabe da curadoria feita
 * pela tela de admin — é a mesma disciplina do capas-menores, e é o que impede
 * a próxima passada de acervo de reverter 18 títulos como o semear reverteria.
 *
 * O teste cobra o CAMINHO (ler por `?completo=1`, gravar por PUT), e não a
 * ausência da palavra "semear": ela aparece no arquivo de propósito, num
 * comentário que explica justamente por que não se usa aquele script aqui. Um
 * teste que reprovasse a palavra puniria a explicação. */
test('o framerate.mjs lê o KV e grava no KV — nunca no seed como fonte', () => {
  const src = lerTexto(path.join(__dirname, '..', 'scripts', 'framerate.mjs'));
  assert.match(src, /completo=1/, 'framerate.mjs precisa ler o KV por ?completo=1');
  assert.match(src, /method:\s*'PUT'/, 'framerate.mjs precisa gravar o KV por PUT');
  assert.doesNotMatch(src, /^\s*import[^\n]*semear/m,
    'framerate.mjs não pode importar o semear: ele reverteria a curadoria da tela de admin');
});

/* CUSTOU CARO EM 09/09/2026, e no site no ar. A primeira versão do
 * `framerate.mjs` fazia `delete kv.ajustes` antes do PUT, com um comentário
 * afirmando que `config` e `ajustes` eram os dois "campo derivado".
 *
 * **Só o `config` é.** Ele vem do ambiente e o PUT o descarta sozinho. O
 * `ajustes` MORA no documento do catálogo, e foi posto lá exatamente porque
 * `config` se apaga a cada gravação — está escrito na §6 do PROXIMA-SESSAO.md
 * desde 03/09. Apagá-lo num PUT não dá erro: o GET seguinte devolve `null` nos
 * dois campos e o player cai nos padrões do código. O teto do arrasto ajustado
 * para 60% pela tela virou os 40% do código, no ar, até a gravação seguinte.
 *
 * A regra, para qualquer script que grave o catálogo: **o que veio no GET
 * volta no PUT, menos o `config`.** Este teste varre TODOS os scripts que
 * fazem PUT — não só os dois de hoje —, porque o próximo a ser escrito vai ser
 * copiado de um destes. */
test('nenhum script que grava o catálogo apaga os `ajustes` antes do PUT', () => {
  const pasta = path.join(__dirname, '..', 'scripts');
  const gravam = fs.readdirSync(pasta)
    .filter(n => n.endsWith('.mjs'))
    .map(n => ({ nome: n, src: lerTexto(path.join(pasta, n)) }))
    .filter(a => /method:\s*'PUT'/.test(a.src));

  assert.ok(gravam.length >= 2,
    'esperava pelo menos capas-menores.mjs e framerate.mjs gravando o KV por PUT');

  for (const { nome, src } of gravam) {
    assert.doesNotMatch(src, /^\s*delete\s+\w+\.ajustes\s*;/m,
      nome + ' apaga os `ajustes` antes do PUT — isso zera o teto do arrasto e o ' +
      'tempo dos controles no KV, em silêncio. Só o `config` pode sair.');
  }
});

/* O corte NÃO é por duração: é decisão de conteúdo, vídeo a vídeo. A Campanha
 * 20 de Novembro tem 4:09 e é uma lista de quatro pessoas — capítulo ali é
 * ótimo. O 5º Encontro tem 4:12 de depoimentos sobre o mesmo assunto — corte
 * ali seria arbitrário. O que este teste guarda é a disciplina do arquivo. */
test('capitulos.json: todo título é decidido, e nenhum está nas duas listas', () => {
  const definidos = JSON.parse(lerTexto(path.join(__dirname, '..', 'capitulos.json')));
  const comCapitulo = Object.keys(definidos.titulos);
  const semCapitulo = Object.keys(definidos.sem_capitulos).filter(k => k !== 'observacao');

  /* PUBLICADOS acompanha a grade e precisa ser atualizado toda vez que um
   * título entra ou sai dela — é o preço de checar cobertura sem rede. Foi 33
   * até 31/08/2026 e virou 66 em 02/09, quando a pasta ORIGEM DE LINK trouxe
   * 34 títulos, dos quais 33 foram publicados (o `data-semana-dos-povos-
   * indigenas-2025-master` ficou fora: o conteúdo não corresponde ao nome do
   * arquivo). Se este teste falhar depois de publicar algo, é porque falta
   * decidir o capítulo do que entrou — que é exatamente o que ele guarda. */
  const PUBLICADOS = 66;

  assert.ok(comCapitulo.length >= 22, 'capitulos.json encolheu: ' + comCapitulo.length);
  assert.equal(comCapitulo.length + semCapitulo.length, PUBLICADOS,
    `as duas listas juntas têm que cobrir os ${PUBLICADOS} publicados — sobrou ou faltou título`);

  for (const id of comCapitulo) {
    assert.ok(!semCapitulo.includes(id), id + ' está nas duas listas ao mesmo tempo');
  }

  for (const id of comCapitulo) {
    const caps = definidos.titulos[id].capitulos;
    assert.ok(Array.isArray(caps) && caps.length >= 5, id + ' tem capítulos de menos');
    for (let i = 1; i < caps.length; i++) {
      assert.ok(caps[i].inicio > caps[i - 1].inicio, id + ' tem capítulo fora de ordem em ' + caps[i].inicio);
    }
    for (const c of caps) {
      assert.equal(typeof c.titulo, 'string');
      assert.ok(c.titulo.trim().length >= 3, id + ' tem título de capítulo vazio ou curto demais');
      assert.ok(Number.isInteger(c.inicio) && c.inicio >= 0, id + ' tem início inválido: ' + c.inicio);
    }

    /* A linha do tempo tem que fechar contígua com a duração real. */
    const fechados = CAP.fecharCapitulos(caps, caps[caps.length - 1].inicio + 30);
    assert.equal(fechados.length, caps.length);
    for (let i = 1; i < fechados.length; i++) assert.equal(fechados[i - 1].fim, fechados[i].inicio);
  }

  /* Todo motivo de exclusão é escrito, não é lista muda. */
  for (const id of semCapitulo) {
    assert.ok(String(definidos.sem_capitulos[id]).length > 30, id + ' está fora sem motivo escrito');
  }
});

/* ARMADILHA 4 do plano, e a única do lote que custa dinheiro: o institucional
 * NÃO tem legenda nenhuma (`captions: []` na API, 404 em captions/pt.vtt na
 * pull zone — o áudio é só trilha e o AssemblyAI devolveu zero palavras).
 * Gerar capítulo para ele exigiria transcrição paga de um vídeo sem fala. Ele
 * tem que continuar do lado de fora, com o motivo escrito. */
test('o vídeo institucional, que não tem legenda, fica fora e com o motivo escrito', () => {
  const definidos = JSON.parse(lerTexto(path.join(__dirname, '..', 'capitulos.json')));
  const id = 'inst-video-geral-goias-tec-2025-master';
  assert.ok(!(id in definidos.titulos), id + ' ganhou capítulos, mas não tem legenda de onde tirá-los');
  assert.match(definidos.sem_capitulos[id], /LEGENDA/,
    'o motivo do institucional precisa dizer que não há legenda, senão alguém o manda para a transcrição paga');
});

/* ================= o player nosso — fase 0 do PLANO-PLAYER.md ============
 *
 * Estes testes são a contrapartida dos que guardam `urlEmbed()`. Enquanto o
 * embed for o padrão os dois conjuntos convivem; na fase 10, quando o player
 * novo assumir, os do embed saem e ESTES ficam sendo a única garantia das três
 * regras. Por isso eles existem AGORA, na primeira fase, e não no fim.
 */

const GTMP = require('../site/player-core.js');
const PLAYER_JS = lerTexto(path.join(SITE, 'player.js'));

/* Este arquivo é comentado de propósito, e os comentários FALAM das regras —
 * "o único lugar que chama video.play()". Contar ocorrências no texto cru
 * confundiria a menção com o uso. Mesma distinção que o teste da AccessKey faz
 * lá embaixo: citar é permitido, usar não. */
const semComentarios = (js) => js.replace(/\/\*[\s\S]*?\*\//g, '');
const PLAYER_CODIGO = semComentarios(PLAYER_JS);

test('REGRA 1 — o player nosso não toca sozinho', () => {
  assert.equal(GTMP.REGRAS.autoplay, false);
  assert.equal(GTMP.atributosVideo().autoplay, false);

  /* Uma única chamada de play() no projeto inteiro, dentro de alternarPlay,
   * que só roda a partir de um gesto de quem está assistindo. Se este número
   * subir, alguém arrumou um segundo lugar de onde o vídeo pode começar
   * sozinho — e é exatamente isso que não pode existir. */
  const chamadas = PLAYER_CODIGO.match(/\.play\s*\(/g) || [];
  assert.equal(chamadas.length, 1,
    'player.js tem ' + chamadas.length + ' chamadas de play(); a regra é uma só, em alternarPlay');
});

/* A VIRADA DE 03/09: o player nosso deixou de estar atrás de uma chave.
 *
 * O que este teste guarda não é a virada em si — é o que a torna barata de
 * desfazer. Enquanto as duas redes abaixo estiverem armadas, um problema numa
 * sala com a aula começando se resolve com uma URL, e não com um deploy. */
test('o player nosso é o padrão, e o embed continua a uma URL de distância', () => {
  const pedido = PLAYER_JS.match(/function playerNovoPedido\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(pedido, 'não achei playerNovoPedido em player.js');

  /* A chave virou uma SAÍDA: só `?player=embed` devolve o iframe. */
  assert.match(pedido[1], /get\('player'\) !== 'embed'/,
    'o player nosso precisa ser o padrão, com o embed como exceção');
  /* E o navegador velho demais para `URLSearchParams` cai no embed, que é a
   * resposta certa: ele provavelmente também não daria conta do player novo. */
  assert.match(pedido[1], /catch \(e\) \{\s*\n\s*return false;/);

  /* A segunda rede: se `criar()` devolver null — ou se o player.js nem tiver
   * carregado, e `GTMPlayer` for undefined — o iframe assume sozinho, e o
   * `urlEmbed()` continua existindo para isso. */
  const app = lerTexto(path.join(SITE, 'app.js'));
  assert.match(app, /typeof GTMPlayer !== 'undefined' && GTMPlayer\.pedido\(\)/);
  assert.match(app, /if \(fonte && !alvoCapitulos\) \{/,
    'sem este bloco, quem cair fora do player novo fica sem vídeo nenhum');
  assert.match(app, /iframe\.src = GTM\.urlEmbed\(fonte\)/);
  assert.equal(typeof GTM.urlEmbed, 'function',
    'urlEmbed é o plano B: ele não sai enquanto for a rede de segurança');
});

test('REGRA 2 — o player nosso não repete', () => {
  assert.equal(GTMP.REGRAS.loop, false);
  assert.equal(GTMP.atributosVideo().loop, false);
  assert.ok(!/loop\s*=\s*true/.test(PLAYER_JS), 'player.js liga loop em algum lugar');
});

/* REGRA 3 está no teste "a interface não reage ao fim do vídeo", lá em cima,
 * que agora varre também player.js e player-core.js atrás da string 'ended'.
 * A garantia é a AUSÊNCIA do listener: sem ele não existe lugar conveniente
 * para pendurar um "próximo episódio" automático. */

test('as regras ficam num objeto congelado — ninguém as relaxa em tempo de execução', () => {
  assert.ok(Object.isFrozen(GTMP.REGRAS));
});

/* O `preload=false` do embed traduzido para o player nosso são DUAS travas, e
 * as duas precisam existir: o atributo do <video> e o autoStartLoad do hls.js.
 * Só a primeira deixaria o hls.js puxando segmentos assim que a ficha abre —
 * quem só queria ler a sinopse pagaria a banda do vídeo inteiro. */
test('nada é baixado antes do play — nem pelo <video>, nem pelo hls.js', () => {
  assert.equal(GTMP.atributosVideo().preload, 'none');
  assert.equal(GTMP.configHls().autoStartLoad, false);
  assert.match(PLAYER_JS, /hls\.startLoad\(\)/,
    'alguém tem que liberar o download no primeiro play');
});

/* `rememberPosition=false` do embed: não gravamos onde o vídeo parou.
 *
 * A fase 2 abriu UMA exceção ao "nada guardado no navegador": a preferência de
 * legenda (ligada/desligada e o corpo da letra). Ligar a legenda a cada vídeo é
 * o tipo de atrito que faz alguém desistir de usá-la, e quem depende dela
 * depende sempre.
 *
 * A fase 4 abriu a SEGUNDA, pelo mesmo motivo: quem precisa de reforço de
 * volume precisa dele em TODO vídeo, e refazer 200% a cada título
 * transformaria o item 12 em enfeite.
 *
 * Por isso este teste deixou de ser "nada de armazenamento" e passou a ser uma
 * LISTA: pode guardar a legenda e o som, NÃO pode guardar a posição. Cada
 * item novo tem que passar por aqui de propósito — é o que impede o dia em que
 * alguém guardar `currentTime` "só para retomar de onde parou". */
test('o player não lembra onde o vídeo parou', () => {
  assert.equal(GTMP.REGRAS.lembrarPosicao, false);

  assert.ok(!/sessionStorage|indexedDB|document\.cookie/.test(PLAYER_CODIGO),
    'player.js usa um armazenamento fora do previsto');

  const usos = PLAYER_CODIGO.match(/localStorage\.\w+\([^)]*\)/g) || [];
  assert.ok(usos.length > 0, 'a preferência de legenda deveria estar sendo guardada');
  for (const uso of usos) {
    assert.match(uso, /CHAVE_LEGENDA|CHAVE_SOM/,
      'só legenda e som podem ser guardados; apareceu: ' + uso);
  }

  /* O que a preferência de som pode conter, item a item: volume e estável, e
   * mais nada. Sem isto, o objeto guardado seria o lugar cômodo para pendurar
   * a posição do vídeo numa fase futura, sem ninguém notar. */
  const gravaSom = PLAYER_CODIGO.match(/CHAVE_SOM,[\s\S]{0,200}?\)\)/);
  assert.ok(gravaSom, 'a preferência de som deveria estar sendo guardada');
  assert.match(gravaSom[0], /volume/);
  assert.match(gravaSom[0], /estavel/);
  assert.ok(!/tempo|currentTime|posicao/i.test(gravaSom[0]),
    'a preferência de som virou esconderijo da posição: ' + gravaSom[0]);

  /* A trava de verdade: nada que venha do relógio do vídeo pode ser gravado. */
  const gravacoes = PLAYER_CODIGO.match(/setItem\([\s\S]{0,200}?\)/g) || [];
  for (const g of gravacoes) {
    assert.ok(!/currentTime|duration|posicao/i.test(g),
      'a posição do vídeo está indo para o armazenamento: ' + g);
  }
});

/* Sem o try/catch, `localStorage` LANÇA em aba anônima, com armazenamento
 * bloqueado por política de rede ou com a cota estourada — e o player inteiro
 * morre antes de desenhar o primeiro quadro, por causa de uma preferência. */
test('ler e gravar a preferência nunca derruba o player', () => {
  for (const fn of ['lerPreferenciaLegenda', 'gravarPreferenciaLegenda']) {
    const corpo = PLAYER_JS.match(new RegExp('function ' + fn + '\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n  \\}'));
    assert.ok(corpo, 'não achei ' + fn + ' em player.js');
    assert.match(corpo[1], /try\s*\{/, fn + ' precisa de try/catch: localStorage lança em aba anônima');
    assert.match(corpo[1], /catch/, fn + ' precisa tratar a exceção');
  }
});

/* Bug que o iframe não tinha: remover o <video> do DOM para o elemento, mas a
 * instância do hls.js sobrevive com os carregadores dela e segue puxando
 * segmentos da pull zone para um vídeo que ninguém está vendo. */
test('sair da ficha destrói o hls.js, não só o elemento', () => {
  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(destruir, 'não achei destruir() em player.js');
  assert.match(destruir[1], /hls\.destroy\(\)/, 'destruir() não desmonta o hls.js');
  assert.match(destruir[1], /removeAttribute\('src'\)/,
    'sem tirar o src, o download em andamento continua até o fim');

  const app = lerTexto(path.join(SITE, 'app.js'));
  for (const fn of ['renderGrade', 'renderFicha']) {
    const corpo = app.match(new RegExp('function ' + fn + '\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n  \\}'));
    assert.ok(corpo, 'não achei ' + fn + ' em app.js');
    assert.match(corpo[1], /destruirPlayer\(\)/,
      fn + ' não destrói o player ao sair — o hls.js continuaria baixando');
  }
});

test('o HLS sai da pull zone, e só de fonte do Bunny', () => {
  const config = { pullzone: 'vz-teste.b-cdn.net' };
  assert.equal(GTMP.urlHls(fonte, config),
    'https://vz-teste.b-cdn.net/' + fonte.videoId + '/playlist.m3u8');
  assert.equal(GTMP.urlHls(fonte, {}), null, 'sem pullzone não há URL');
  assert.equal(GTMP.urlHls(null, config), null);
  assert.equal(GTMP.urlHls({ tipo: 'vimeo', videoId: 'x' }, config), null);
  /* `https://` na frente do pullzone é erro de digitação frequente no .env */
  assert.match(GTMP.urlHls(fonte, { pullzone: 'https://vz-teste.b-cdn.net/' }),
    /^https:\/\/vz-teste\.b-cdn\.net\//);
});

/* O MP4 é rede de segurança, não caminho principal: sem qualidade adaptativa,
 * o 720p de um vídeo de 10 minutos tem 130 MB (medido em 01/09). Numa rede de
 * escola o padrão TEM que ser modesto. */
test('o fallback de MP4 é 360p por padrão, não a melhor resolução', () => {
  assert.match(GTMP.urlMp4(fonte, { pullzone: 'vz-teste.b-cdn.net' }), /play_360p\.mp4$/);
  assert.match(PLAYER_JS, /urlMp4\(fonte, config, '360p'\)/,
    'player.js pediu outra resolução de fallback');
});

/* ARMADILHA medida em 01/09, num Chromium 148 no Windows: `canPlayType(
 * 'application/vnd.apple.mpegurl')` responde **"maybe"** e o navegador NÃO
 * toca HLS — o vídeo fica em readyState 0 para sempre. O Chrome do Android faz
 * o mesmo há anos.
 *
 * Este teste existe para impedir que alguém "conserte" a ordem de volta para a
 * intuitiva (nativo primeiro), que é justamente a que quebra. */
test('o hls.js ganha do HLS nativo — canPlayType mente no Chromium', () => {
  assert.equal(GTMP.estrategia({ hlsNativo: true, mseDisponivel: true }), 'hlsjs',
    'com MSE presente, o hls.js manda: o "maybe" do Chromium não é confiável');
  assert.equal(GTMP.estrategia({ hlsNativo: false, mseDisponivel: true }), 'hlsjs');
  /* Sem MSE é o iPhone, onde o HLS nativo do Safari é de verdade. */
  assert.equal(GTMP.estrategia({ hlsNativo: true, mseDisponivel: false }), 'nativo');
  assert.equal(GTMP.estrategia({ hlsNativo: false, mseDisponivel: false }), 'mp4');
  assert.equal(GTMP.estrategia({}), 'mp4');
  assert.equal(GTMP.estrategia(), 'mp4');
});

/* Todo pulo do player passa por limitarTempo — teclado, gesto, capítulo,
 * barra. A duração NaN é caso real e não teórico: antes do `loadedmetadata` o
 * <video> devolve NaN, e é nesse instante que um clique na lista de capítulos
 * chega. */
test('nenhum pulo sai das pontas do vídeo', () => {
  assert.equal(GTMP.limitarTempo(-5, 100), 0);
  assert.equal(GTMP.limitarTempo(50, 100), 50);
  assert.equal(GTMP.limitarTempo(500, 100), 100);
  assert.equal(GTMP.limitarTempo(NaN, 100), 0);
  assert.equal(GTMP.limitarTempo('30', 100), 30);
  assert.equal(GTMP.limitarTempo(500, NaN), 500, 'sem duração conhecida, só o chão de 0 vale');
  assert.equal(GTMP.limitarTempo(500, Infinity), 500);
  assert.equal(GTMP.limitarTempo(-5, NaN), 0);
});

test('os pulos relativos do teclado respeitam as pontas', () => {
  assert.equal(GTMP.tempoRelativo(50, 10, 100), 60);
  assert.equal(GTMP.tempoRelativo(95, 10, 100), 100);
  assert.equal(GTMP.tempoRelativo(3, -5, 100), 0);
  assert.equal(GTMP.tempoRelativo(NaN, 10, 100), 10);
});

/* As teclas 0–9 do YouTube. Sem duração não dá para calcular porcentagem, e
 * pular para "30% de NaN" mandaria o vídeo para 0 sem ninguém entender. */
test('as teclas 0–9 pulam para a porcentagem certa, e desistem sem duração', () => {
  assert.equal(GTMP.tempoPorDecimo(0, 600), 0);
  assert.equal(GTMP.tempoPorDecimo(3, 600), 180);
  assert.equal(GTMP.tempoPorDecimo(9, 600), 540);
  assert.equal(GTMP.tempoPorDecimo(5, NaN), null);
  assert.equal(GTMP.tempoPorDecimo(5, 0), null);
  assert.equal(GTMP.tempoPorDecimo(10, 600), null);
  assert.equal(GTMP.tempoPorDecimo('x', 600), null);
});

/* Sem `playsinline` o iPhone abre o vídeo em tela cheia nativa ao dar play e
 * engole a barra, os capítulos e todos os gestos das fases seguintes.
 * Sem `crossorigin` o Safari tocando HLS nativo entrega mídia "suja" e o
 * Web Audio da fase 4 devolve silêncio. */
test('o <video> nasce com playsinline e crossorigin — as duas travas do iOS', () => {
  const a = GTMP.atributosVideo();
  assert.equal(a.playsInline, true);
  assert.equal(a.crossOrigin, 'anonymous');
  assert.equal(a.controls, false, 'os controles nativos ficam desligados: a barra é nossa');
  assert.match(PLAYER_JS, /setAttribute\('playsinline', ''\)/,
    'iOS antigo lê o atributo, não a propriedade');
});

/* Mesma disciplina do Player.js dos capítulos: quem abre a grade não paga por
 * uma biblioteca que a grade não usa. São 353 KB. */
test('o hls.js é carregado sob demanda, nunca junto com a página', () => {
  const html = lerTexto(path.join(SITE, 'index.html'));
  assert.ok(!/<script[^>]+hls/i.test(html), 'index.html carrega o hls.js de saída');
  assert.match(html, /<script src="player-core\.js"><\/script>/);
  assert.match(html, /<script src="player\.js"><\/script>/);
  assert.match(PLAYER_JS, /function carregarHls\(\)/);
});

/* A única dependência de terceiros do projeto. Se a versão do arquivo e a do
 * LEIA-ME divergirem, ninguém mais sabe o que está no ar. */
test('a versão do hls.js vendorizada é a que o LEIA-ME declara', () => {
  const leiaMe = lerTexto(path.join(SITE, 'vendor', 'LEIA-ME.md'));
  const declarada = leiaMe.match(/hls\.js\s+(\d+\.\d+\.\d+)/);
  assert.ok(declarada, 'o LEIA-ME do vendor precisa declarar a versão do hls.js');

  const bundle = lerTexto(path.join(SITE, 'vendor', 'hls.light.min.js'));
  assert.ok(bundle.includes('"' + declarada[1] + '"'),
    'o arquivo vendorizado não é a versão ' + declarada[1] + ' que o LEIA-ME declara');
  assert.ok(!/sourceMappingURL/.test(bundle),
    'o sourceMappingURL faz o navegador pedir um .map que não é servido');
  assert.match(bundle, /\.Hls\s*=/, 'o bundle precisa expor Hls no escopo global');
});

/* ================= teclado do player — fase 1 ===========================
 *
 * Toda a decisão "que tecla virou que ação" mora numa função pura, e é por
 * isso que ela pode ser testada aqui, sem navegador. É a promessa da seção 5
 * do PLANO-PLAYER.md sendo cobrada.
 */

const tecla = (key, extra) => GTMP.acaoDeTecla(Object.assign({ key }, extra || {}));

/* A TRAVA MAIS IMPORTANTE DA FASE. O site tem um campo de busca no topo de
 * TODAS as telas. Sem ela, digitar "futebol" com a ficha aberta silencia o
 * vídeo (m), pula para 60% (6), muda a velocidade e entra em tela cheia. */
test('nenhuma tecla age enquanto alguém está digitando na busca', () => {
  for (const k of [' ', 'k', 'j', 'l', 'm', 'f', 't', '6', 'ArrowLeft', 'ArrowUp', 'Home', 'End']) {
    assert.equal(tecla(k, { digitando: true }), null, 'a tecla ' + k + ' agiu durante a digitação');
  }
  assert.equal(tecla('>', { digitando: true, shiftKey: true }), null);
  assert.equal(tecla('n', { digitando: true, shiftKey: true }), null);
});

/* Com o foco num botão, o navegador já dispara o clique dele no espaço e no
 * Enter. Sem esta regra, apertar espaço com o foco no play alterna DUAS vezes
 * e nada parece acontecer. */
test('espaço e Enter num botão focado pertencem ao botão', () => {
  assert.equal(tecla(' ', { emBotao: true }), null);
  assert.equal(tecla('Enter', { emBotao: true }), null);
  /* As outras teclas continuam valendo mesmo com o foco num botão. */
  assert.deepEqual(tecla('l', { emBotao: true }), { acao: 'pular', segundos: 10 });
});

test('reprodução básica: K e espaço', () => {
  assert.deepEqual(tecla('k'), { acao: 'alternarPlay' });
  assert.deepEqual(tecla(' '), { acao: 'alternarPlay' });
  /* CapsLock ligado não pode desligar o atalho. */
  assert.deepEqual(tecla('K'), { acao: 'alternarPlay' });
});

test('J e L pulam 10 s; as setas, 5 s', () => {
  assert.deepEqual(tecla('j'), { acao: 'pular', segundos: -10 });
  assert.deepEqual(tecla('l'), { acao: 'pular', segundos: 10 });
  assert.deepEqual(tecla('ArrowLeft'), { acao: 'pular', segundos: -5 });
  assert.deepEqual(tecla('ArrowRight'), { acao: 'pular', segundos: 5 });
});

test('Home, End e os dígitos 0–9', () => {
  assert.deepEqual(tecla('Home'), { acao: 'irPara', segundos: 0 });
  assert.deepEqual(tecla('End'), { acao: 'irParaFim' });
  assert.deepEqual(tecla('0'), { acao: 'irParaDecimo', digito: 0 });
  assert.deepEqual(tecla('7'), { acao: 'irParaDecimo', digito: 7 });
  /* 'F1' passa numa comparação ingênua de string com '0' e '9'. */
  assert.equal(tecla('F1'), null);
  assert.equal(tecla('F12'), null);
});

/* Em ABNT2 e US, Shift+. dá ">" e Shift+, dá "<". Aceitamos as duas leituras
 * porque nem todo layout produz o caractere. */
test('Shift + > e Shift + < mudam a velocidade, nos dois jeitos de ler a tecla', () => {
  assert.deepEqual(tecla('>', { shiftKey: true }), { acao: 'velocidade', passo: 1 });
  assert.deepEqual(tecla('<', { shiftKey: true }), { acao: 'velocidade', passo: -1 });
  assert.deepEqual(tecla('.', { shiftKey: true }), { acao: 'velocidade', passo: 1 });
  assert.deepEqual(tecla(',', { shiftKey: true }), { acao: 'velocidade', passo: -1 });
});

test('M silencia, as setas verticais mexem no volume', () => {
  assert.deepEqual(tecla('m'), { acao: 'alternarMudo' });
  assert.deepEqual(tecla('ArrowUp'), { acao: 'volume', passo: 0.05 });
  assert.deepEqual(tecla('ArrowDown'), { acao: 'volume', passo: -0.05 });
});

test('F é tela cheia e T é modo teatro', () => {
  assert.deepEqual(tecla('f'), { acao: 'alternarTelaCheia' });
  assert.deepEqual(tecla('t'), { acao: 'alternarTeatro' });
});

/* Navegação EXPLÍCITA por tecla — o mesmo gesto deliberado de clicar nos
 * botões da série. Não tem nada a ver com avanço automático, que continua
 * proibido: nada disto é disparado pelo fim do vídeo. */
test('Shift+N e Shift+P trocam de episódio', () => {
  assert.deepEqual(tecla('n', { shiftKey: true }), { acao: 'episodio', direcao: 1 });
  assert.deepEqual(tecla('p', { shiftKey: true }), { acao: 'episodio', direcao: -1 });
});

/* Ctrl+Shift+N abre janela anônima no Chrome. Se o modificador não fosse
 * checado ANTES do Shift, a tecla também trocaria de episódio pelas costas. */
test('Ctrl, Alt e Meta não são nossos — nem combinados com Shift', () => {
  for (const mod of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
    assert.equal(tecla('n', Object.assign({ shiftKey: true }, mod)), null);
    assert.equal(tecla('k', mod), null);
    assert.equal(tecla('f', mod), null);
  }
  /* A ÚNICA exceção, aberta pela fase 3: Ctrl + setas são os capítulos. As
   * setas com Alt e com Meta continuam fora — Alt+seta é voltar e avançar no
   * histórico do navegador, e Cmd+seta é o mesmo no Mac. */
  assert.equal(tecla('ArrowRight', { altKey: true }), null);
  assert.equal(tecla('ArrowLeft', { altKey: true }), null);
  assert.equal(tecla('ArrowRight', { metaKey: true }), null);
  assert.equal(tecla('ArrowLeft', { metaKey: true }), null);
});

/* Uma tecla que ainda não é nossa tem que voltar null — o player não chama
 * preventDefault e ela continua com o navegador, que é o certo. */
test('as teclas das fases seguintes ainda não respondem', () => {
  assert.equal(tecla(','), null, 'quadro a quadro é a fase 9');
  assert.equal(tecla('.'), null, 'quadro a quadro é a fase 9');
  assert.equal(tecla('i'), null, 'miniplayer é a fase 7');
  assert.equal(tecla('Tab'), null, 'Tab é da navegação por teclado, não nossa');
  assert.equal(tecla('Escape'), null);
});

test('acaoDeTecla aguenta entrada torta sem lançar', () => {
  assert.equal(GTMP.acaoDeTecla(), null);
  assert.equal(GTMP.acaoDeTecla({}), null);
  assert.equal(GTMP.acaoDeTecla({ key: null }), null);
  assert.equal(GTMP.acaoDeTecla({ key: '' }), null);
  assert.equal(GTMP.acaoDeTecla({ key: 7 }), null);
});

/* Degraus, e não escala contínua: 1,25 e 1,5 são o que a pessoa procura, e um
 * passo de 0,1 exigiria cinco toques para chegar em 1,5. */
test('a velocidade anda pelos degraus do YouTube e para nas pontas', () => {
  assert.equal(GTMP.proximaVelocidade(1, 1), 1.25);
  assert.equal(GTMP.proximaVelocidade(1, -1), 0.75);
  assert.equal(GTMP.proximaVelocidade(2, 1), 2, 'não passa de 2x');
  assert.equal(GTMP.proximaVelocidade(0.25, -1), 0.25, 'não desce de 0,25x');
  /* O 2x temporário do gesto da fase 5 pode deixar uma velocidade fora da
   * lista; daí ela cai no degrau mais próximo antes de andar. */
  assert.equal(GTMP.proximaVelocidade(1.4, 1), 1.75);
  assert.equal(GTMP.proximaVelocidade(1.4, -1), 1.25);
});

test('o volume fica entre 0 e 1, sem lixo de ponto flutuante', () => {
  assert.equal(GTMP.proximoVolume(0.5, 0.05), 0.55);
  assert.equal(GTMP.proximoVolume(1, 0.05), 1, 'não passa de 100%');
  assert.equal(GTMP.proximoVolume(0, -0.05), 0, 'não desce de 0');
  assert.equal(GTMP.proximoVolume(NaN, -0.05), 0.95, 'sem valor conhecido, parte de 100%');
  /* Somar 0,05 oito vezes daria 0.4000000000000001 e o selo mostraria
   * "Volume 40.00000000000001%". */
  let v = 0;
  for (let i = 0; i < 8; i++) v = GTMP.proximoVolume(v, 0.05);
  assert.equal(v, 0.4);
});


/* ================================= fase 4 — o som ========================
 *
 * O grafo `<video>` → ganho → compressor → saída resolve quatro itens de uma
 * vez, e o que está testado aqui é a parte que DECIDE: o teto do volume, por
 * onde ele passa, o que o compressor vira em cada caso e o que o selo diz.
 * A montagem do grafo é DOM e vive no player.js — dela, o que dá para provar
 * sem navegador é a forma, e é o que os testes de código-fonte fazem no fim.
 */

test('sem grafo o volume para em 100% — prometer reforço ali seria mentira', () => {
  /* `video.volume` não passa de 1 em navegador nenhum. O teto padrão continua
   * sendo 1 justamente para que quem não montou grafo não veja "150%". */
  assert.equal(GTMP.proximoVolume(1, 0.05), 1);
  assert.equal(GTMP.proximoVolume(0.98, 0.05), 1);
});

test('com grafo o volume vai até 200% e para lá (item 12)', () => {
  const M = GTMP.VOLUME_MAX_GANHO;
  assert.equal(M, 2);
  assert.equal(GTMP.proximoVolume(1, 0.05, M), 1.05);
  assert.equal(GTMP.proximoVolume(2, 0.05, M), 2, 'não passa de 200%');
  assert.equal(GTMP.proximoVolume(0, -0.05, M), 0, 'o piso continua sendo 0');
  /* Um teto torto não pode virar volume infinito nem abaixar o teto normal. */
  assert.equal(GTMP.proximoVolume(1, 0.05, NaN), 1);
  assert.equal(GTMP.proximoVolume(1, 0.05, 0.5), 1, 'teto abaixo de 1 é ignorado');
});

/* A regra mais importante da fase, e a razão de `viaDoVolume` existir:
 * `createMediaElementSource` NÃO TEM VOLTA. Depois dele o áudio do vídeo só
 * sai pelo grafo, e um grafo que falhe deixa o vídeo mudo. Montar por precaução
 * é trocar um risco zero por um risco real. */
test('o grafo não é montado para quem não precisa dele', () => {
  const via = GTMP.viaDoVolume({ pedido: 0.8, grafoAtivo: false, elementoObedece: true });
  assert.equal(via, 'elemento', 'desktop em 80%: video.volume dá conta sozinho');
});

test('as duas — e só as duas — razões para montar o grafo', () => {
  /* 1. passar de 100%, que o elemento não faz */
  assert.equal(
    GTMP.viaDoVolume({ pedido: 1.5, grafoAtivo: false, elementoObedece: true }),
    'montar');
  /* 2. o elemento não obedecer, que é o iPhone (item 22) */
  assert.equal(
    GTMP.viaDoVolume({ pedido: 0.4, grafoAtivo: false, elementoObedece: false }),
    'montar');
});

test('com o grafo montado tudo passa pelo ganho', () => {
  assert.equal(GTMP.viaDoVolume({ pedido: 0.3, grafoAtivo: true, elementoObedece: true }), 'ganho');
  assert.equal(GTMP.viaDoVolume({ pedido: 1.8, grafoAtivo: true, elementoObedece: false }), 'ganho');
});

/* O plano B do PLANO-PLAYER.md §4.2, escrito como código: se o grafo não for
 * possível — navegador sem Web Audio, ou uma tentativa que já falhou — e o
 * elemento não obedecer, não há o que fazer, e o certo é DIZER isso. */
test('sem grafo possível e sem elemento que obedeça, a via é nenhuma', () => {
  assert.equal(
    GTMP.viaDoVolume({ pedido: 0.4, grafoAtivo: false, elementoObedece: false, grafoPossivel: false }),
    'nenhuma');
  assert.equal(
    GTMP.viaDoVolume({ pedido: 1.5, grafoAtivo: false, elementoObedece: true, grafoPossivel: false }),
    'nenhuma');
});

test('viaDoVolume aguenta entrada torta sem lançar', () => {
  assert.equal(GTMP.viaDoVolume(), 'elemento');
  assert.equal(GTMP.viaDoVolume({}), 'elemento');
  assert.equal(GTMP.viaDoVolume({ pedido: NaN, elementoObedece: true }), 'elemento');
});

/* DOIS nós, e não um — e a razão é uma MEDIDA, não uma preferência.
 *
 * Com um compressor só, 200% + Volume Estável dava pico 1,846 no analisador,
 * contra o player rodando: clipe puro. O nivelador não segurava porque o
 * ataque de 20 ms deixa o transiente passar inteiro, e num ganho de 3,8× o
 * transiente é justamente o que estoura. Nivelar é sobre a MÉDIA; limitar é
 * sobre o TRANSIENTE. Um nó não faz as duas coisas. */
test('sem estável e sem reforço, os dois nós são transparentes', () => {
  const n = GTMP.ajusteNivelador({ estavel: false });
  const l = GTMP.ajusteLimitador({ ganho: 1 });
  assert.equal(n.ratio, 1, 'razão 1 é ausência de compressão');
  assert.equal(l.ratio, 1);
  assert.equal(n.threshold, 0);
  assert.equal(l.threshold, 0);
});

test('o Volume Estável é o nivelador, e só ele (item 8)', () => {
  const n = GTMP.ajusteNivelador({ estavel: true });
  assert.ok(n.threshold <= -20, 'pega bem antes do pico, senão não nivela nada');
  assert.ok(n.ratio > 1 && n.ratio < 10, 'razão de nivelar, não de limitar');
  assert.ok(n.knee >= 12, 'joelho macio: um compressor duro em aula gravada bombeia');
});

test('o limitador é quem segura o reforço, e olha o ganho de SAÍDA', () => {
  const l = GTMP.ajusteLimitador({ ganho: 3.8 });
  assert.ok(l.ratio >= 20, 'razão de limitador, não de compressor');
  assert.ok(l.attack <= 0.005,
    'ataque rápido: com 20 ms o transiente passa antes de ele agir — foi o bug');
  assert.ok(l.threshold > -10, 'teto alto: ele pega o pico, não o corpo do som');
});

/* A regressão que a medida de 02/09 pegou: o estável NÃO pode desligar o
 * limitador. Foi exatamente isso que deixou 200% + estável clipar em 1,846. */
test('o Volume Estável não desliga o limitador', () => {
  const ganho = GTMP.ganhoDeSaida({ volume: 2, estavel: true });
  assert.ok(GTMP.ajusteLimitador({ ganho: ganho }).ratio >= 20,
    'com o estável ligado o limitador continua limitando');

  /* E o estável SOZINHO, sem Boost nenhum, já leva o ganho a 1,9 — o limitador
   * tem que entrar aí também, senão o item 8 clipa por conta própria. */
  const soEstavel = GTMP.ganhoDeSaida({ volume: 1, estavel: true });
  assert.ok(soEstavel > 1);
  assert.ok(GTMP.ajusteLimitador({ ganho: soEstavel }).ratio >= 20);
});

/* O iPhone monta o grafo só para TER volume (item 22), em volume normal. Ali
 * ele não pode ganhar um limitador que ninguém pediu: um vídeo masterizado
 * perto de 0 dBFS soaria diferente no iPhone e no desktop. */
test('volume normal não ganha limitador só porque o grafo existe', () => {
  assert.equal(GTMP.ajusteLimitador({ ganho: 1 }).ratio, 1);
  assert.equal(GTMP.ajusteLimitador({ ganho: 0.4 }).ratio, 1);
});

test('os ajustes aguentam entrada torta sem lançar', () => {
  assert.equal(GTMP.ajusteNivelador().ratio, 1);
  assert.equal(GTMP.ajusteLimitador().ratio, 1);
  assert.equal(GTMP.ajusteLimitador({ ganho: NaN }).ratio, 1);
});

/* `DynamicsCompressorNode` não tem makeup gain — ele só abaixa. Sem a
 * compensação, LIGAR o Volume Estável deixaria o vídeo mais baixo, que é o
 * oposto do que a pessoa pediu ao ligar. */
test('o Volume Estável devolve o que o compressor tirou', () => {
  const semEstavel = GTMP.ganhoDeSaida({ volume: 1, estavel: false });
  const comEstavel = GTMP.ganhoDeSaida({ volume: 1, estavel: true });
  assert.equal(semEstavel, 1);
  assert.ok(comEstavel > semEstavel, 'ligar o estável não pode abaixar o som');
});

test('o ganho tem teto — ninguém precisa de 400%', () => {
  const g = GTMP.ganhoDeSaida({ volume: 2, estavel: true });
  assert.ok(g <= GTMP.GANHO_MAX);
  assert.equal(GTMP.ganhoDeSaida({ volume: -3, estavel: false }), 0, 'ganho negativo é 0');
  assert.equal(GTMP.ganhoDeSaida({ volume: NaN, estavel: false }), 0);
});

/* O selo diz a verdade — é promessa do projeto desde a fase 1, e promessa do
 * projeto tem teste. Mostrar "Volume 40%" com o som parado no mesmo lugar é
 * exatamente o que o iPhone faria sem isto. */
test('o selo do volume não mente no iPhone', () => {
  assert.equal(
    GTMP.rotuloVolume({ via: 'nenhuma', volume: 0.4 }),
    'Volume: use os botões do aparelho');
});

test('o selo mostra o reforço em vez de escondê-lo', () => {
  assert.equal(GTMP.rotuloVolume({ via: 'elemento', volume: 0.4 }), 'Volume 40%');
  assert.equal(GTMP.rotuloVolume({ via: 'ganho', volume: 1 }), 'Volume 100%');
  assert.match(GTMP.rotuloVolume({ via: 'ganho', volume: 1.5 }), /150%.*reforço/);
});

/* ---------------------------------- o moldador: o teto que é aritmética ---
 *
 * Toda a seção acima é ajuste medido — números escolhidos porque o analisador
 * disse. O moldador é de outra natureza: ele NÃO PODE deixar passar de 0,881,
 * e isso é uma propriedade da curva, não uma medição de sorte. É por isso que
 * ele existe; foi tuning demais até aqui. */
test('a curva do moldador não deixa passar de 1, por construção', () => {
  const c = GTMP.curvaSuave();
  const maior = Math.max(...[...c].map(Math.abs));
  assert.ok(maior < 1, 'nenhuma casa da curva chega a 1');
  assert.equal(Math.round(maior * 10000) / 10000, Math.round(GTMP.tetoMoldador() * 10000) / 10000);
  /* -1,1 dBFS: folga de verdade, não os 0,45 dB que o limitador sozinho dava. */
  assert.ok(GTMP.tetoMoldador() > 0.85 && GTMP.tetoMoldador() < 0.9);
});

/* O que impede o moldador de colorir o áudio normal. Sem isto ele seria um
 * distorcedor ligado o tempo todo — inclusive no iPhone, que monta o grafo só
 * para ter volume (item 22), em volume normal. */
test('abaixo do joelho a curva é a identidade', () => {
  const c = GTMP.curvaSuave();
  const J = GTMP.JOELHO_MOLDADOR;
  let desvio = 0;
  for (let i = 0; i < c.length; i++) {
    const x = (i / (c.length - 1)) * 2 - 1;
    if (Math.abs(x) <= J) desvio = Math.max(desvio, Math.abs(c[i] - x));
  }
  assert.ok(desvio < 1e-6, 'a amostra sai como entrou; desvio medido: ' + desvio);
});

/* Uma quina na emenda seria distorção audível bem ANTES do pico — o ponto de
 * usar tanh nesta forma é a inclinação valer exatamente 1 no joelho. */
test('a curva encosta na identidade sem quina, e só sobe', () => {
  const c = GTMP.curvaSuave();
  assert.ok(c.every((v, i) => i === 0 || v >= c[i - 1]), 'monotônica');
  assert.ok(Math.abs(c[0] + c[c.length - 1]) < 1e-6, 'simétrica em torno de zero');

  /* A inclinação na emenda não pode dar salto: comparo o passo logo antes e
   * logo depois do joelho. */
  const J = GTMP.JOELHO_MOLDADOR;
  const iJ = Math.round(((J + 1) / 2) * (c.length - 1));
  const antes = c[iJ] - c[iJ - 1];
  const depois = c[iJ + 1] - c[iJ];
  assert.ok(Math.abs(depois - antes) < antes * 0.05,
    'a inclinação muda menos de 5% na emenda');
});

test('o moldador fica FORA em volume normal', () => {
  assert.equal(GTMP.precisaMoldador({ ganho: 1 }), false);
  assert.equal(GTMP.precisaMoldador({ ganho: 0.4 }), false);
  assert.equal(GTMP.precisaMoldador({ ganho: 1.5 }), true);
  assert.equal(GTMP.precisaMoldador(), false, 'entrada torta não liga o nó');
});

/* `curve = null` é o desligamento de verdade do WaveShaperNode: a amostra
 * passa adiante intocada. Trocar por uma curva-identidade seria pior — 2048
 * arredondamentos de float32 em cima de todo o áudio, de graça. */
test('em volume normal o moldador é desligado, não neutralizado', () => {
  assert.match(PLAYER_CODIGO, /som\.molde\.curve = GTMP\.precisaMoldador/);
  assert.match(PLAYER_CODIGO, /:\s*null;/);
});

/* ------------------- a forma do grafo, lida no código-fonte -------------- */

/* A ORDEM é o que faz o compressor virar o limitador do Boost. Invertida —
 * compressor antes do ganho — o reforço multiplicaria a saída do compressor e
 * clipparia, e o item 12 entregaria distorção em vez de volume. */
test('a ordem do grafo: ganho, nivelador, limitador, saída', () => {
  const i = PLAYER_CODIGO.indexOf('som.fonte.connect(som.ganho)');
  const j = PLAYER_CODIGO.indexOf('som.ganho.connect(som.nivel)');
  const k = PLAYER_CODIGO.indexOf('som.nivel.connect(som.limite)');
  const l = PLAYER_CODIGO.indexOf('som.limite.connect(som.molde)');
  const m = PLAYER_CODIGO.indexOf('som.molde.connect(som.ctx.destination)');
  assert.ok(i >= 0 && j > i && k > j && l > k && m > l,
    'ganho → nivelador → limitador → moldador → saída, e o moldador é o último');
});

/* `createMediaElementSource` é o passo sem volta. Se um `createGain()` fosse
 * lançar, tem que lançar com o vídeo ainda ligado na saída normal do
 * navegador — depois da captura, um erro deixaria o vídeo mudo. */
test('nada que possa lançar vem depois da captura do elemento', () => {
  const i = PLAYER_CODIGO.indexOf('som.ctx.createGain()');
  const j = PLAYER_CODIGO.indexOf('som.limite = som.ctx.createDynamicsCompressor()');
  const k = PLAYER_CODIGO.indexOf('createMediaElementSource');
  assert.ok(i >= 0 && j > i && k > j, 'os três nós são criados antes da fonte');
});

/* Mesmo motivo do `hls.destroy()`: o navegador limita quantos AudioContext uma
 * página pode ter — a ordem de meia dúzia —, e um por ficha visitada esgota a
 * conta em seis idas e voltas entre a grade e a ficha. */
test('o AudioContext é fechado ao sair da ficha', () => {
  const destruir = PLAYER_CODIGO.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(destruir, 'destruir() encontrada');
  assert.match(destruir[1], /som\.ctx\.close\(\)/);
  assert.match(destruir[1], /ultimoSom\s*=\s*null/, 'a referência de módulo também sai');
});

/* O AudioContext exige um gesto para ligar. Montar no carregamento produziria
 * um contexto suspenso com o áudio JÁ capturado — ou seja, um vídeo mudo até
 * alguém tocar em alguma coisa. */
test('o grafo só é montado a partir de um gesto', () => {
  /* Todas as chamadas de montarGrafo() saem de um caminho de gesto:
   * somDaPreferencia (o primeiro play), definirVolume (tecla, arrasto) e
   * definirEstavel (clique na caixinha). Nenhuma no corpo de criarPlayer.
   *
   * Eram 4 até 04/09. A quarta era a do iPhone — o elemento recusava a escrita
   * e o grafo entrava no lugar dele (item 22) —, e ela saiu quando a medida no
   * aparelho mostrou que ali o grafo não entrega nada. */
  const chamadas = (PLAYER_CODIGO.match(/montarGrafo\(\)/g) || []).length;
  assert.equal(chamadas, 4, 'declaração + 3 chamadas, todas dentro de gesto');
  /* somDaPreferencia é chamada de dentro do play, e não solta no corpo. */
  const play = PLAYER_CODIGO.match(/function alternarPlay\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(play[1], /somDaPreferencia\(\)/);
});

/* ---------- o iPhone não tem controle de volume nosso (04/09) ------------ */

/* MEDIDO NUM IPHONE 11, e é o que derrubou a premissa do item 22. Com o grafo
 * montado, mexer no volume e ligar o Volume Estável não mudam nada que se
 * ouça; `GTMPlayer.medir()` devolveu `estado: 'suspended'` e pico 0. Um grafo
 * parado não processa — e, com o elemento já capturado, um grafo parado é um
 * vídeo MUDO, sem aviso e sem volta.
 *
 * Então lá o volume é o do aparelho, e o painel diz isso. */
test('o elemento que recusa o volume fecha o grafo, em vez de montá-lo', () => {
  const probe = PLAYER_CODIGO.match(
    /function elementoAceitaVolume\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(probe, 'não achei o probe do volume em player.js');

  /* A pergunta tem que ser INAUDÍVEL: escreve uma diferença de 1%, confere se
   * pegou e devolve o valor que estava. Um probe que esquece de devolver muda
   * o volume de quem abriu a ficha. */
  assert.match(probe[1], /var antes = video\.volume/);
  assert.match(probe[1], /video\.volume = antes/, 'o probe tem que devolver o volume');
  assert.match(probe[1], /catch/, 'escrever pode lançar, e lançar também é "não obedece"');

  /* E a recusa fecha as duas portas — o elemento E o grafo. */
  const fecha = PLAYER_CODIGO.match(
    /if \(!elementoAceitaVolume\(\)\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(fecha, 'não achei o que acontece quando o elemento recusa');
  assert.match(fecha[1], /som\.obedece = false/);
  assert.match(fecha[1], /som\.possivel = false/,
    'sem isto o grafo ainda seria montado, e é ele que arrisca o vídeo mudo');
  assert.match(fecha[1], /som\.estavel = false/,
    'caixinha marcada e inerte seria mentira');
  assert.ok(!/montarGrafo/.test(fecha[1]), 'o iPhone não pode montar o grafo');
});

/* A mesma decisão no caminho de execução: o elemento que aceitava e parou de
 * aceitar não pode cair no grafo. */
test('a recusa em tempo de execução também não monta o grafo', () => {
  const definir = PLAYER_CODIGO.match(
    /function definirVolume\(pedido\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(definir, 'não achei definirVolume em player.js');
  const recusa = definir[1].match(
    /if \(Math\.round\(video\.volume \* 100\)[\s\S]*?\n        \} else \{/);
  assert.ok(recusa, 'não achei a releitura do volume');
  assert.match(recusa[0], /som\.possivel = false/);
  assert.ok(!/montarGrafo/.test(recusa[0]),
    'voltou a montar o grafo quando o elemento recusa: é o caminho do vídeo mudo no iOS');
});

/* Quem decide é o RECURSO, não o nome do navegador. O projeto inteiro é assim
 * — `matchMedia('(hover: none)')` para o painel, `MediaSource` para o HLS —, e
 * farejar `userAgent` seria a primeira exceção. */
test('nada neste player pergunta qual é o navegador', () => {
  /* Sem os comentários, pela mesma razão do teste da AccessKey: CITAR o
   * `userAgent` para dizer que não se fareja é justamente o que o comentário
   * do probe faz. Citar é permitido; usar, não. */
  for (const arquivo of ['player.js', 'player-core.js', 'app.js', 'catalogo-core.js']) {
    const codigo = semComentarios(lerTexto(path.join(SITE, arquivo)));
    assert.ok(!/userAgent|navigator\.platform|navigator\.vendor/.test(codigo),
      arquivo + ' fareja o navegador em vez de perguntar pelo recurso');
  }
});

/* O CONTEXTO QUE SUSPENDE E NÃO VOLTA (04/09) — achado medindo o iPhone, e o
 * conserto vale para Android e desktop, que são onde o grafo continua
 * existindo. Com o elemento já capturado, contexto suspenso é vídeo MUDO, sem
 * aviso e sem volta: até aqui o `resume()` só era chamado ao montar o grafo e
 * uma vez, 500 ms depois, no vigia. */
test('todo sinal de vida acorda o som, não só os 500 ms do vigia', () => {
  const acordar = PLAYER_CODIGO.match(
    /function acordarControles\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(acordar, 'não achei acordarControles em player.js');
  assert.match(acordar[1], /acordarSom\(\)/,
    'sem isto o contexto suspenso nunca mais volta, e o vídeo fica mudo');

  /* Pendurar AQUI é pendurar nos seis lugares de uma vez — é esta função que
   * já é chamada por tecla, ponteiro, play, pause e foco. */
  const chamadas = (PLAYER_CODIGO.match(/acordarControles\(\)/g) || []).length;
  assert.ok(chamadas >= 6, 'acordarControles deixou de ser o gancho de todo sinal de vida');
});

/* A aba que volta é justamente quando o contexto está suspenso. Voltar não é
 * um gesto, então o `resume()` pode não pegar — por isso o vigia é rearmado
 * junto: ele tenta de novo e, se não conseguir, põe o recado no painel em vez
 * de deixar o vídeo mudo em silêncio. */
test('a aba que volta tenta acordar o som e rearma o vigia', () => {
  assert.match(PLAYER_CODIGO,
    /document\.addEventListener\('visibilitychange', aoVoltarVisivel\)/);
  const voltar = PLAYER_CODIGO.match(
    /function aoVoltarVisivel\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(voltar, 'não achei aoVoltarVisivel em player.js');
  assert.match(voltar[1], /acordarSom\(\)/);
  assert.match(voltar[1], /vigiarContexto\(\)/,
    'sem rearmar o vigia, um resume que falha fica sem recado');
  assert.match(voltar[1], /!som\.ativo\) return/, 'sem grafo não há nada para acordar');

  /* E ele sai em destruir(), como os outros dois ouvintes de document: um por
   * ficha visitada se acumularia. */
  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(destruir[1],
    /removeEventListener\('visibilitychange', aoVoltarVisivel\)/);
});

/* E o painel diz a verdade quando não sobrou caminho: é a única coisa que
 * separa "não dá para mexer aqui" de "o site está quebrado". */
test('sem caminho para o volume, o painel manda usar os botões do aparelho', () => {
  const sincronizar = PLAYER_CODIGO.match(
    /function sincronizarSom\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(sincronizar, 'não achei sincronizarSom em player.js');
  assert.match(sincronizar[1], /var semSaida = !som\.obedece && !som\.ativo && !som\.possivel/);
  assert.match(sincronizar[1], /faixaVol\.disabled = semSaida/);
  assert.match(sincronizar[1], /caixaEstavel\.disabled = !som\.ativo && !som\.possivel/);
  assert.match(sincronizar[1], /dizerNoPainel\('Use os botões do aparelho\.'\)/);
});

/* Medir o som no aparelho não pode ser um jeito de silenciá-lo: `disconnect()`
 * sem argumento faria o compressor largar TAMBÉM a saída. */
test('a torneira de medição solta só o que ligou', () => {
  assert.match(PLAYER_CODIGO, /s\.molde\.disconnect\(an\)/);
  assert.doesNotMatch(PLAYER_CODIGO, /molde\.disconnect\(\)/);
});

/* O listener é global no `document` — ninguém deveria precisar clicar no vídeo
 * antes de o teclado funcionar. E por ser global, TEM que sair: a ficha é
 * destruída a cada troca de rota, e um listener por ficha visitada se
 * acumularia, todos mexendo em <video> que já saíram do DOM. */
test('o teclado é global e sai junto com a ficha', () => {
  assert.match(PLAYER_CODIGO, /document\.addEventListener\('keydown', aoTeclar\)/);
  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(destruir[1], /removeEventListener\('keydown', aoTeclar\)/,
    'o listener de teclado fica vivo depois de sair da ficha');
  assert.match(destruir[1], /classList\.remove\('gtm-teatro'\)/,
    'sair da ficha em modo teatro deixaria a grade estreita');
});

/* `preventDefault` cancela a rolagem da página no espaço, nas setas, no Home e
 * no End. Chamá-lo ANTES de saber se a tecla é nossa quebraria o Tab, o F5 e a
 * navegação por teclado do site inteiro. */
test('preventDefault só depois de a tecla ser reconhecida como nossa', () => {
  const corpo = PLAYER_JS.match(/function aoTeclar\(ev\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(corpo, 'não achei aoTeclar em player.js');
  const semComent = semComentarios(corpo[1]);
  const posSaida = semComent.indexOf('if (!acao) return');
  const posPrevent = semComent.indexOf('ev.preventDefault()');
  assert.ok(posSaida >= 0 && posPrevent > posSaida,
    'preventDefault precisa vir depois do "if (!acao) return"');
});

/* O teclado não pode ser um segundo lugar de onde o vídeo começa sozinho: ele
 * passa pelo mesmo alternarPlay do botão, que é o único dono do play(). */
test('o teclado usa o mesmo caminho de play do botão', () => {
  assert.match(PLAYER_CODIGO, /case 'alternarPlay':\s*\n\s*alternarPlay\(\);/);
  const chamadas = PLAYER_CODIGO.match(/\.play\s*\(/g) || [];
  assert.equal(chamadas.length, 1, 'a fase 1 abriu um segundo caminho para o play()');
});

/* ================= legenda do player — fase 2 ===========================
 *
 * As duas armadilhas destes arquivos já tinham derrubado o lado do Node em
 * 31/08 (scripts/lib/legenda.mjs). Aqui elas são cobradas de novo, no parser
 * do navegador, porque armadilha sem teste volta.
 */

/* Amostra fiel ao que a pull zone entrega: BOM, WEBVTT, cues numeradas,
 * `HH:MM:SS.mmm`, e o padrão ROLANTE — cue de 10 ms repetindo a linha
 * anterior, depois cue longa com duas linhas. Medido em 01/09 no
 * Paraquedismo (836 cues, 418 delas com menos de 50 ms). */
const VTT_ROLANTE = '﻿WEBVTT\n\n' +
  '1\n00:00:14.990 --> 00:00:15.000\nEsse aí sou eu e dá para notar que eu me\n\n' +
  '2\n00:00:15.000 --> 00:00:17.390\nEsse aí sou eu e dá para notar que eu me\nenvolvi numa aventura das grandes. Mas\n\n' +
  '3\n00:00:17.390 --> 00:00:17.400\nenvolvi numa aventura das grandes. Mas\n';

test('ARMADILHA 1 — o BOM não pode matar o arquivo inteiro', () => {
  /* Os bytes são EF BB BF antes do "WEBVTT". Em texto isso é U+FEFF, e um
   * `startsWith('WEBVTT')` ingênuo devolve false: o parser desiste na
   * primeira linha e o título fica sem legenda nenhuma, sem erro visível. */
  assert.equal(VTT_ROLANTE.charCodeAt(0), 0xFEFF, 'a amostra tem que ter BOM');
  const cues = GTMP.analisarVtt(VTT_ROLANTE);
  assert.equal(cues.length, 3, 'o BOM derrubou o parser');
  assert.equal(cues[0].texto, 'Esse aí sou eu e dá para notar que eu me');
});

/* O PARSER é fiel ao arquivo: entrega a legenda rolante como ela está,
 * inclusive as cues-ponte de 10 ms. Quem converte é `desenrolarLegenda`, num
 * passo separado — assim dá para ver no player.js que a conversão acontece. */
test('ARMADILHA 2 — o parser entrega a legenda rolante como ela é', () => {
  const cues = GTMP.analisarVtt(VTT_ROLANTE);
  assert.equal(cues[1].texto, 'Esse aí sou eu e dá para notar que eu me\nenvolvi numa aventura das grandes. Mas',
    'as duas linhas da cue rolante têm que chegar inteiras, com a quebra');
  assert.equal(+(cues[2].fim - cues[2].inicio).toFixed(3), 0.010, 'a cue-ponte de 10 ms');
});

/* ---- de rolante para pop-on ----
 *
 * Exibida como vem, a legenda rolante ROLA: a linha de baixo sobe para o lugar
 * da de cima e uma nova entra embaixo. É a convenção de transmissão AO VIVO,
 * onde não se sabe o que vem depois. Em vídeo gravado ela confunde, porque
 * metade do que está na tela já foi lida — e o padrão é POP-ON: o bloco
 * aparece inteiro e é SUBSTITUÍDO pelo próximo. */
test('a legenda rolante vira pop-on sem perder texto nem atrasar a fala', () => {
  const blocos = GTMP.desenrolarLegenda(GTMP.analisarVtt(VTT_ROLANTE));

  /* As 3 cues da amostra só carregam DUAS linhas de texto — a terceira é pura
   * repetição. Viram um bloco só, com as duas linhas, em vez de três telas
   * onde a de baixo sobe empurrando a de cima. */
  assert.equal(blocos.length, 1);
  assert.equal(blocos[0].texto,
    'Esse aí sou eu e dá para notar que eu me\nenvolvi numa aventura das grandes. Mas');

  /* Herda o começo da cue-ponte de 10 ms: sem essa fusão a primeira linha do
   * vídeo teria 10 ms de tela e ninguém a leria. */
  assert.equal(blocos[0].inicio, 14.99, 'o bloco tem que herdar o início da ponte');
  /* E herda o fim da cue que virou repetição pura, em vez de piscar. */
  assert.equal(blocos[0].fim, 17.4);
});

test('nenhuma linha do arquivo se perde na conversão', () => {
  /* Três pares ponte+cue, no formato exato do Paraquedismo. */
  const vtt = 'WEBVTT\n\n' +
    '1\n00:00:14.990 --> 00:00:15.000\nA\n\n' +
    '2\n00:00:15.000 --> 00:00:17.390\nA\nB\n\n' +
    '3\n00:00:17.390 --> 00:00:17.400\nB\n\n' +
    '4\n00:00:17.400 --> 00:00:19.189\nB\nC\n\n' +
    '5\n00:00:19.189 --> 00:00:19.199\nC\n\n' +
    '6\n00:00:19.199 --> 00:00:21.390\nC\nD\n';
  const blocos = GTMP.desenrolarLegenda(GTMP.analisarVtt(vtt));
  const tudo = blocos.map(b => b.texto).join('\n').split('\n');
  assert.deepEqual(tudo, ['A', 'B', 'C', 'D'], 'sumiu ou repetiu linha na conversão');

  /* Nenhuma linha pode aparecer antes de ser falada. A única antecipação é a
   * ponte de 10 ms que foi absorvida — C entra em 17,390 em vez de 17,400.
   * Dez milissegundos é menos de um quadro; é o preço de não perder a ponte,
   * e o ganho é a primeira linha do vídeo não ficar com 10 ms de tela. */
  const blocoDoC = blocos.find(b => b.texto.indexOf('C') >= 0);
  assert.equal(blocoDoC.inicio, 17.39, 'C apareceu fora da hora');
  assert.ok(blocoDoC.inicio >= 17.39 - 0.001, 'C não pode adiantar mais que a ponte');

  /* Cada bloco começa quando o anterior acaba: sem buracos, sem piscada. */
  for (let i = 1; i < blocos.length; i++) {
    assert.equal(blocos[i].inicio, blocos[i - 1].fim, 'buraco entre os blocos ' + i);
  }
});

/* Metade do acervo tem legenda NORMAL. A conversão não pode encostar nela. */
test('legenda normal atravessa a conversão intacta', () => {
  const vtt = 'WEBVTT\n\n' +
    '1\n00:00:01.000 --> 00:00:03.000\nprimeira frase\n\n' +
    '2\n00:00:03.500 --> 00:00:06.000\nsegunda frase\n\n' +
    '3\n00:00:06.500 --> 00:00:09.000\nterceira frase\n';
  const cues = GTMP.analisarVtt(vtt);
  assert.deepEqual(GTMP.desenrolarLegenda(cues), cues,
    'a conversão mexeu numa legenda que não é rolante');
});

test('a conversão aguenta entrada torta e casos de borda', () => {
  assert.deepEqual(GTMP.desenrolarLegenda([]), []);
  assert.deepEqual(GTMP.desenrolarLegenda(null), []);
  assert.deepEqual(GTMP.desenrolarLegenda(undefined), []);

  const uma = GTMP.analisarVtt('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\núnica\n');
  assert.deepEqual(GTMP.desenrolarLegenda(uma), uma, 'uma cue só não tem o que fundir');

  /* Cue curta que repete a seguinte mas NÃO encosta nela: não é ponte, e
   * fundir seria inventar tempo que o arquivo não tem. */
  const solta = GTMP.analisarVtt('WEBVTT\n\n' +
    '1\n00:00:01.000 --> 00:00:01.010\nX\n\n' +
    '2\n00:00:09.000 --> 00:00:11.000\nX\nY\n');
  const b = GTMP.desenrolarLegenda(solta);
  assert.equal(b.length, 2, 'cue distante não pode ser fundida');
  assert.equal(b[0].inicio, 1);
  assert.equal(b[1].inicio, 9);
  assert.equal(b[1].texto, 'Y');
});

test('o player converte a legenda antes de montar as cues', () => {
  assert.match(PLAYER_CODIGO, /GTMP\.desenrolarLegenda\(GTMP\.analisarVtt\(/,
    'sem a conversão a legenda rolante volta a empurrar linha para cima');
});

/* Ligar a legenda a cada vídeo é o atrito que faz alguém desistir dela. */
test('a preferência de legenda é lembrada entre vídeos', () => {
  assert.match(PLAYER_CODIGO, /function lerPreferenciaLegenda\(\)/);
  assert.match(PLAYER_CODIGO, /function gravarPreferenciaLegenda\(/);
  const alternar = PLAYER_JS.match(/function alternarLegenda\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(alternar[1], /gravarPreferenciaLegenda\(/, 'ligar/desligar tem que ser gravado');
  const corpo = PLAYER_JS.match(/function ajustarCorpoLegenda\(passo\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(corpo[1], /gravarPreferenciaLegenda\(/, 'o corpo da letra também');
  assert.match(PLAYER_CODIGO, /if \(pref && pref\.ligada\) ligarLegendaBaixando\(true\)/,
    'a preferência guardada tem que ligar a legenda sozinha ao abrir a ficha');
});

/* Uma escala gravada por outra versão do site não pode virar legenda de 400 px
 * na tela de ninguém. */
test('a escala guardada só vale se estiver na lista de degraus de hoje', () => {
  const ler = PLAYER_JS.match(/function lerPreferenciaLegenda\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(ler, 'não achei lerPreferenciaLegenda');
  assert.match(ler[1], /TAMANHOS_LEGENDA\.indexOf\(/,
    'a escala vinda do armazenamento precisa ser conferida contra a lista');
});

test('os tempos do VTT viram segundos, com e sem a hora', () => {
  assert.equal(GTMP.tempoVtt('00:01:58.606'), 118.606);
  assert.equal(GTMP.tempoVtt('01:02:03.000'), 3723);
  assert.equal(GTMP.tempoVtt('01:58.606'), 118.606, 'VTT permite omitir a hora');
  assert.equal(GTMP.tempoVtt('00:00:01,500'), 1.5, 'vírgula decimal (estilo SRT)');
  /* ".6" é 600 ms, não 6 ms: o campo dos milissegundos preenche à direita. */
  assert.equal(GTMP.tempoVtt('00:00:01.6'), 1.6);
  assert.equal(GTMP.tempoVtt('bobagem'), null);
  assert.equal(GTMP.tempoVtt(''), null);
});

test('o parser descarta o que não presta sem derrubar o resto', () => {
  const vtt = 'WEBVTT\n\n' +
    'NOTE isto é um comentário e não é cue\n\n' +
    'STYLE\n::cue { color: red }\n\n' +
    '1\n00:00:01.000 --> 00:00:03.000 align:start position:10%\nCom ajustes na linha do tempo\n\n' +
    '2\n00:00:05.000 --> 00:00:05.000\nDuração zero, nunca apareceria\n\n' +
    '3\nhorário quebrado --> nada\nTempo ilegível\n\n' +
    '4\n00:00:07.000 --> 00:00:09.000\n\n\n' +
    '5\n00:00:11.000 --> 00:00:13.000\n<v Locutor>Com tag &amp; entidade</v>\n';
  const cues = GTMP.analisarVtt(vtt);
  assert.equal(cues.length, 2, 'sobraram: a com ajustes e a com tag');
  assert.equal(cues[0].texto, 'Com ajustes na linha do tempo');
  assert.equal(cues[0].fim, 3, 'os ajustes depois do tempo não podem virar parte dele');
  assert.equal(cues[1].texto, 'Com tag & entidade');
});

test('o parser aguenta entrada torta sem lançar', () => {
  assert.deepEqual(GTMP.analisarVtt(''), []);
  assert.deepEqual(GTMP.analisarVtt(null), []);
  assert.deepEqual(GTMP.analisarVtt(undefined), []);
  assert.deepEqual(GTMP.analisarVtt('isto não é um VTT'), [], 'sem cabeçalho WEBVTT, nada');
  assert.deepEqual(GTMP.analisarVtt('WEBVTT'), []);
  assert.deepEqual(GTMP.analisarVtt(123), []);
});

test('o parser aceita fim de linha do Windows e ordena as cues', () => {
  const vtt = 'WEBVTT\r\n\r\n1\r\n00:00:09.000 --> 00:00:11.000\r\nsegunda\r\n\r\n' +
    '2\r\n00:00:01.000 --> 00:00:03.000\r\nprimeira\r\n';
  const cues = GTMP.analisarVtt(vtt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].texto, 'primeira', 'as cues têm que sair em ordem de tempo');
  assert.ok(!/\r/.test(cues[0].texto), 'sobrou \\r no texto');
});

test('cueEm acha a legenda que está no ar', () => {
  const cues = GTMP.analisarVtt(VTT_ROLANTE);
  assert.equal(GTMP.cueEm(cues, 14.995), 0);
  assert.equal(GTMP.cueEm(cues, 16), 1);
  assert.equal(GTMP.cueEm(cues, 17.395), 2);
  assert.equal(GTMP.cueEm(cues, 5), -1, 'antes da primeira cue não há legenda');
  assert.equal(GTMP.cueEm(cues, 999), -1, 'depois da última também não');
  assert.equal(GTMP.cueEm(cues, NaN), -1);
  assert.equal(GTMP.cueEm([], 10), -1);
  /* Com sobreposição, ganha a última que começou: em legenda rolante é a mais
   * recente que interessa, e texto dobrado na tela é ilegível. */
  const sobrepostas = [
    { inicio: 0, fim: 10, texto: 'a' },
    { inicio: 5, fim: 10, texto: 'b' }
  ];
  assert.equal(GTMP.cueEm(sobrepostas, 7), 1);
});

test('o corpo da legenda anda pelos degraus e para nas pontas', () => {
  assert.equal(GTMP.proximoTamanhoLegenda(1, 1), 1.25);
  assert.equal(GTMP.proximoTamanhoLegenda(1, -1), 0.875);
  assert.equal(GTMP.proximoTamanhoLegenda(2, 1), 2, 'não passa do maior');
  assert.equal(GTMP.proximoTamanhoLegenda(0.75, -1), 0.75, 'não desce do menor');
});

test('a legenda sai da pull zone, e só de fonte do Bunny', () => {
  const config = { pullzone: 'vz-teste.b-cdn.net' };
  assert.equal(GTMP.urlLegenda(fonte, config),
    'https://vz-teste.b-cdn.net/' + fonte.videoId + '/captions/pt.vtt');
  assert.equal(GTMP.urlLegenda(fonte, {}), null);
  assert.equal(GTMP.urlLegenda(null, config), null);
  assert.equal(GTMP.urlLegenda({ tipo: 'vimeo', videoId: 'x' }, config), null);
});

/* A ARMADILHA QUE OBRIGOU O PARSER A EXISTIR: a pull zone serve o .vtt com
 * `Content-Type: application/octet-stream` (medido em 01/09). O navegador
 * exige `text/vtt` e recusa o arquivo EM SILÊNCIO — o <track> fica no DOM sem
 * cue nenhuma e sem erro no console. Se alguém "simplificar" isto para um
 * <track>, a legenda some sem ninguém perceber. */
test('a legenda não usa <track> — a pull zone serve o .vtt com o tipo errado', () => {
  assert.ok(!/createElement\(\s*['"]track['"]/.test(PLAYER_CODIGO),
    'player.js cria um <track>; a pull zone serve o .vtt como octet-stream e ele será recusado');
  assert.match(PLAYER_CODIGO, /GTMP\.analisarVtt\(/, 'o VTT tem que passar pelo nosso parser');
  assert.match(PLAYER_CODIGO, /addTextTrack\(/,
    'a régua de tempo é a do navegador: TextTrack em mode hidden');
  assert.match(PLAYER_CODIGO, /faixa\.mode\s*=\s*'hidden'/,
    "mode 'showing' faria o navegador desenhar por cima da nossa camada");
});

/* Mesma disciplina do vídeo: abrir a ficha para ler a sinopse não pode baixar
 * 73 KB de legenda que ninguém pediu. */
test('a legenda só é buscada quando a legenda está ligada', () => {
  const alternar = PLAYER_JS.match(/function alternarLegenda\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(alternar, 'não achei alternarLegenda em player.js');
  assert.match(alternar[1], /ligarLegendaBaixando\(/);

  const baixando = PLAYER_JS.match(/function ligarLegendaBaixando\(calada\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(baixando, 'não achei ligarLegendaBaixando em player.js');
  assert.match(baixando[1], /carregarLegenda\(\)/);

  /* O fetch não pode estar solto no corpo de criarPlayer: ele rodaria em toda
   * ficha aberta, inclusive na de quem só queria ler a sinopse. Os dois únicos
   * gatilhos são a tecla/botão e a preferência guardada. */
  const antesDosControles = PLAYER_CODIGO.split('function carregarLegenda')[0];
  assert.ok(!/fetch\(/.test(antesDosControles),
    'há um fetch de legenda fora de carregarLegenda');
  const gatilhos = PLAYER_CODIGO.match(/ligarLegendaBaixando\((?!calada)/g) || [];
  assert.equal(gatilhos.length, 2,
    'só dois gatilhos são previstos: a tecla/botão e a preferência guardada');
});

/* 404 em captions/pt.vtt é caso REAL e esperado, não erro: o institucional
 * não tem legenda nenhuma (o áudio é só trilha), e ele está entre os 66 no ar. */
test('título sem legenda desliga o botão em vez de quebrar', () => {
  const corpo = PLAYER_JS.match(/function ligarLegendaBaixando\(calada\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(corpo, 'não achei ligarLegendaBaixando em player.js');
  assert.match(corpo[1], /\.catch\(/, 'o 404 tem que ser tratado');
  assert.match(corpo[1], /bCC\.disabled = true/, 'o botão tem que sair de circulação');
  assert.match(corpo[1], /indisponivel = true/);
  /* Aberto pela preferência guardada, um título sem legenda não pode xingar
   * quem só abriu a ficha: o aviso é só quando alguém apertou C. */
  assert.match(corpo[1], /if \(!calada\) mostrarSelo\('Este título não tem legenda'\)/);
});

test('a faixa de legenda é desmontada ao sair da ficha', () => {
  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(destruir[1], /removeEventListener\('cuechange', pintarLegenda\)/);
});

test('C liga a legenda; + e - mudam o corpo, com ou sem Shift', () => {
  assert.deepEqual(tecla('c'), { acao: 'alternarLegenda' });
  assert.deepEqual(tecla('C'), { acao: 'alternarLegenda' });
  /* Em teclado US e ABNT2, `+` É Shift+`=`. Se a checagem viesse depois do
   * ramo de Shift, a tecla mais óbvia da fase não funcionaria. */
  assert.deepEqual(tecla('+', { shiftKey: true }), { acao: 'corpoLegenda', passo: 1 });
  assert.deepEqual(tecla('+'), { acao: 'corpoLegenda', passo: 1 }, 'o + do teclado numérico');
  assert.deepEqual(tecla('='), { acao: 'corpoLegenda', passo: 1 });
  assert.deepEqual(tecla('-'), { acao: 'corpoLegenda', passo: -1 });
  assert.deepEqual(tecla('_', { shiftKey: true }), { acao: 'corpoLegenda', passo: -1 });
  /* Continua valendo a trava geral. */
  assert.equal(tecla('c', { digitando: true }), null);
  assert.equal(tecla('+', { digitando: true, shiftKey: true }), null);
  assert.equal(tecla('c', { ctrlKey: true }), null);
});


/* ================= capítulos no player — fase 3 =========================
 *
 * Os 238 capítulos já tinham teste desde 31/08 — do lado do CATÁLOGO
 * (`GTM.capitulos`, `GTM.capituloEm`) e do lado do SCRIPT que grava no Bunny
 * (`fecharCapitulos`). O que a fase 3 acrescenta é o lado do PLAYER: os
 * segmentos desenhados na linha do tempo, a dica sob o ponteiro e o Ctrl+seta.
 *
 * Com o embed, essas três coisas vinham prontas de dentro do iframe. Trocado o
 * player, elas passam a ser código nosso — e é isso que estes testes cobram.
 */

const capsTeste = [
  { inicio: 0, titulo: 'Abertura' },
  { inicio: 100, titulo: 'O treinador' },
  { inicio: 250, titulo: 'A torcida' }
];

/* A barra é sempre feita de segmentos. Um título sem capítulos — 27 dos 66 no
 * ar — tem que continuar com a barra de antes da fase 3, e a forma de garantir
 * isso é o segmento único cobrindo 100%. */
test('sem capítulos, a barra é um segmento só — a mesma barra de sempre', () => {
  const segs = GTMP.segmentosCapitulos([], 600);
  assert.equal(segs.length, 1);
  assert.deepEqual(
    { esquerda: segs[0].esquerda, largura: segs[0].largura, titulo: segs[0].titulo },
    { esquerda: 0, largura: 100, titulo: null });

  assert.deepEqual(GTMP.segmentosCapitulos(null, 600), segs);
  assert.deepEqual(GTMP.segmentosCapitulos(undefined, 600), segs);
});

/* Sem duração não dá para saber ONDE cortar — e a resposta certa é a barra
 * inteira, não a barra vazia. Some o corte, nunca a barra. É caso real: um
 * item sem `duracao_seg` no catálogo, antes do `loadedmetadata`, com
 * `preload: none` segurando a rede. */
test('sem duração conhecida, a barra continua inteira em vez de sumir', () => {
  for (const d of [NaN, 0, -1, undefined, 'x', Infinity]) {
    const segs = GTMP.segmentosCapitulos(capsTeste, d);
    assert.equal(segs.length, 1, 'duração ' + d + ' deveria dar a barra inteira');
    assert.equal(segs[0].largura, 100);
  }
});

test('cada capítulo fecha onde o seguinte começa; o último, na duração', () => {
  const segs = GTMP.segmentosCapitulos(capsTeste, 500);
  assert.deepEqual(segs.map((s) => [s.inicio, s.fim]), [[0, 100], [100, 250], [250, 500]]);
  assert.deepEqual(segs.map((s) => s.titulo), ['Abertura', 'O treinador', 'A torcida']);
  assert.deepEqual(segs.map((s) => s.indice), [0, 1, 2]);

  /* Em porcentagem, que é o que o player.js escreve como estilo sem fazer
   * conta nenhuma. E a soma fecha em 100: a linha do tempo é contígua por
   * construção, como do lado do Node. */
  assert.deepEqual(segs.map((s) => s.esquerda), [0, 20, 50]);
  assert.deepEqual(segs.map((s) => s.largura), [20, 30, 50]);
  assert.equal(segs.reduce((soma, s) => soma + s.largura, 0), 100);
});

/* A Jornada só tem fala a partir de 1:58 e o primeiro capítulo dela começa
 * lá. Sem um segmento para o trecho anterior, a barra abriria com um buraco
 * bem onde todo mundo olha primeiro. */
test('o trecho antes do primeiro capítulo vira um segmento sem título', () => {
  const segs = GTMP.segmentosCapitulos([{ inicio: 118, titulo: 'A fala' }], 600);
  assert.equal(segs.length, 2);
  assert.deepEqual(
    { inicio: segs[0].inicio, fim: segs[0].fim, titulo: segs[0].titulo, indice: segs[0].indice },
    { inicio: 0, fim: 118, titulo: null, indice: -1 },
    'o trecho mudo é um segmento de verdade, só que sem nome');
  assert.equal(segs[1].titulo, 'A fala');
  assert.equal(segs[1].indice, 0, 'o índice do capítulo é o da lista do catálogo, não o do desenho');
  assert.equal(segs[0].largura + segs[1].largura, 100);
});

/* Do lado do Node, capítulo depois do fim do vídeo é ERRO e o script se
 * recusa a gravar (há teste desde 31/08). Aqui é o contrário e de propósito:
 * a ficha tem que abrir com o vídeo mesmo com o catálogo torto. */
test('a barra sobrevive a capítulo torto, como a ficha já sobrevivia', () => {
  const tortos = [
    { inicio: 0, titulo: 'Abertura' },
    { inicio: 100, titulo: 'Vale' },
    { inicio: 900, titulo: 'Depois do fim' }
  ];
  const segs = GTMP.segmentosCapitulos(tortos, 500);
  assert.deepEqual(segs.map((s) => s.titulo), ['Abertura', 'Vale']);
  assert.equal(segs[segs.length - 1].fim, 500, 'o último desenhável fecha na duração');
  assert.equal(segs.reduce((soma, s) => soma + s.largura, 0), 100);

  /* Descartar só do FIM é o que mantém os índices alinhados com a lista que
   * `GTM.capitulos` devolveu — e é dela que sai o índice de `capituloEm`. */
  assert.deepEqual(segs.map((s) => s.indice), [0, 1]);

  assert.doesNotThrow(() => GTMP.segmentosCapitulos([null, {}, { inicio: 'x' }], 500));
  assert.equal(GTMP.segmentosCapitulos([{ inicio: -5, titulo: 'Negativo' }], 500).length, 1,
    'início negativo é descartado e sobra a barra inteira');
});

/* Com a barra em pedaços, o preenchimento deixa de ser uma largura só: os
 * segmentos para trás ficam cheios, o de agora pela metade, os da frente
 * vazios. */
test('cada segmento se preenche sozinho conforme o vídeo passa por ele', () => {
  const segs = GTMP.segmentosCapitulos(capsTeste, 500);
  assert.deepEqual(segs.map((s) => GTMP.fracaoNoSegmento(s, 175)), [100, 50, 0]);
  assert.deepEqual(segs.map((s) => GTMP.fracaoNoSegmento(s, 0)), [0, 0, 0]);
  assert.deepEqual(segs.map((s) => GTMP.fracaoNoSegmento(s, 500)), [100, 100, 100]);

  assert.equal(GTMP.fracaoNoSegmento(null, 10), 0);
  assert.equal(GTMP.fracaoNoSegmento({ inicio: 5, fim: 5 }, 10), 0, 'segmento de largura zero');
  assert.equal(GTMP.fracaoNoSegmento(segs[0], NaN), 0);
});

/* Não é a mesma pergunta de `GTM.capituloEm`: os segmentos incluem o trecho
 * sem título antes do primeiro capítulo, e o último vale até a duração
 * INCLUSIVE — parar o vídeo no último quadro não pode apagar o realce. */
test('o segmento sob o ponteiro inclui o trecho sem título e o último quadro', () => {
  const segs = GTMP.segmentosCapitulos([{ inicio: 100, titulo: 'Só um' }], 500);
  assert.equal(GTMP.segmentoEm(segs, 0), 0, 'o trecho antes do primeiro capítulo');
  assert.equal(GTMP.segmentoEm(segs, 99.9), 0);
  assert.equal(GTMP.segmentoEm(segs, 100), 1);
  assert.equal(GTMP.segmentoEm(segs, 500), 1, 'o fim do vídeo ainda é o último capítulo');
  assert.equal(GTMP.segmentoEm(segs, 9999), 1);
  assert.equal(GTMP.segmentoEm(segs, -1), -1);
  assert.equal(GTMP.segmentoEm(segs, NaN), -1);
  assert.equal(GTMP.segmentoEm([], 10), -1);
  assert.equal(GTMP.segmentoEm(null, 10), -1);
});

/* ---------------------------------------------------- Ctrl + seta (item 28) */

test('Ctrl + setas viram capítulo — e só Ctrl, sem os outros modificadores', () => {
  assert.deepEqual(tecla('ArrowRight', { ctrlKey: true }), { acao: 'capitulo', direcao: 1 });
  assert.deepEqual(tecla('ArrowLeft', { ctrlKey: true }), { acao: 'capitulo', direcao: -1 });

  /* Ctrl+Shift+seta é seleção por palavra e Ctrl+Alt+seta gira a tela em
   * alguns drivers de vídeo. Nenhum dos dois pode virar pulo de capítulo. */
  assert.equal(tecla('ArrowRight', { ctrlKey: true, shiftKey: true }), null);
  assert.equal(tecla('ArrowRight', { ctrlKey: true, altKey: true }), null);
  assert.equal(tecla('ArrowRight', { ctrlKey: true, metaKey: true }), null);

  /* E a trava da busca continua acima de tudo. */
  assert.equal(tecla('ArrowRight', { ctrlKey: true, digitando: true }), null);

  /* Sem Ctrl as setas continuam sendo o pulo de 5 s da fase 1. */
  assert.deepEqual(tecla('ArrowRight'), { acao: 'pular', segundos: 5 });
});

/* O `->` é o capítulo seguinte. O `<-` NÃO é o espelho: é a convenção do botão
 * "faixa anterior" de qualquer tocador — no meio da faixa, ele volta para o
 * começo DELA. Sem isso, quem perdeu o fio no meio de um capítulo de quatro
 * minutos é jogado para o capítulo anterior inteiro. */
test('a seta da esquerda recomeça o capítulo antes de ir para o anterior', () => {
  const noMeio = GTMP.alvoDeCapitulo(capsTeste, 1, 200, -1);
  assert.deepEqual(noMeio, { indice: 1, inicio: 100, titulo: 'O treinador' },
    'no meio do capítulo, o <- volta para o começo dele');

  const pertoDoInicio = GTMP.alvoDeCapitulo(capsTeste, 1, 101, -1);
  assert.deepEqual(pertoDoInicio, { indice: 0, inicio: 0, titulo: 'Abertura' },
    'perto do começo, aí sim vai para o capítulo anterior');

  /* A fronteira é declarada, não adivinhada. */
  assert.equal(GTMP.alvoDeCapitulo(capsTeste, 1, 100 + GTMP.RECOMECO_CAPITULO_S, -1).indice, 0);
  assert.equal(GTMP.alvoDeCapitulo(capsTeste, 1, 100 + GTMP.RECOMECO_CAPITULO_S + 0.1, -1).indice, 1);
});

test('a seta da direita vai para o começo do capítulo seguinte', () => {
  assert.deepEqual(GTMP.alvoDeCapitulo(capsTeste, 0, 50, 1),
    { indice: 1, inicio: 100, titulo: 'O treinador' });
  assert.deepEqual(GTMP.alvoDeCapitulo(capsTeste, 1, 249, 1),
    { indice: 2, inicio: 250, titulo: 'A torcida' });
});

/* Devolver null é o que faz o player dizer "Último capítulo" em vez de pular
 * em silêncio para lugar nenhum — o mesmo que Shift+N já fazia no fim da
 * série. */
test('nas pontas não há para onde ir, e isso é dito e não escondido', () => {
  assert.equal(GTMP.alvoDeCapitulo(capsTeste, 2, 300, 1), null, 'último capítulo');
  assert.equal(GTMP.alvoDeCapitulo(capsTeste, 0, 1, -1), null, 'começo do primeiro capítulo');
  assert.equal(GTMP.alvoDeCapitulo([], 0, 10, 1), null, 'título sem capítulos');
  assert.equal(GTMP.alvoDeCapitulo(null, 0, 10, 1), null);
});

/* O trecho antes do primeiro capítulo é caso real (a Jornada, que só tem fala
 * a partir de 1:58): de lá a seta da direita vai para o primeiro e a da
 * esquerda não tem para onde ir. */
test('antes do primeiro capítulo, o -> entra no primeiro e o <- não tem alvo', () => {
  const caps = [{ inicio: 118, titulo: 'A fala' }, { inicio: 300, titulo: 'Depois' }];
  assert.deepEqual(GTMP.alvoDeCapitulo(caps, -1, 30, 1),
    { indice: 0, inicio: 118, titulo: 'A fala' });
  assert.equal(GTMP.alvoDeCapitulo(caps, -1, 30, -1), null);
});

test('alvoDeCapitulo aguenta índice torto sem lançar', () => {
  assert.doesNotThrow(() => GTMP.alvoDeCapitulo(capsTeste, NaN, 10, 1));
  assert.deepEqual(GTMP.alvoDeCapitulo(capsTeste, NaN, 10, 1).indice, 0,
    'índice ilegível é tratado como "antes do primeiro"');
  assert.equal(GTMP.alvoDeCapitulo(capsTeste, 99, 10, 1), null, 'índice além do fim da lista');
  assert.equal(GTMP.alvoDeCapitulo(capsTeste, -7, 10, -1), null);
});

/* ------------------------------------------------------------ a dica */

/* Sem o limite, quem é cortado é o título do PRIMEIRO capítulo (pela
 * esquerda) e o do ÚLTIMO (pela direita) — os dois que mais se procuram. */
test('a dica não sai pela borda do player', () => {
  /* No meio, ela é centrada no ponteiro. */
  assert.equal(GTMP.posicaoDica(350, 700, 120, 4), 290);
  /* Nas pontas, encosta e para. */
  assert.equal(GTMP.posicaoDica(0, 700, 120, 4), 4);
  assert.equal(GTMP.posicaoDica(700, 700, 120, 4), 576);
  assert.equal(GTMP.posicaoDica(350, 700, 120, 0), 290, 'sem margem, o cálculo é o mesmo');

  /* Dica mais larga que a barra: um título comprido num celular estreito.
   * Sobra encostar na esquerda — a margem ganha do limite de cima. */
  assert.equal(GTMP.posicaoDica(150, 300, 400, 4), 4);

  assert.doesNotThrow(() => GTMP.posicaoDica(NaN, NaN, NaN, NaN));
});

/* ------------------------------------------- o que o player.js faz com isso */

/* A barra tem que ser desenhada ANTES do primeiro `pintar()`: sem os
 * segmentos montados não existe onde pintar o primeiro quadro dela. */
test('os segmentos são montados no início e refeitos quando a duração chega', () => {
  const pos = PLAYER_CODIGO.indexOf('montarSegmentos();');
  assert.ok(pos > 0, 'player.js não monta os segmentos');
  assert.ok(pos < PLAYER_CODIGO.indexOf('\n    pintar();'),
    'montarSegmentos() precisa vir antes do primeiro pintar()');

  /* Há dois `loadedmetadata` no arquivo desde a fase 6 — o do <video> e o da
   * prévia do arrasto. O que importa aqui é o do vídeo. */
  const meta = PLAYER_CODIGO.match(
    /video\.addEventListener\('loadedmetadata', function \(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(meta, 'não achei o listener de loadedmetadata do <video>');
  assert.match(meta[1], /montarSegmentos\(\)/,
    'a duração do Bunny diverge da do catálogo: os segmentos têm que ser refeitos');
});

/* A mesma leitura dos capítulos nos dois lugares. Se o player lesse o
 * `item.capitulos` cru e a lista lesse o saneado, os dois discordariam sobre
 * onde um capítulo começa — e ninguém entenderia por quê. */
test('o player e a lista leem os capítulos pela mesma função', () => {
  assert.match(PLAYER_CODIGO, /var caps = GTM\.capitulos\(item\)/);
  const app = lerTexto(path.join(SITE, 'app.js'));
  assert.match(app, /var caps = GTM\.capitulos\(item\)/);
});

/* A parte NÃO óbvia da fase: com `preload: none` e nada carregado, escrever em
 * `currentTime` não dispara evento nenhum. Se a lista ouvisse só o
 * `timeupdate` do <video>, um pulo por Ctrl+seta antes do primeiro play
 * deixaria o destaque no capítulo anterior, como se a tecla não funcionasse. */
test('a lista de capítulos ouve o player, não o <video>', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const lista = app.match(/function listaCapitulos\(item, alvo\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(lista, 'não achei listaCapitulos em app.js');
  assert.match(lista[1], /alvo\.aoTempo\(/, 'a lista precisa se inscrever no player');
  assert.ok(!/alvo\.video\.addEventListener/.test(lista[1]),
    'ouvir o <video> direto perde os pulos feitos com a mídia ainda não carregada');

  /* E o player avisa nos DOIS caminhos: no relógio andando e no pulo. */
  const irPara = PLAYER_CODIGO.match(/function irPara\(segundos\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(irPara, 'não achei irPara em player.js');
  assert.match(irPara[1], /avisarTempo\(\)/, 'um pulo tem que avisar quem acompanha');
  assert.match(PLAYER_CODIGO, /'timeupdate', function \(\) \{ pintar\(\); avisarTempo\(\); \}/);
});

/* Os inscritos são funções da FICHA. Sem soltá-los, o player continuaria
 * chamando código de uma tela que já foi destruída. */
test('os inscritos no tempo são soltos ao sair da ficha', () => {
  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(destruir[1], /ouvintesTempo\.length = 0/);
});

/* A MESMA regra de produto da lista clicável, agora pelo teclado: pular de
 * capítulo POSICIONA, nunca manda tocar. Um vídeo pausado continua pausado no
 * capítulo novo. */
test('o Ctrl+seta posiciona o vídeo — nunca manda tocar', () => {
  const fn = PLAYER_CODIGO.match(/function irParaCapitulo\(direcao\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(fn, 'não achei irParaCapitulo em player.js');
  assert.ok(!/\.play\s*\(/.test(fn[1]), 'irParaCapitulo chama play()');
  assert.match(fn[1], /irPara\(alvo\.inicio\)/);

  /* E o total do arquivo continua sendo um: a fase 3 não abriu um segundo
   * lugar de onde o vídeo pode começar sozinho. */
  const chamadas = PLAYER_CODIGO.match(/\.play\s*\(/g) || [];
  assert.equal(chamadas.length, 1, 'a fase 3 abriu um segundo caminho para o play()');
});

/* Um título sem capítulos não pode virar uma tecla morta: `preventDefault` já
 * foi chamado, então a tecla precisa dizer alguma coisa. */
test('Ctrl+seta num título sem capítulos avisa em vez de não fazer nada', () => {
  const fn = PLAYER_CODIGO.match(/function irParaCapitulo\(direcao\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(fn[1], /if \(!caps\.length\) \{ mostrarSelo\(/);
  assert.match(fn[1], /Último capítulo/);
  assert.match(fn[1], /Primeiro capítulo/);
});
/* ================= gestos do player — fase 5 =============================
 *
 * A fase que a §5 do PLANO-PLAYER.md chamou de "o maior risco escondido":
 * um player é DOM puro, e gesto é a parte mais DOM de todas. A saída
 * decidida lá — e cobrada aqui — é que a DECISÃO do gesto não é DOM. A
 * máquina recebe pontos e devolve ações; o player.js só executa.
 *
 * O que estes testes provam é a SEQUÊNCIA, que é onde moram os erros de
 * gesto: o toque duplo que também dá play, o arrasto que começa parecendo
 * toque, o segundo dedo que chega no meio. Nada disso aparece olhando um
 * evento de cada vez, e nada disso precisa de dedo nem de navegador.
 */

const QUADRO_TELEFONE = { largura: 375, altura: 211 };   /* 16:9 em 375 px */
const QUADRO_CHEIO = { largura: 812, altura: 375 };      /* o mesmo, deitado */
/* Tela cheia com o aparelho EM PÉ: a tela toda, não o 16:9. É o quadro em que
 * o deslize ↑ da fase 7 tem o que fazer — há altura sobrando para ganhar. */
const QUADRO_CHEIO_EM_PE = { largura: 375, altura: 812 };

const gestosDe = (medidas) => {
  const g = GTMP.criarGestos();
  g.medir(medidas || QUADRO_TELEFONE);
  return g;
};
const dedo = (id, x, y, t, tipo) => ({ id, x, y, t, tipo });

/* ---------------------------------------------------------- as três faixas */

test('as três faixas do quadro: 30% de cada lado, 40% de centro', () => {
  assert.equal(GTMP.ZONA_LADO, 0.3);
  assert.equal(GTMP.zonaDoToque(10, 375), 'esquerda');
  assert.equal(GTMP.zonaDoToque(112, 375), 'esquerda');
  assert.equal(GTMP.zonaDoToque(113, 375), 'centro');
  assert.equal(GTMP.zonaDoToque(187, 375), 'centro');
  assert.equal(GTMP.zonaDoToque(263, 375), 'direita');
  assert.equal(GTMP.zonaDoToque(374, 375), 'direita');
});

/* Sem medida não há como saber onde o dedo caiu. A resposta segura é o
 * centro: play/pause, o gesto que não estraga nada — e não um pulo de 5 s
 * para um lado escolhido no chute. */
test('sem medida do quadro, todo toque é do centro', () => {
  for (const L of [0, -1, NaN, undefined, 'x']) {
    assert.equal(GTMP.zonaDoToque(10, L), 'centro', 'largura ' + L);
  }
});

/* A borda é do navegador: é ali que mora o "voltar" do celular, e no iOS não
 * há como disputar. Um arrasto que começa ali não pode virar linha do tempo —
 * o gesto seria interrompido no meio, com o vídeo já deslocado. */
test('os 24 px da borda não são nossos — é onde mora o "voltar"', () => {
  assert.equal(GTMP.MARGEM_BORDA_PX, 24);
  assert.equal(GTMP.naBordaLateral(10, 375), true);
  assert.equal(GTMP.naBordaLateral(370, 375), true);
  assert.equal(GTMP.naBordaLateral(30, 375), false);
  assert.equal(GTMP.naBordaLateral(200, 375), false);

  const g = gestosDe();
  g.descer(dedo(1, 8, 100, 0));
  assert.equal(g.mover(dedo(1, 60, 100, 40)), null,
    'um arrasto que começa na borda não vira linha do tempo');
  assert.equal(g.estado().eixo, 'morto');
});

/* ------------------------------------------------- item 1 — toque duplo */

test('dois toques na esquerda voltam 5 s; na direita, avançam', () => {
  assert.equal(GTMP.PULO_TOQUE_S, 5, 'o mesmo passo das setas do teclado');

  const esq = gestosDe();
  esq.descer(dedo(1, 40, 100, 0));
  esq.subir(dedo(1, 40, 100, 60));
  assert.deepEqual(esq.descer(dedo(2, 44, 104, 200)), { acao: 'pular', segundos: -5 });

  const dir = gestosDe();
  dir.descer(dedo(1, 330, 100, 0));
  dir.subir(dedo(1, 330, 100, 60));
  assert.deepEqual(dir.descer(dedo(2, 332, 98, 200)), { acao: 'pular', segundos: 5 });
});

/* O pulo dispara no SEGUNDO toque, e o `subir` dele não pode dar play/pause
 * por cima: era exatamente isso que o `click` do <video> fazia antes desta
 * fase — dois play/pause além do pulo, e a tela piscando a cada gesto. */
test('o toque que pulou não dá play/pause de brinde', () => {
  const g = gestosDe();
  g.descer(dedo(1, 40, 100, 0));
  g.subir(dedo(1, 40, 100, 60));
  g.descer(dedo(2, 40, 100, 200));
  assert.equal(g.subir(dedo(2, 40, 100, 260)), null);
});

test('no centro, dois toques são dois play/pause — e não um pulo', () => {
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0));
  assert.deepEqual(g.subir(dedo(1, 180, 100, 60)), { acao: 'alternarPlay' });
  assert.equal(g.descer(dedo(2, 182, 102, 200)), null, 'o centro não pula');
  assert.deepEqual(g.subir(dedo(2, 182, 102, 260)), { acao: 'alternarPlay' },
    'o segundo toque desfaz o primeiro, que é o que se espera');
});

test('dois toques devagar, ou longe um do outro, são dois toques', () => {
  const devagar = gestosDe();
  devagar.descer(dedo(1, 40, 100, 0));
  devagar.subir(dedo(1, 40, 100, 60));
  assert.equal(devagar.descer(dedo(2, 40, 100, 0 + GTMP.TOQUE_DUPLO_MS + 1)), null);

  const longe = gestosDe();
  longe.descer(dedo(1, 20, 100, 0));
  longe.subir(dedo(1, 20, 100, 60));
  assert.equal(longe.descer(dedo(2, 20 + GTMP.TOQUE_DUPLO_PX + 1, 100, 150)), null);
});

/* Como no YouTube: quem quer 15 s dá três toques, não espera e recomeça. */
test('o terceiro toque continua pulando', () => {
  const g = gestosDe();
  g.descer(dedo(1, 40, 100, 0));
  g.subir(dedo(1, 40, 100, 60));
  assert.deepEqual(g.descer(dedo(2, 40, 100, 200)), { acao: 'pular', segundos: -5 });
  g.subir(dedo(2, 40, 100, 260));
  assert.deepEqual(g.descer(dedo(3, 40, 100, 400)), { acao: 'pular', segundos: -5 });
});

/* Nas laterais, um toque sozinho não faz NADA de propósito: elas são a área
 * do toque duplo. Um play/pause que dispara e é desfeito 200 ms depois pisca
 * a tela inteira a cada pulo de 5 s — e o botão de play está a 44 px dali. */
test('toque simples: play/pause só no centro', () => {
  const meio = gestosDe();
  meio.descer(dedo(1, 180, 100, 0));
  assert.deepEqual(meio.subir(dedo(1, 180, 100, 60)), { acao: 'alternarPlay' });

  const lado = gestosDe();
  assert.equal(lado.descer(dedo(1, 40, 100, 0)), null);
  assert.equal(lado.subir(dedo(1, 40, 100, 60)), null);
});

/* ------------------------------------------------------------------ mouse */

test('com o mouse, clique em qualquer lugar do quadro é play/pause', () => {
  for (const x of [40, 180, 340]) {
    const g = gestosDe();
    g.descer(dedo(1, x, 100, 0, 'mouse'));
    assert.deepEqual(g.subir(dedo(1, x, 100, 60, 'mouse')), { acao: 'alternarPlay' },
      'x = ' + x);
  }
});

test('arrastar com o mouse e soltar não é clique', () => {
  const g = gestosDe();
  g.descer(dedo(1, 100, 100, 0, 'mouse'));
  assert.equal(g.mover(dedo(1, 260, 100, 90, 'mouse')), null,
    'o mouse não arrasta o quadro — a barra está a 20 px dali');
  assert.equal(g.subir(dedo(1, 260, 100, 120, 'mouse')), null);
});

/* O toque duplo do DEDO é ±5 s; o do mouse é tela cheia (04/09, a pedido).
 * Até então o mouse não tinha duplo nenhum — o comentário do player-core dizia
 * que duplo clique não estava entre os 29 itens da matriz, o que era verdade e
 * deixou de ser razão no dia em que foi pedido. */
test('dois cliques rápidos com o mouse são tela cheia', () => {
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0, 'mouse'));
  assert.deepEqual(g.subir(dedo(1, 180, 100, 60, 'mouse')), { acao: 'alternarPlay' },
    'o primeiro clique continua dando play/pause na hora, sem esperar o segundo');
  assert.deepEqual(g.descer(dedo(2, 180, 100, 200, 'mouse')),
    { acao: 'telaCheiaNoDuploClique' });
});

/* O vídeo tem que ficar COMO ESTAVA, e quem garante isso é a AÇÃO, não um
 * segundo evento: `telaCheiaNoDuploClique` desfaz o play/pause do primeiro
 * clique e alterna a tela, tudo no `pointerdown` do segundo. O ponteiro sai
 * consumido, e o `subir` que vem depois não faz mais nada.
 *
 * ISTO JÁ FOI ERRADO E O SITE NO AR MOSTROU (04/09): antes, quem desfazia era
 * o `subir` do segundo clique — duas alternâncias, saldo zero no papel. Só que
 * entrar em tela cheia remexe a página e um `pointercancel` engole o
 * `pointerup`; sobrava UMA alternância, e a tela cheia entrava com o vídeo
 * pausado. */
test('o duplo clique não mexe no play, e não depende do pointerup para isso', () => {
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0, 'mouse'));
  assert.deepEqual(g.subir(dedo(1, 180, 100, 60, 'mouse')), { acao: 'alternarPlay' });
  assert.deepEqual(g.descer(dedo(2, 180, 100, 200, 'mouse')),
    { acao: 'telaCheiaNoDuploClique' });
  assert.equal(g.subir(dedo(2, 180, 100, 240, 'mouse')), null,
    'o segundo clique já foi consumido: alternar de novo aqui dobraria o efeito');
});

/* A prova de que o defeito não pode voltar: com o ponteiro CANCELADO entre o
 * segundo `pointerdown` e o `pointerup` — que é exatamente o que a entrada em
 * tela cheia faz —, nada se perde, porque não havia nada pendente. */
test('tela cheia que cancela o ponteiro não deixa o vídeo trocado', () => {
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0, 'mouse'));
  g.subir(dedo(1, 180, 100, 60, 'mouse'));
  assert.deepEqual(g.descer(dedo(2, 180, 100, 200, 'mouse')),
    { acao: 'telaCheiaNoDuploClique' });
  assert.equal(g.cancelar(), null, 'o cancelamento não pode ter sobra para entregar');
  assert.equal(g.subir(dedo(2, 180, 100, 260, 'mouse')), null);
});

/* E o desfazer mora no player.js, no MESMO `alternarPlay` de sempre: a REGRA 1
 * tem um dono só para o `play()`, e há teste contando as chamadas. */
test('o duplo clique desfaz o play pelo caminho de sempre, e não por um novo', () => {
  const gesto = PLAYER_CODIGO.match(/function aoGesto\(acao\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(gesto, 'não achei aoGesto em player.js');
  const caso = gesto[1].match(/case 'telaCheiaNoDuploClique':([\s\S]*?)break;/);
  assert.ok(caso, 'não achei o caso do duplo clique em aoGesto');
  assert.match(caso[1], /alternarPlay\(\)/, 'sem isto o duplo clique troca o estado do vídeo');
  assert.match(caso[1], /telaCheia\(\)/);
  assert.ok(!/\.play\s*\(/.test(caso[1]), 'o duplo clique virou um segundo caminho para o play()');
});

/* O par se fecha no segundo clique, como o `dblclick` do navegador: o terceiro
 * começa outro duplo em vez de desmaximizar sozinho. Sem isto, uma mão que
 * clica três vezes entra e sai da tela cheia no mesmo gesto. */
test('o terceiro clique seguido não desmaximiza sozinho', () => {
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0, 'mouse'));
  g.subir(dedo(1, 180, 100, 40, 'mouse'));
  g.descer(dedo(2, 180, 100, 150, 'mouse'));
  g.subir(dedo(2, 180, 100, 190, 'mouse'));
  assert.equal(g.descer(dedo(3, 180, 100, 300, 'mouse')), null);
});

/* A janela é a MESMA do dedo, e não foi alargada para o ponteiro de propósito:
 * com o mesmo clique dando play/pause, uma janela larga transformaria "pausei
 * e voltei a tocar logo em seguida" em tela cheia sem querer. */
test('clique lento, ou longe, não é duplo clique', () => {
  const lento = gestosDe();
  lento.descer(dedo(1, 180, 100, 0, 'mouse'));
  lento.subir(dedo(1, 180, 100, 60, 'mouse'));
  assert.equal(lento.descer(dedo(2, 180, 100, GTMP.TOQUE_DUPLO_MS + 1, 'mouse')), null,
    'passou da janela: são dois cliques, não um gesto');

  const longe = gestosDe();
  longe.descer(dedo(1, 100, 100, 0, 'mouse'));
  longe.subir(dedo(1, 100, 100, 60, 'mouse'));
  assert.equal(longe.descer(dedo(2, 100 + GTMP.TOQUE_DUPLO_PX + 1, 100, 200, 'mouse')), null);
});

/* Em tela cheia o cadeado existe também no computador, e destravar é o único
 * gesto que a tela bloqueada aceita. Antes de hoje, com o mouse, não havia
 * nenhum: só o Esc tirava de lá. */
test('com a tela travada, o duplo clique destrava em vez de maximizar', () => {
  const g = gestosDe();
  g.travar(true);
  g.descer(dedo(1, 180, 100, 0, 'mouse'));
  g.subir(dedo(1, 180, 100, 40, 'mouse'));
  assert.deepEqual(g.descer(dedo(2, 180, 100, 200, 'mouse')), { acao: 'destravar' });
});

/* E o dedo não mudou: nas laterais continua sendo ±5 s, não tela cheia. */
test('o toque duplo do dedo continua sendo o pulo de 5 s', () => {
  const g = gestosDe();
  g.descer(dedo(1, 40, 100, 0));
  g.subir(dedo(1, 40, 100, 60));
  assert.deepEqual(g.descer(dedo(2, 40, 100, 200)),
    { acao: 'pular', segundos: -GTMP.PULO_TOQUE_S });
});

/* -------------------------------------------- item 3 — pressionar e segurar */

test('meio segundo com o dedo parado liga o 2×; soltar devolve', () => {
  assert.equal(GTMP.SEGURAR_MS, 500);
  assert.equal(GTMP.VELOCIDADE_SEGURAR, 2);

  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0));
  assert.deepEqual(g.aoSegurar(), { acao: 'velocidadeTemporaria', ligada: true });
  assert.equal(g.estado().segurando, true);
  /* E o soltar devolve a velocidade em vez de dar play/pause: quem segurou
   * meio segundo não pediu para pausar. */
  assert.deepEqual(g.subir(dedo(1, 180, 100, 900)),
    { acao: 'velocidadeTemporaria', ligada: false });
});

test('dedo que andou não é segurar — era um arrasto começando devagar', () => {
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0));
  g.mover(dedo(1, 180 + GTMP.MOVER_MIN_PX + 5, 100, 60));
  assert.equal(g.aoSegurar(), null);
});

test('o mouse não segura, e a tela travada também não', () => {
  const rato = gestosDe();
  rato.descer(dedo(1, 180, 100, 0, 'mouse'));
  assert.equal(rato.aoSegurar(), null);

  const preso = gestosDe();
  preso.travar(true);
  preso.descer(dedo(1, 180, 100, 0));
  assert.equal(preso.aoSegurar(), null);
});

/* O navegador toma o gesto para si o tempo todo — a rolagem da página, o
 * "voltar" da borda, uma chamada entrando. Sem devolver a velocidade aqui, o
 * vídeo ficaria em 2× para sempre, sem nenhum dedo na tela para soltar. */
test('o cancelamento do navegador devolve a velocidade', () => {
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0));
  g.aoSegurar();
  assert.deepEqual(g.cancelar(), { acao: 'velocidadeTemporaria', ligada: false });
  assert.deepEqual(g.estado().dedos, 0);
});

/* ------------------------------------------ item 11 — a linha do tempo */

test('o arrasto começa valendo zero, depois dos 10 px de zona morta', () => {
  assert.equal(GTMP.ARRASTO_TEMPO_S, 120);
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0));

  /* Antes do limiar, nada. É o que impede o vídeo de saltar no primeiro pixel
   * de tremor da mão. */
  assert.equal(g.mover(dedo(1, 185, 101, 30)), null);

  assert.deepEqual(g.mover(dedo(1, 195, 101, 60)),
    { acao: 'arrastar', alvo: 'tempo', fase: 'inicio', valor: 0 },
    'a origem do arrasto é onde o limiar foi vencido, não onde o dedo desceu');
});

/* A ACELERAÇÃO, pedida em 03/09 depois do primeiro teste no dedo.
 *
 * O ganho é a velocidade do pedaço dividida pela de referência, aparado nas
 * duas pontas. Sem os limites, um dedo quase parado não andaria nada e um
 * espasmo de pulso jogaria o vídeo para o fim. */
test('o ganho do arrasto é a velocidade, e ele tem piso e teto', () => {
  assert.equal(GTMP.VELOCIDADE_REF_PX_MS, 1);
  assert.equal(GTMP.GANHO_ARRASTO_MIN, 0.25);
  assert.equal(GTMP.GANHO_ARRASTO_MAX, 6);

  assert.equal(GTMP.ganhoDoArrasto(10, 10), 1, '1 px/ms é o ritmo de referência');
  assert.equal(GTMP.ganhoDoArrasto(30, 10), 3);
  assert.equal(GTMP.ganhoDoArrasto(1, 100), GTMP.GANHO_ARRASTO_MIN, 'dedo quase parado');
  assert.equal(GTMP.ganhoDoArrasto(1000, 10), GTMP.GANHO_ARRASTO_MAX, 'arranco');
  assert.equal(GTMP.ganhoDoArrasto(-30, 10), 3, 'a direção não muda o ganho');

  /* Dois eventos no mesmo milissegundo dariam velocidade infinita. */
  assert.equal(GTMP.ganhoDoArrasto(50, 0), GTMP.GANHO_ARRASTO_MAX);
  assert.equal(GTMP.ganhoDoArrasto(0, 0), GTMP.GANHO_ARRASTO_MIN);
});

/* Um arrasto de velocidade constante, em passos iguais: vence o limiar e
 * depois anda `px` em `ms`. É a forma de cobrar o gesto inteiro, e não a
 * função solta — a soma dos pedaços é o que a pessoa sente. */
const arrastarHorizontal = (px, ms, x0) => {
  const g = gestosDe();
  const inicio = x0 == null ? 180 : x0;
  g.descer(dedo(1, inicio, 60, 0));
  g.mover(dedo(1, inicio + 15, 60, 10));   /* vence os 10 px; a origem passa a ser aqui */
  let r = null;
  for (let i = 1; i <= 8; i++) {
    r = g.mover(dedo(1, inicio + 15 + px * i / 8, 60, 10 + ms * i / 8));
  }
  return r.valor;
};

test('a MESMA distância vale tempos diferentes conforme a pressa da mão', () => {
  /* 150 px de 375 = 40% da largura = os 48 s de sempre, no ritmo de
   * referência. É o tato da versão de 03/09, preservado no meio da escala. */
  assert.equal(arrastarHorizontal(150, 150), 48);

  /* Devagar: quatro vezes mais fino, para achar a frase que passou. */
  assert.equal(arrastarHorizontal(150, 3000), 12);

  /* Arranco: cinco vezes mais longe, para atravessar o vídeo. */
  assert.equal(arrastarHorizontal(150, 30), 240);

  /* E nem o arranco mais violento passa do teto de 6×. */
  assert.equal(arrastarHorizontal(150, 5), 288);
});

test('para trás é negativo, e o arrasto horizontal vale fora da tela cheia', () => {
  assert.equal(arrastarHorizontal(-150, 150, 300), -48);
});

/* O TETO SAI DO TAMANHO DO VÍDEO (pedido em 03/09).
 *
 * "Seis vezes" não quer dizer a mesma coisa num vídeo de dois minutos e num de
 * uma hora: no curto, um arranco atravessava o título inteiro; no longo, mal
 * saía do lugar. A regra passou a ser uma só — um arranco de ponta a ponta do
 * quadro anda no máximo esta fração do vídeo. */
test('um arranco anda no máximo a fração escolhida do vídeo', () => {
  /* Os dois exemplos que motivaram o pedido, na conta que o player faz: o
   * arranco máximo é `teto × ARRASTO_TEMPO_S`, porque o teto é o ganho de uma
   * travessia completa do quadro. */
  const arrancoMaximo = (duracao, fracao) =>
    Math.round(GTMP.tetoDoGanho(duracao, fracao) * GTMP.ARRASTO_TEMPO_S);

  assert.equal(arrancoMaximo(3600, 1 / 3), 1200, 'uma hora a 1/3 são 20 minutos');
  assert.equal(arrancoMaximo(120, 1 / 2), 60, 'dois minutos a 1/2 é um minuto');

  /* E o padrão de 0,4 dá a mesma fração em qualquer duração — é o que faz o
   * gesto ter o mesmo significado no título de 2:50 e no de 27 minutos. */
  assert.equal(GTMP.FRACAO_TETO_PADRAO, 0.4);
  for (const d of [170, 1152, 1620, 3600]) {
    assert.equal(Math.round(arrancoMaximo(d) / d * 100), 40, 'duração ' + d);
  }
});

test('o teto nunca cai abaixo do piso, nem sobe sem duração conhecida', () => {
  /* Vídeo curtíssimo: sem esta trava o teto ficaria abaixo do ganho mínimo e
   * congelaria o arrasto inteiro, inclusive o lento. */
  assert.equal(GTMP.tetoDoGanho(10, 0.4), GTMP.GANHO_ARRASTO_MIN);
  /* Sem duração vale o teto fixo de antes de 03/09. */
  for (const d of [0, -1, NaN, undefined, 'x']) {
    assert.equal(GTMP.tetoDoGanho(d, 0.4), GTMP.GANHO_ARRASTO_MAX, 'duração ' + d);
  }
});

test('a fração vinda do /admin é aparada, nunca aceita crua', () => {
  assert.equal(GTMP.fracaoDoTeto(undefined), GTMP.FRACAO_TETO_PADRAO);
  assert.equal(GTMP.fracaoDoTeto(null), GTMP.FRACAO_TETO_PADRAO);
  assert.equal(GTMP.fracaoDoTeto('meio'), GTMP.FRACAO_TETO_PADRAO);
  assert.equal(GTMP.fracaoDoTeto(0), GTMP.FRACAO_TETO_PADRAO, 'zero congelaria o gesto');
  assert.equal(GTMP.fracaoDoTeto(-1), GTMP.FRACAO_TETO_PADRAO);
  assert.equal(GTMP.fracaoDoTeto(0.001), GTMP.FRACAO_TETO_MIN);
  assert.equal(GTMP.fracaoDoTeto(9), GTMP.FRACAO_TETO_MAX,
    'acima de 100% um arranco atravessaria o vídeo inteiro');
  assert.equal(GTMP.fracaoDoTeto(0.5), 0.5, 'o que está na faixa passa intacto');
});

/* O gesto inteiro, com a duração na mão: num título curto o teto fica ABAIXO
 * do ganho de referência, e é o certo — uma travessia do quadro no ritmo
 * normal já valeria 120 s, quase o vídeo todo. */
test('num vídeo curto o arranco é contido; num longo, generoso', () => {
  /* Um arranco atravessando o quadro inteiro (375 px) em 40 ms — quase
   * 10 px/ms, bem acima de qualquer teto. Começa em 40 px e não em 20: os
   * 24 px da borda são do "voltar" do navegador e matariam o arrasto. */
  const arrancoDePontaAPonta = (duracao) => {
    const g = GTMP.criarGestos();
    g.medir({ largura: 375, altura: 211, duracao: duracao });
    g.descer(dedo(1, 40, 60, 0));
    g.mover(dedo(1, 55, 60, 5));
    let r = null;
    for (let i = 1; i <= 8; i++) r = g.mover(dedo(1, 55 + 375 * i / 8, 60, 5 + 40 * i / 8));
    return r.valor;
  };
  assert.equal(arrancoDePontaAPonta(170), 68,
    'no Boas Férias (2:50), 40% são 68 s');
  assert.equal(arrancoDePontaAPonta(1152), 460.8,
    'no Bombeiro (19:12), 40% são 7:41');
});

/* CANCELAR SEM SOLTAR O DEDO (pedido em 03/09).
 *
 * A aceleração cobra um preço — o arrasto depende do caminho, e ir rápido e
 * voltar devagar não devolve o vídeo ao ponto de partida. Jogar o dedo para
 * baixo é a porta de saída, e ela vale COM O DEDO AINDA NA TELA: soltar já
 * confirma. */
test('jogar o dedo para baixo desfaz o arrasto na hora', () => {
  const g = gestosDe();
  g.descer(dedo(1, 100, 40, 0));
  g.mover(dedo(1, 115, 40, 10));
  const andou = g.mover(dedo(1, 250, 42, 150));
  assert.ok(andou.valor > 10, 'o arrasto tem que ter andado antes de ser desfeito');

  /* Ainda dentro do limiar: só o aviso, o arrasto continua valendo. */
  const limiar = GTMP.limiarDeCancelar(211);
  const quase = g.mover(dedo(1, 250, 40 + limiar * 0.6, 200));
  assert.equal(quase.fase, 'mover');
  assert.equal(quase.descarte, 0.6, 'a tela precisa saber que o cancelamento está perto');

  /* Atravessou: acaba aqui, sem esperar o dedo sair. */
  const fim = g.mover(dedo(1, 250, 40 + limiar + 1, 260));
  assert.deepEqual(fim,
    { acao: 'arrastar', alvo: 'tempo', fase: 'fim', valor: 0, cancelado: true },
    'valor 0 é o que devolve o vídeo para onde o movimento começou');

  /* E o resto do gesto é inerte: nem continua arrastando, nem vira play/pause
   * ao soltar. */
  assert.equal(g.mover(dedo(1, 300, 300, 320)), null);
  assert.equal(g.subir(dedo(1, 300, 300, 400)), null);
});

test('o limiar de cancelar acompanha a altura do quadro, com piso em px', () => {
  assert.equal(GTMP.CANCELAR_MIN_PX, 56);
  assert.equal(Math.round(GTMP.limiarDeCancelar(195)), 66, 'quadro embutido');
  assert.equal(Math.round(GTMP.limiarDeCancelar(375)), 128, 'tela cheia deitada');
  assert.equal(GTMP.limiarDeCancelar(100), 56, 'num quadro baixinho vale o piso');
  assert.equal(GTMP.limiarDeCancelar(0), 56, 'sem medida, o piso');
});

/* Descer o dedo um pouco é coisa de quem arrasta na horizontal com o polegar.
 * Se isso cancelasse, o gesto principal ficaria impossível. */
test('a mão trêmula não cancela o arrasto', () => {
  const g = gestosDe();
  g.descer(dedo(1, 100, 40, 0));
  g.mover(dedo(1, 115, 40, 10));
  for (let i = 1; i <= 6; i++) {
    const r = g.mover(dedo(1, 115 + 20 * i, 40 + i * 4, 10 + i * 20));
    assert.equal(r.fase, 'mover', 'passo ' + i + ' não podia cancelar');
  }
});

/* Só o arrasto de TEMPO tem cancelamento. No volume e no brilho descer o dedo
 * É o gesto — cancelar ali seria desligar o próprio controle. */
test('descer o dedo no arrasto de volume não cancela nada: é o gesto', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.descer(dedo(1, 750, 40, 0));
  g.mover(dedo(1, 750, 60, 20));
  const r = g.mover(dedo(1, 750, 340, 200));
  assert.equal(r.alvo, 'volume');
  assert.equal(r.fase, 'mover');
  assert.ok(r.valor < 0, 'descer abaixa o volume, como sempre');
});

/* O volume e o brilho NÃO são acelerados, e é de propósito: ali a régua fixa é
 * a qualidade, não o defeito. A altura toda percorre a faixa toda, sempre — um
 * volume que dependesse da pressa da mão seria uma armadilha. */
test('o deslizar vertical não tem aceleração — a altura toda é a faixa toda', () => {
  const medir = (ms) => {
    const g = gestosDe(QUADRO_CHEIO);
    g.permitirVertical(true);
    g.descer(dedo(1, 750, 300, 0));
    g.mover(dedo(1, 750, 280, 10));
    let r = null;
    for (let i = 1; i <= 8; i++) r = g.mover(dedo(1, 750, 280 - 187.5 * i / 8, 10 + ms * i / 8));
    return r.valor;
  };
  assert.equal(medir(2000), 0.5, 'devagar');
  assert.equal(medir(40), 0.5, 'depressa — o mesmo meio caminho, o mesmo 50%');
});

/* --------------------------------------- itens 10a e 10b — o deslizar ↕ */

/* Fora da tela cheia o quadro ocupa 211 px de uma tela de 812 e a ficha
 * continua embaixo: roubar o arrasto vertical ali entrega uma página que não
 * rola quando o polegar cai no vídeo. Trocar a rolagem da página pelo brilho
 * da imagem seria um péssimo negócio. */
test('fora da tela cheia não existe arrasto vertical — a página rola', () => {
  const g = gestosDe();
  g.descer(dedo(1, 40, 150, 0));
  assert.equal(g.mover(dedo(1, 40, 100, 60)), null);
  assert.equal(g.estado().eixo, 'morto');
});

/* O BRILHO SAIU em 09/09/2026, e este teste é o que sobrou daquele — ele
 * cobrava "à esquerda o brilho, à direita o volume" e agora cobra que a
 * esquerda esteja MORTA.
 *
 * A razão da saída não foi espaço, foi honestidade: `filter: brightness()`
 * mexe na IMAGEM, e o controle se anunciava como brilho de tela — que
 * navegador nenhum alcança. Um controle que promete o que não entrega é pior
 * do que não ter.
 *
 * A zona esquerda fica RESERVADA, não livre: é onde entram os dois gestos da
 * fase 7 (arrastar ↑ e ↓). Enquanto eles não existirem, `morto` é a resposta
 * certa — um arrasto que não faz nada é melhor do que um que faz a coisa
 * errada, e é assim que o centro sempre se comportou. */
/* O BRILHO SAIU em 09/09/2026, e este teste é o que sobrou daquele — ele
 * cobrava "à esquerda o brilho, à direita o volume".
 *
 * A esquerda não ficou morta: virou o DESLIZE da fase 7, junto com o centro.
 * São 70% da largura para um gesto e 30% para o outro, e a diferença é
 * deliberada — o volume tem o painel e as setas do teclado como outros
 * caminhos, o deslize não tem nenhum. */
test('em tela cheia: à direita o volume, no resto o deslize', () => {
  const dir = gestosDe(QUADRO_CHEIO);
  dir.permitirVertical(true);
  dir.descer(dedo(1, 750, 300, 0));
  assert.deepEqual(dir.mover(dedo(1, 750, 280, 40)),
    { acao: 'arrastar', alvo: 'volume', fase: 'inicio', valor: 0 });
  /* Metade da altura × a faixa de 1 do volume = 0,5, ou 50 pontos. */
  assert.deepEqual(dir.mover(dedo(1, 750, 92.5, 200)),
    { acao: 'arrastar', alvo: 'volume', fase: 'mover', valor: 0.5 });

  for (const [zona, x] of [['esquerda', 60], ['centro', 400]]) {
    const g = gestosDe(QUADRO_CHEIO);
    g.permitirVertical(true);
    g.descer(dedo(1, x, 300, 0));
    const inicio = g.mover(dedo(1, x, 320, 40));
    assert.equal(inicio.acao, 'deslize', zona + ' precisa abrir o deslize');
    assert.equal(g.estado().deslize, true);
    assert.equal(g.estado().arrasto, null, zona + ' não pode virar volume');
  }
});

/* O `filter: brightness()` era a única coisa que obrigava o navegador a compor
 * o vídeo numa camada própria fora do zoom. Ele tem que ter sumido do CSS
 * junto com o gesto — regra órfã não dá erro, só fica lá esperando alguém
 * reintroduzir a classe e achar que funciona de novo. */
test('o filtro de brilho saiu do CSS junto com o gesto', () => {
  /* Os comentários TÊM que sair antes da busca, e não é zelo: o comentário
   * que registra a remoção cita a regra removida por extenso, para quem vier
   * depois saber o que existia. Procurar no arquivo cru acharia a citação e
   * daria o teste por reprovado — que é a mesma armadilha do `semear` no
   * teste do framerate.mjs: um teste que reprova a EXPLICAÇÃO da remoção. */
  const css = lerTexto(path.join(SITE, 'style.css'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /\.pl-brilho\s+\.pl-video/,
    'a regra do brilho continua no CSS — o gesto saiu e ela ficou órfã');
  assert.doesNotMatch(PLAYER_CODIGO, /classList\.toggle\(\s*'pl-brilho'/,
    'o player.js ainda liga a classe do brilho');
  assert.equal(GTMP.proximoBrilho, undefined,
    'o player-core ainda exporta proximoBrilho — o item 10a não existe mais');
});

test('para cima é MAIS: o eixo da tela cresce para baixo, o volume não', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.descer(dedo(1, 750, 100, 0));
  g.mover(dedo(1, 750, 120, 40));
  const desceu = g.mover(dedo(1, 750, 307.5, 200));
  assert.equal(desceu.valor, -0.5, 'descer o dedo abaixa o volume');
});

/* O centro não tem arrasto VERTICAL de valor — nada ali segue o dedo ponto a
 * ponto. Ele é do arrasto horizontal, do play/pause e, desde 09/09, do
 * deslize da fase 7, que é discreto: decide no fim, não no caminho. */
test('no centro não existe arrasto de valor — o vertical ali é o deslize', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.descer(dedo(1, 400, 300, 0));
  const a = g.mover(dedo(1, 400, 200, 60));
  assert.equal(a.acao, 'deslize');
  assert.equal(g.estado().arrasto, null, 'nada no centro pode virar arrasto de valor');
});

/* ------------- os dois deslizes da fase 7 (itens 4 e 5, 09/09) ----------- */

/* A ORIENTAÇÃO é o desempate, e sai das medidas que já existem — `largura >
 * altura` —, não de `screen.orientation`. Em tela cheia o quadro É a tela, e é
 * a geometria que decide se ainda há tela a ganhar. */
test('a orientação decide qual dos dois deslizes existe', () => {
  const emPe = QUADRO_CHEIO_EM_PE, deitado = QUADRO_CHEIO;
  assert.equal(GTMP.alvoDoDeslize(-100, emPe), 'deitar', 'em pé, ↑ deita a imagem');
  assert.equal(GTMP.alvoDoDeslize(100, emPe), null, 'em pé, ↓ não fecha nada');
  assert.equal(GTMP.alvoDoDeslize(100, deitado), 'fechar', 'deitado, ↓ fecha');
  assert.equal(GTMP.alvoDoDeslize(-100, deitado), null, 'deitado, ↑ não tem tela a ganhar');
  /* Sem medida não há orientação, e inventar uma fecharia players por engano. */
  assert.equal(GTMP.alvoDoDeslize(100, { largura: 0, altura: 0 }), null);
});

/* O limiar é fração da altura com piso em px: em tela cheia deitada a altura é
 * menos da metade da de pé, e uma distância fixa seria fácil demais num modo e
 * exaustiva no outro. */
test('o limiar do deslize acompanha a altura, e tem piso', () => {
  assert.equal(GTMP.limiarDeDeslize(812), 203);
  assert.equal(GTMP.limiarDeDeslize(375), 93.75);
  /* O piso só assume abaixo de 256 px — janela pequena de computador, nunca
   * telefone. Sem ele, fechar o player viraria um gesto de dez pixels. */
  assert.equal(GTMP.limiarDeDeslize(120), GTMP.DESLIZE_MIN_PX);
  assert.equal(GTMP.limiarDeDeslize(0), GTMP.DESLIZE_MIN_PX);
  assert.equal(GTMP.limiarDeDeslize(NaN), GTMP.DESLIZE_MIN_PX);
});

test('deitado, o deslize ↓ completo fecha o player', () => {
  const g = gestosDe(QUADRO_CHEIO);           /* 812 × 375 → limiar 93,75 */
  g.permitirVertical(true);
  g.descer(dedo(1, 200, 100, 0));
  const meio = g.mover(dedo(1, 200, 150, 40));
  assert.equal(meio.alvo, 'fechar');
  assert.equal(meio.feito, false, 'no meio do caminho NADA pode acontecer');
  assert.equal(meio.progresso, 0.53, '50 de 93,75');

  const fim = g.subir(dedo(1, 200, 250, 300));   /* 150 px, acima do limiar */
  assert.deepEqual(fim, { acao: 'deslize', alvo: 'fechar', fase: 'fim', progresso: 1, feito: true });
});

test('em pé, o deslize ↑ completo deita a imagem', () => {
  const g = gestosDe(QUADRO_CHEIO_EM_PE);    /* 375 × 812 → limiar 203 */
  g.permitirVertical(true);
  g.descer(dedo(1, 100, 600, 0));
  assert.equal(g.mover(dedo(1, 100, 560, 40)).alvo, 'deitar');
  const fim = g.subir(dedo(1, 100, 350, 300));   /* 250 px para cima */
  assert.equal(fim.feito, true);
  assert.equal(fim.alvo, 'deitar');
});

/* Curto demais NÃO faz nada, e é o que deixa desistir no meio: o dedo volta e
 * o gesto morre. Vale principalmente para o `fechar`, que é destrutivo. */
test('o deslize curto não faz nada — dá para desistir no meio', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.descer(dedo(1, 200, 100, 0));
  g.mover(dedo(1, 200, 170, 40));
  const fim = g.subir(dedo(1, 200, 130, 300));   /* voltou: só 30 px */
  assert.equal(fim.feito, false, 'faltou distância — não pode fechar');
  assert.ok(fim.progresso < 1);
});

/* A direção errada devolve ação, com alvo nulo e progresso zero. NÃO devolve
 * `null`: quem executa precisa saber que o gesto acabou para tirar o aviso da
 * tela, senão o selo fica pendurado. */
test('a direção sem função devolve o fim, para a tela poder se limpar', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.descer(dedo(1, 200, 300, 0));
  g.mover(dedo(1, 200, 200, 40));
  const fim = g.subir(dedo(1, 200, 60, 300));    /* ↑ deitado: não faz nada */
  assert.deepEqual(fim, { acao: 'deslize', alvo: null, fase: 'fim', progresso: 0, feito: false });
});

/* Fora da tela cheia o vertical é do NAVEGADOR — a página rola com o dedo no
 * vídeo. O deslize não pode existir ali, nem em pé nem deitado. */
test('fora da tela cheia não há deslize nenhum', () => {
  const g = gestosDe(QUADRO_TELEFONE);
  g.descer(dedo(1, 100, 150, 0));
  assert.equal(g.mover(dedo(1, 100, 40, 60)), null);
  assert.equal(g.estado().eixo, 'morto');
  assert.equal(g.estado().deslize, false);
});

/* Um segundo dedo é o começo de OUTRO gesto — pinça ou capítulo. Fechar o
 * player no meio dele seria o pior desfecho possível: destrutivo e não pedido. */
test('um segundo dedo mata o deslize sem executá-lo', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.descer(dedo(1, 200, 100, 0));
  g.mover(dedo(1, 200, 260, 40));            /* 160 px: já passou do limiar */
  const morte = g.descer(dedo(2, 400, 120, 60));
  assert.equal(morte.acao, 'deslize');
  assert.equal(morte.feito, false, 'a distância bastava, e mesmo assim não pode fechar');
  assert.equal(g.estado().deslize, false);
});

/* Com a tela BLOQUEADA (item 9) nada responde ao dedo — é o ponto inteiro do
 * cadeado, e fechar o player seria o pior a escapar dele. */
test('a tela bloqueada não deixa o deslize começar', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.travar(true);
  g.descer(dedo(1, 200, 100, 0));
  assert.equal(g.mover(dedo(1, 200, 260, 40)), null);
  assert.equal(g.estado().deslize, false);
});

/* `screen.orientation.lock()` REJEITA por motivos normais — o navegador não
 * permitir, a tela cheia ter acabado no meio. Rejeitar não é erro, e sem o
 * `catch` a página registra exceção não tratada por uma coisa que só não
 * aconteceu. E `lock` não existe no iOS, o que precisa ser CHECADO antes de
 * chamar: lá o acesso direto lançaria. */
test('o deitar trata a ausência e a recusa do lock — no iOS ele nem existe', () => {
  const corpo = PLAYER_CODIGO.match(/function deitarImagem\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(corpo, 'não achei deitarImagem em player.js');
  assert.match(corpo[1], /typeof o\.lock !== 'function'/,
    'precisa checar se o lock existe: no iOS ele não existe');
  assert.match(corpo[1], /\.catch\(/, 'a promessa do lock rejeita, e rejeitar é normal');
  assert.match(corpo[1], /try\s*\{/, 'o lock também lança de forma síncrona em alguns navegadores');
});

/* A ORDEM importa: sair da tela cheia ANTES de redesenhar. Destruir o elemento
 * que está em tela cheia deixa o navegador saindo dela sozinho depois, com a
 * página já trocada embaixo — e o `fullscreenchange` do próprio player
 * disparando sobre um player que não existe mais. */
test('o fechar sai da tela cheia antes de devolver a ficha', () => {
  const corpo = PLAYER_CODIGO.match(/function fecharPlayer\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(corpo, 'não achei fecharPlayer em player.js');
  const saida = corpo[1].search(/exitFullscreen/);
  const gancho = corpo[1].search(/g\.aoFechar\(\)/);
  assert.ok(saida > -1 && gancho > -1, 'os dois passos precisam existir');
  assert.ok(saida < gancho, 'a saída da tela cheia vem ANTES de redesenhar a ficha');
  assert.match(corpo[1], /typeof g\.aoFechar === 'function'/,
    'sem o gancho o gesto não faz nada — um player não se arranca do DOM alheio');
  /* ACHADO NA CONFERÊNCIA, no navegador: `exitFullscreen()` devolve uma
   * PROMESSA e ela rejeita quando o navegador acha que já não está em tela
   * cheia. Um `try/catch` sozinho pega o lançamento síncrono e deixa a
   * rejeição virar promessa não tratada, registrada no console de quem está
   * assistindo. Os dois são necessários, e é por isso que o teste cobra os
   * dois. */
  assert.match(corpo[1], /try\s*\{/, 'o exitFullscreen também lança de forma síncrona');
  assert.match(corpo[1], /pedido\.catch\(/,
    'a promessa do exitFullscreen rejeita — sem o catch vira promessa não tratada');
});

/* Quem redesenha é o app.js, e tem que ser `renderFicha` do MESMO id — não um
 * `location.hash`. Já estamos nessa rota: trocar o hash para ele não dispara
 * `hashchange`, e o gesto não faria nada. */
test('o app.js fecha o player redesenhando a ficha, não trocando o hash', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const gancho = app.match(/aoFechar: function \(\) \{([^}]*)\}/);
  assert.ok(gancho, 'não achei o aoFechar no app.js');
  assert.match(gancho[1], /renderFicha\(item\.id\)/);
  assert.doesNotMatch(gancho[1], /location\.hash/,
    'o hash já é este: trocá-lo não dispara hashchange e o gesto morreria em silêncio');
});

/* REGRA 1 cobrada mais uma vez, no gesto novo: fechar o player e deitar a
 * imagem não podem tocar nada. O `renderFicha` remonta a ficha com a capa, e
 * é ali que um `play()` distraído poria o vídeo tocando sem ninguém pedir. */
test('nem o deitar nem o fechar chamam play()', () => {
  for (const nome of ['deitarImagem', 'fecharPlayer', 'aplicarDeslize']) {
    const corpo = PLAYER_CODIGO.match(
      new RegExp('function ' + nome + '\\(a?\\)\\s*\\{([\\s\\S]*?)\\n    \\}'));
    assert.ok(corpo, 'não achei ' + nome + ' em player.js');
    assert.doesNotMatch(corpo[1], /\bplay\(\)/, nome + ' não pode tocar nada');
  }
});

/* A altura toda percorre 100 pontos de volume, não os 200 do reforço: quem
 * quer reforço passa pelo painel, onde ele está escrito e marcado em amarelo.
 * Um deslize distraído não pode dobrar o volume de ninguém. */
test('o deslizar não alcança o reforço sozinho', () => {
  assert.equal(GTMP.ARRASTO_VOLUME, 1);
});

/* O teto e o piso do brilho (0,25 e 1,75) e o `proximoBrilho` foram testados
 * aqui de 03/09 a 09/09. Saíram com o gesto — o que restou é a asserção de
 * ausência, no teste do CSS acima. */

/* --------------------------------------------- item 2 — dois dedos */

test('dois dedos que encostam e saem pulam de capítulo', () => {
  const dir = gestosDe();
  dir.descer(dedo(1, 300, 100, 0));
  dir.descer(dedo(2, 340, 120, 20));
  assert.deepEqual(dir.subir(dedo(1, 300, 100, 150)), { acao: 'capitulo', direcao: 1 });
  assert.equal(dir.subir(dedo(2, 340, 120, 160)), null, 'o segundo dedo não repete o pulo');

  const esq = gestosDe();
  esq.descer(dedo(1, 40, 100, 0));
  esq.descer(dedo(2, 80, 120, 20));
  assert.deepEqual(esq.subir(dedo(1, 40, 100, 150)), { acao: 'capitulo', direcao: -1 });
});

/* O desempate da §4.6 do plano, escrito como teste: dois dedos que MUDAM a
 * distância entre si são pinça (item 7, fase 8), não toque. Sem isto, toda
 * pinça começando viraria pulo de capítulo. */
test('a pinça não vira capítulo — o desempate é a distância entre os dedos', () => {
  assert.equal(GTMP.DOIS_DEDOS_PX, 10);
  const g = gestosDe();
  g.descer(dedo(1, 150, 100, 0));
  g.descer(dedo(2, 200, 100, 20));
  g.mover(dedo(2, 200 + GTMP.DOIS_DEDOS_PX + 1, 100, 80));
  assert.equal(g.subir(dedo(1, 150, 100, 150)), null);
});

test('dois dedos demorados não são toque — 250 ms e acabou', () => {
  assert.equal(GTMP.DOIS_DEDOS_MS, 250);
  const g = gestosDe();
  g.descer(dedo(1, 300, 100, 0));
  g.descer(dedo(2, 340, 100, 20));
  assert.equal(g.subir(dedo(1, 300, 100, 20 + GTMP.DOIS_DEDOS_MS + 1)), null);
});

/* O segundo dedo chegando no meio de um arrasto: o gesto de um dedo acaba
 * ali, e quem está executando precisa saber para desfazer o que está na tela
 * — o selo do volume, a linha do tempo em movimento. */
test('o segundo dedo encerra o arrasto do primeiro', () => {
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0));
  g.mover(dedo(1, 200, 100, 40));
  g.mover(dedo(1, 260, 100, 90));
  const fim = g.descer(dedo(2, 100, 100, 120));
  assert.equal(fim.acao, 'arrastar');
  assert.equal(fim.fase, 'fim');
  assert.equal(g.estado().arrasto, null);
});

/* Achado no navegador, em 03/09, e o estrago é grande: um `pointerup` que se
 * perde deixa um dedo na lista para sempre, e a partir dali TODO toque vira
 * "dois dedos". O player para de responder ao dedo e só volta quando alguém
 * sai da ficha — sem erro no console, sem nada na tela. */
test('um dedo que nunca subiu não pode matar os gestos seguintes', () => {
  const g = gestosDe();
  g.descer(dedo(1, 100, 100, 0));      /* e o pointerup se perde no caminho */

  /* Cinco segundos depois, um toque novo. Sem a limpeza, este seria o segundo
   * dedo de um gesto de dois. */
  g.descer(dedo(2, 180, 100, 6000));
  assert.equal(g.estado().dedos, 1, 'o fantasma tinha que ter saído da lista');
  assert.deepEqual(g.subir(dedo(2, 180, 100, 6060)), { acao: 'alternarPlay' });

  /* Perto no tempo, os dois dedos continuam valendo como dois dedos: a
   * limpeza não pode comer o gesto do item 2. */
  const dois = gestosDe();
  dois.descer(dedo(1, 300, 100, 0));
  dois.descer(dedo(2, 340, 100, 20));
  assert.equal(dois.estado().dedos, 2);
});

test('o mesmo dedo descendo duas vezes não é contado em dobro', () => {
  const g = gestosDe();
  g.descer(dedo(1, 100, 100, 0));
  g.descer(dedo(1, 180, 100, 50));
  assert.equal(g.estado().dedos, 1);
  assert.deepEqual(g.subir(dedo(1, 180, 100, 100)), { acao: 'alternarPlay' },
    'com o dedo contado em dobro isto viraria um toque de dois dedos');
});

test('três dedos não são gesto nenhum', () => {
  const g = gestosDe();
  g.descer(dedo(1, 100, 100, 0));
  g.descer(dedo(2, 200, 100, 20));
  g.descer(dedo(3, 300, 100, 40));
  assert.equal(g.subir(dedo(1, 100, 100, 120)), null);
  assert.equal(g.subir(dedo(2, 200, 100, 130)), null);
  assert.equal(g.subir(dedo(3, 300, 100, 140)), null);
});

/* ------------------------------------------- item 7 — a pinça (fase 8) ---
 *
 * A pinça é a outra metade do desempate da §4.6, e a que faltava desde a
 * fase 5: o teste que provava que dois dedos se afastando NÃO pulam capítulo
 * já existia; o que eles fazem em vez disso é o que entra agora.
 *
 * A decisão que atravessa a fase inteira: a pinça SÓ existe em tela cheia.
 * Fora dela o `touch-action` do quadro entrega o gesto ao navegador, que o usa
 * para ampliar a página — e esse zoom é acessibilidade. Disputá-lo custaria
 * tirar de quem precisa de letra maior a única forma de conseguir letra maior
 * em cima do vídeo, em troca de um recurso que a tela cheia já dá inteiro. É a
 * mesma forma da decisão do deslizar ↕ da fase 5.
 */

/* Um quadro de tela cheia com um vídeo que o preenche sem faixa preta, que é
 * onde as contas são legíveis: centro em (400, 200), e a imagem podendo andar
 * 400 px na horizontal e 200 na vertical quando ampliada 2×. */
const QUADRO_ZOOM = {
  largura: 800, altura: 400, duracao: 600,
  videoLargura: 800, videoAltura: 400
};

const comPinca = (medidas) => {
  const g = GTMP.criarGestos();
  g.medir(medidas || QUADRO_ZOOM);
  g.permitirVertical(true);
  g.permitirPinca(true);
  return g;
};

test('o retângulo da imagem não é o quadro — é o que sobra do contain', () => {
  /* 16:9 num quadro de telefone deitado: a imagem toma a altura toda e sobra
   * faixa preta dos dois lados. */
  const pilar = GTMP.retanguloDaImagem(812, 375, 1920, 1080);
  assert.equal(Math.round(pilar.largura), 667);
  assert.equal(Math.round(pilar.altura), 375);

  /* E o contrário: um vídeo mais largo que o quadro deixa faixa em cima e
   * embaixo. */
  assert.deepEqual(GTMP.retanguloDaImagem(800, 400, 1600, 400),
    { largura: 800, altura: 200 });

  /* Antes do `loadedmetadata` não existe proporção nenhuma, e o palpite seguro
   * é o quadro: ele deixa arrastar de menos, nunca de mais. */
  assert.deepEqual(GTMP.retanguloDaImagem(800, 400, 0, 0), { largura: 800, altura: 400 });
});

test('o zoom vai de 1× a 4×, e nada além disso', () => {
  assert.equal(GTMP.ZOOM_MIN, 1);
  assert.equal(GTMP.ZOOM_MAX, 4);
  assert.equal(GTMP.limitarZoom(9), 4, 'o teto da matriz é 4×');
  assert.equal(GTMP.limitarZoom(0.2), 1, 'encolher o vídeo dentro do quadro não existe');
  assert.equal(GTMP.limitarZoom(NaN), 1);
  /* Duas casas, como o volume e o brilho: sem isto o selo diria
   * "Zoom 2,4000000000000004×". */
  assert.equal(GTMP.limitarZoom(2.4000000000000004), 2.4);
});

test('o selo diz o tamanho com vírgula, e em 1× diz que voltou ao normal', () => {
  assert.equal(GTMP.rotuloZoom(2.4), 'Zoom 2,4×');
  assert.equal(GTMP.rotuloZoom(4), 'Zoom 4×', 'inteiro não ganha ",0"');
  assert.equal(GTMP.rotuloZoom(1), 'Tamanho normal');
});

/* O limite do arrasto sai da IMAGEM, e é aqui que a diferença aparece: num
 * vídeo com faixa preta em cima e embaixo, ampliar 2× deixa a imagem do
 * tamanho exato do quadro na vertical — não há para onde arrastar, e medir
 * pelo quadro deixaria a faixa preta subir até ocupar meia tela. */
test('a imagem para na borda dela, não na do quadro', () => {
  const quadro = { largura: 800, altura: 400 };
  const cheio = { largura: 800, altura: 400 };
  assert.deepEqual(GTMP.limitarDeslocamentoZoom({ x: 9999, y: 9999 }, 2, quadro, cheio),
    { x: 400, y: 200 });

  const comFaixa = { largura: 800, altura: 200 };
  assert.deepEqual(GTMP.limitarDeslocamentoZoom({ x: 9999, y: 9999 }, 2, quadro, comFaixa),
    { x: 400, y: 0 }, 'na vertical a imagem ampliada só preenche o quadro');

  /* Em 1× nunca sobra nada: é isto que faz a pinça de volta recentrar o vídeo
   * sozinha, sem nenhum caso especial no código. */
  assert.deepEqual(GTMP.limitarDeslocamentoZoom({ x: 50, y: 50 }, 1, quadro, cheio),
    { x: 0, y: 0 });
});

/* A decisão da fase, escrita como teste: fora da tela cheia NADA muda em
 * relação ao que o acervo inteiro foi varrido usando. */
test('fora da tela cheia a pinça é do navegador, e o player não a disputa', () => {
  const g = GTMP.criarGestos();
  g.medir(QUADRO_ZOOM);                      /* sem permitirPinca */
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));
  assert.equal(g.mover(dedo(2, 700, 200, 60)), null, 'não pode nascer zoom nenhum aqui');
  assert.equal(g.estado().zoom, 1);
  /* E o efeito que a distância JÁ tinha continua o mesmo: deixou de ser um
   * toque de capítulo. */
  assert.equal(g.subir(dedo(1, 300, 200, 100)), null);
});

test('dois dedos que se afastam ampliam, e param em 4×', () => {
  const g = comPinca();
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));           /* 200 px entre os dedos */
  assert.deepEqual(g.mover(dedo(2, 700, 200, 60)),
    { acao: 'zoom', fase: 'inicio', escala: 2, x: 100, y: 0 });
  /* 200 → 1000 px seriam 5×; o teto da matriz corta em 4. */
  assert.equal(g.mover(dedo(2, 1300, 200, 100)).escala, 4);
  const fim = g.subir(dedo(1, 300, 200, 140));
  assert.equal(fim.acao, 'zoom');
  assert.equal(fim.fase, 'fim');
  assert.equal(fim.escala, 4);
});

/* O que separa uma pinça boa de uma ruim: o pedaço do vídeo que está debaixo
 * dos dedos não pode escorregar enquanto se amplia. Sem a âncora, o detalhe
 * que se quer ver foge da tela justamente quando se aproxima dele. */
test('a pinça amplia em volta dos dedos, não do meio do quadro', () => {
  const g = comPinca();
  /* Os dedos abrem em torno de (300, 100) — acima e à esquerda do centro. */
  g.descer(dedo(1, 200, 100, 0));
  g.descer(dedo(2, 400, 100, 20));
  g.mover(dedo(1, 100, 100, 60));
  const z = g.mover(dedo(2, 500, 100, 70));
  assert.deepEqual(z, { acao: 'zoom', fase: 'mover', escala: 2, x: 100, y: 100 });

  /* A prova, refeita à mão com a mesma transformação que o CSS aplica:
   * `tela = escala × (conteúdo − centro) + centro + deslocamento`. O ponto
   * (300, 100) do vídeo tem que continuar caindo em (300, 100) da tela. */
  const naTela = (p) => ({
    x: z.escala * (p.x - 400) + 400 + z.x,
    y: z.escala * (p.y - 200) + 200 + z.y
  });
  assert.deepEqual(naTela({ x: 300, y: 100 }), { x: 300, y: 100 });
});

test('a pinça de volta ao 1× recentra o vídeo sozinha', () => {
  const g = comPinca();
  g.descer(dedo(1, 200, 100, 0));
  g.descer(dedo(2, 400, 100, 20));
  g.mover(dedo(2, 800, 100, 60));                    /* amplia, e desloca */
  assert.ok(g.estado().zoomX !== 0, 'a imagem tinha que estar deslocada aqui');
  g.mover(dedo(2, 400, 100, 120));                   /* fecha de volta */
  const fim = g.subir(dedo(1, 200, 100, 160));
  assert.deepEqual(fim, { acao: 'zoom', fase: 'fim', escala: 1, x: 0, y: 0 });
});

/* Regressão do item 2: a pinça não pode ter comido o toque de dois dedos.
 * Eles moram no mesmo gesto, e o desempate é o mesmo número da §4.6. */
test('em tela cheia o toque de dois dedos continua pulando capítulo', () => {
  const g = comPinca();
  g.descer(dedo(1, 500, 200, 0));
  g.descer(dedo(2, 540, 200, 20));
  assert.deepEqual(g.subir(dedo(1, 500, 200, 150)), { acao: 'capitulo', direcao: 1 });
  assert.equal(g.estado().zoom, 1, 'um toque não amplia nada');
});

/* A inversão que o zoom traz, e ela se explica sozinha: só há o que arrastar
 * quando há mais imagem do que quadro. */
test('em 1× o dedo arrasta a linha do tempo; ampliado, arrasta a imagem', () => {
  const normal = comPinca();
  normal.descer(dedo(1, 400, 200, 0));
  const t = normal.mover(dedo(1, 440, 200, 40));
  assert.equal(t.acao, 'arrastar');
  assert.equal(t.alvo, 'tempo');

  const g = comPinca();
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));
  g.mover(dedo(2, 700, 200, 60));                    /* 2× */
  g.subir(dedo(1, 300, 200, 100));
  g.subir(dedo(2, 700, 200, 110));
  assert.equal(g.estado().zoom, 2, 'o zoom sobrevive aos dedos saírem');

  g.descer(dedo(3, 400, 200, 200));
  const p = g.mover(dedo(3, 360, 200, 240));
  assert.equal(p.acao, 'zoom', 'com a imagem ampliada, o dedo move a imagem');
  assert.equal(p.fase, 'inicio');
  /* Anda o que o dedo andou DEPOIS da zona morta, e não a partir de onde ele
   * desceu — senão a imagem daria um salto de 10 px no primeiro quadro. */
  assert.deepEqual(g.mover(dedo(3, 360, 200, 280)),
    { acao: 'zoom', fase: 'mover', escala: 2, x: 100, y: 0 });
  assert.equal(g.mover(dedo(3, 260, 200, 320)).x, 0);
  /* E ela para na borda: 2× num quadro de 800 dá 400 px de folga para cada
   * lado, e nem o dedo que sai do quadro passa disso. */
  assert.equal(g.mover(dedo(3, -9999, 200, 360)).x, -400);
  assert.equal(g.subir(dedo(3, -9999, 200, 400)).fase, 'fim');
});

/* O dedo que sobra de uma pinça está CONSUMIDO, e é justamente com ele que a
 * mão continua arrastando depois de tirar o outro. */
test('o dedo que sobra da pinça continua arrastando a imagem', () => {
  const g = comPinca();
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));
  g.mover(dedo(2, 700, 200, 60));
  g.subir(dedo(1, 300, 200, 100));                   /* um sai, o outro fica */
  const p = g.mover(dedo(2, 660, 200, 140));
  assert.equal(p && p.acao, 'zoom');
  assert.equal(p.fase, 'inicio');
});

test('segurar para 2× não vale no meio de um arrasto da imagem', () => {
  const g = comPinca();
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));
  g.mover(dedo(2, 700, 200, 60));
  g.subir(dedo(1, 300, 200, 100));
  g.subir(dedo(2, 700, 200, 110));
  g.descer(dedo(3, 400, 200, 200));
  g.mover(dedo(3, 360, 200, 240));                   /* arrastando a imagem */
  assert.equal(g.aoSegurar(), null);
});

/* O navegador tomar o dedo para si — uma chamada que entra, o gesto do
 * sistema — não pode desfazer a ampliação na cara de quem estava lendo. */
test('o pointercancel acaba com o gesto, não com a ampliação', () => {
  const g = comPinca();
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));
  g.mover(dedo(2, 700, 200, 60));
  const fim = g.cancelar();
  assert.equal(fim.acao, 'zoom');
  assert.equal(fim.fase, 'fim');
  assert.equal(g.estado().zoom, 2, 'a ampliação fica');
  assert.equal(g.estado().zoomAtivo, null, 'o gesto não');
});

/* Sair da tela cheia com o vídeo ampliado deixaria a ficha com um pedaço de
 * imagem dentro de uma caixa de 211 px — e nenhum gesto à mão para desfazer,
 * porque fora da tela cheia a pinça é do navegador. */
test('sair da tela cheia zera a ampliação', () => {
  const g = comPinca();
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));
  g.mover(dedo(2, 700, 200, 60));
  g.subir(dedo(1, 300, 200, 100));
  g.subir(dedo(2, 700, 200, 110));
  assert.equal(g.estado().zoom, 2);
  g.permitirPinca(false);
  assert.equal(g.estado().zoom, 1);
  assert.equal(g.estado().zoomX, 0);
});

/* A tela bloqueada (item 9) deixa os gestos inertes, e a pinça entra nessa
 * conta: o bloqueio existe para o aparelho na mão, e ampliar sem querer é
 * exatamente o tipo de coisa de que ele protege. */
test('a tela bloqueada não amplia', () => {
  const g = comPinca();
  g.travar(true);
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));
  assert.equal(g.mover(dedo(2, 700, 200, 60)), null);
  assert.equal(g.estado().zoom, 1);
});

/* Girar o aparelho em tela cheia é a única coisa que muda o quadro sem passar
 * por um dedo. Com a imagem ampliada e encostada na borda, o quadro novo é
 * menor de um lado — e o deslocamento de antes passaria a mostrar faixa
 * preta. Quem repara é a própria remedida. */
test('girar o aparelho reapara a imagem ampliada contra o quadro novo', () => {
  const g = comPinca();
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));
  g.mover(dedo(2, 700, 200, 60));                    /* 2× */
  g.subir(dedo(1, 300, 200, 100));
  g.subir(dedo(2, 700, 200, 110));
  g.descer(dedo(3, 400, 200, 200));
  g.mover(dedo(3, 380, 200, 240));
  g.mover(dedo(3, -9999, 200, 280));                 /* até a borda */
  g.subir(dedo(3, -9999, 200, 320));
  assert.equal(g.estado().zoomX, -400, 'a folga do quadro deitado é 400 px');

  /* O aparelho girou: 400 × 800 com o mesmo vídeo. A imagem passa a medir
   * 400 × 200, e em 2× a folga cai para 200 px de cada lado. */
  g.medir({ largura: 400, altura: 800, duracao: 600, videoLargura: 800, videoAltura: 400 });
  assert.equal(g.estado().zoom, 2, 'girar não desfaz a ampliação');
  assert.equal(g.estado().zoomX, -200, 'o deslocamento velho mostraria faixa preta');
});

test('a remedida chega à tela, e o ouvinte da janela sai na saída da ficha', () => {
  assert.match(PLAYER_CODIGO, /raiz\.addEventListener\('resize', aoRedimensionar\)/);
  /* Um ouvinte por ficha visitada se acumularia, cada um remedindo o quadro de
   * uma ficha que não existe mais — a mesma lição dos ouvintes de tela cheia. */
  const destruir = PLAYER_CODIGO.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(destruir[1], /raiz\.removeEventListener\('resize', aoRedimensionar\)/);
});

/* ------------------------------------- o lado DOM da pinça, no arquivo --- */

test('quem liga a pinça é a tela cheia, e o navegador fica com o zoom da página', () => {
  assert.match(PLAYER_CODIGO, /gestos\.permitirPinca\(cheia\)/);
  /* Sair da tela cheia limpa a transformação na TELA, e não só na máquina. */
  assert.match(PLAYER_CODIGO, /if \(!cheia\) \{ definirZoom\(GTMP\.ZOOM_MIN, 0, 0\)/);

  const css = lerTexto(path.join(SITE, 'style.css'));
  /* A linha que ENTREGA a pinça ao navegador fora da tela cheia. Tirar
   * `pinch-zoom` daqui é tirar o zoom da página de cima do vídeo, e isso é
   * acessibilidade: quem precisa de letra maior no site inteiro perderia o
   * único jeito de conseguir. */
  assert.match(css, /\.pl \{[\s\S]{0,600}?touch-action: pan-y pinch-zoom;/);
  assert.match(css, /\.pl-cheia \{ touch-action: none; \}/);
});

test('a transformação do zoom escala primeiro e desloca depois', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  const regra = css.match(/\.pl-zoom \.pl-video \{([\s\S]*?)\}/);
  assert.ok(regra, 'não achei .pl-zoom .pl-video em style.css');
  /* A ordem não é gosto: `translate` por fora deixa o deslocamento em pixels
   * de TELA, que é a unidade em que o player-core faz a conta e limita o
   * arrasto. Invertida, a folga calculada lá viraria outro número aqui. */
  assert.match(regra[1], /transform:\s*translate\([^;]*?\)\s*scale\(var\(--pl-zoom/);
  assert.match(regra[1], /transform-origin: 50% 50%/);
  /* Compor uma camada nova custa, e quem nunca ampliou não paga — a mesma
   * disciplina do filtro de brilho e do grafo de som. */
  assert.match(PLAYER_CODIGO, /classList\.toggle\('pl-zoom', e !== GTMP\.ZOOM_MIN\)/);
});

/* ------------------------------------------------ item 9 — bloqueio de tela */

test('travado, nenhum gesto passa', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.travar(true);

  g.descer(dedo(1, 60, 300, 0));
  assert.equal(g.mover(dedo(1, 60, 100, 60)), null, 'nem o brilho');
  assert.equal(g.mover(dedo(1, 400, 100, 90)), null, 'nem a linha do tempo');
  assert.deepEqual(g.subir(dedo(1, 400, 100, 120)), { acao: 'avisoTravado' },
    'o toque só avisa que está travado');

  const dois = gestosDe();
  dois.travar(true);
  dois.descer(dedo(1, 300, 100, 0));
  dois.descer(dedo(2, 340, 100, 20));
  assert.equal(dois.subir(dedo(1, 300, 100, 150)), null, 'nem o capítulo');
});

test('o toque duplo é a única saída da tela travada', () => {
  const g = gestosDe();
  g.travar(true);
  g.descer(dedo(1, 180, 100, 1000));
  g.subir(dedo(1, 180, 100, 1060));
  assert.deepEqual(g.descer(dedo(2, 182, 102, 1200)), { acao: 'destravar' });
  /* E o `subir` desse toque não dá play/pause por cima do destravar. */
  assert.equal(g.subir(dedo(2, 182, 102, 1260)), null);
});

/* ------------------------------------------- o lado DOM, varrido no arquivo */

/* A promessa da fase, e a razão de a máquina existir: um gesto que pula 5 s
 * tem que pular pelo MESMO caminho que a seta pula. Sem isto o toque duplo
 * viraria um segundo lugar de onde o vídeo se move, com as próprias regras de
 * limite — e a REGRA 1 teria um segundo esconderijo. */
test('o gesto executa pelo mesmo caminho do teclado', () => {
  assert.match(PLAYER_CODIGO, /default: executar\(acao\); break;/,
    'as ações comuns do gesto precisam cair no executar() do teclado');
  const chamadas = PLAYER_CODIGO.match(/\.play\s*\(/g) || [];
  assert.equal(chamadas.length, 1,
    'a fase 5 abriu um segundo caminho para o play()');
});

/* Antes desta fase, play/pause no toque era um `click` no <video> — e com ele
 * um toque duplo na lateral disparava DOIS play/pause além do pulo de 5 s. */
test('play/pause no quadro é decisão da máquina, não um click no <video>', () => {
  assert.doesNotMatch(PLAYER_CODIGO, /video\.addEventListener\('click'/,
    'o click do <video> voltou e vai brigar com o toque duplo');
  assert.match(PLAYER_CODIGO, /caixa\.addEventListener\('pointerdown', function/);
});

/* O cuidado que a fase 4 deixou escrito para esta: o painel de som abre no
 * toque em aparelho sem ponteiro e ocupa o canto do quadro. `somCaixa` vive
 * dentro de `controles`, então a checagem de um cobre os dois. */
test('o gesto não dispara em cima dos controles nem do painel de som', () => {
  assert.match(PLAYER_CODIGO,
    /function foraDosControles\(ev\)[\s\S]{0,200}controles\.contains/);
  /* Há DOIS `pointerdown` no `caixa`: o que fecha o painel de som, da fase 4,
   * e o dos gestos. O da fase 4 vem primeiro no arquivo — pegar só o primeiro
   * daria um teste que passa sem provar nada. */
  const baixas = PLAYER_CODIGO.match(
    /caixa\.addEventListener\('pointerdown', function \(ev\) \{[\s\S]*?\n    \}\);/g) || [];
  assert.equal(baixas.length, 2, 'os dois pointerdown do quadro deveriam estar aqui');
  assert.ok(baixas.some((b) => /!foraDosControles\(ev\)\) return/.test(b)),
    'o pointerdown dos gestos precisa recusar o que começa nos controles');
});

test('os ouvintes de tela cheia e o relógio do segurar saem ao sair da ficha', () => {
  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(destruir, 'não achei destruir() em player.js');
  assert.match(destruir[1], /removeEventListener\('fullscreenchange', aoTrocarTelaCheia\)/);
  assert.match(destruir[1], /removeEventListener\('webkitfullscreenchange', aoTrocarTelaCheia\)/);
  assert.match(destruir[1], /cancelarSegurar\(\)/,
    'um setTimeout de meio segundo sobreviveria à saída da ficha');
});

test('quem liga o arrasto vertical é a tela cheia, e só ela', () => {
  assert.match(PLAYER_CODIGO, /gestos\.permitirVertical\(cheia\)/);
  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /\.pl \{[\s\S]{0,600}?touch-action: pan-y/,
    'sem pan-y a ficha não rola com o dedo no vídeo');
  assert.match(css, /\.pl-cheia \{ touch-action: none; \}/);
});

/* Aqui havia o teste de que o `filter` do brilho só entrava para quem tinha
 * mexido nele — a mesma disciplina do grafo de som da fase 4. O gesto saiu em
 * 09/09 e o teste foi com ele. O que guarda a AUSÊNCIA agora é "o filtro de
 * brilho saiu do CSS junto com o gesto", ao lado do teste das zonas de
 * arrasto vertical, que é onde o buraco que ele deixou está descrito. */

/* A lição de largura da fase 3, cobrada de novo: em 375 px os quatro botões e
 * o relógio comem 317 dos 349 px da linha. Um quinto botão a quebraria em
 * três — então ele só existe onde há largura, que é a tela cheia. */
test('o botão de bloqueio só aparece em tela cheia', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /\.pl-trava \{ display: none; \}/);
  assert.match(css, /\.pl-cheia \.pl-trava \{ display: inline-flex; \}/);
  /* A lição do `hidden` da fase 3: `display` do autor ganha do `hidden` do
   * navegador, e o cadeado nasce escondido. */
  assert.match(css, /\.pl-cadeado\[hidden\] \{ display: none; \}/);
});

/* ------------------------- as setas de capítulo (08/09) -------------------
 *
 * A decisão 1 da §5 do PROXIMA-SESSAO.md. O gesto de dois dedos e o
 * `Ctrl`+seta pulam capítulo desde as fases 3 e 5, e a §4.6 do plano já
 * avisava que ninguém descobre nenhum dos dois sozinho. O que faltava era o
 * caminho VISÍVEL, e é ele. */

test('as setas de capítulo só nascem para quem tem capítulo', () => {
  assert.match(PLAYER_JS, /var bCapAnt = caps\.length \? botao\('pl-b pl-cap-ant'/,
    'a seta da esquerda deveria depender de caps.length');
  assert.match(PLAYER_JS, /var bCapProx = caps\.length \? botao\('pl-b pl-cap-prox'/,
    'a seta da direita deveria depender de caps.length');

  /* Sem capítulo o DOM continua sendo o de antes desta entrega — relógio e
     barra soltos na linha, sem contêiner nenhum. É a promessa feita aos 27
     títulos sem capítulo, e ela vale para a ÁRVORE, não só para o desenho. */
  const montagem = PLAYER_JS.match(
    /if \(bCapAnt\) \{[\s\S]*?\} else \{([\s\S]*?)\n    \}/);
  assert.ok(montagem, 'não achei a montagem das setas em player.js');
  assert.match(montagem[1], /controles\.appendChild\(tempo\);/,
    'sem capítulo o relógio tem que entrar solto, como antes');
  assert.match(montagem[1], /controles\.appendChild\(barra\);/,
    'sem capítulo a barra tem que entrar solta, como antes');
});

/* O valor de ligar o botão na função que já existe: o recomeço do capítulo, os
 * recados de ponta ("Primeiro capítulo") e o "nunca chama play()" vêm de
 * graça. Um caminho próprio teria que reconquistar os três, e é assim que dois
 * botões passam a divergir do atalho de teclado que deveriam espelhar. */
test('as setas caem na mesma função do Ctrl+seta e do gesto', () => {
  assert.match(PLAYER_CODIGO, /bCapAnt\.addEventListener\('click', function \(\) \{ irParaCapitulo\(-1\); \}\)/);
  assert.match(PLAYER_CODIGO, /bCapProx\.addEventListener\('click', function \(\) \{ irParaCapitulo\(1\); \}\)/);

  /* E `irParaCapitulo` continua sendo quem NÃO liga o play: pular de capítulo
     num vídeo pausado deixa o vídeo pausado, como a lista clicável da ficha. */
  const corpo = PLAYER_JS.match(/function irParaCapitulo\(direcao\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(corpo, 'não achei irParaCapitulo em player.js');
  assert.ok(!/[^a-zA-Z]play\(\)/.test(corpo[1]), 'irParaCapitulo passou a ligar o play');
});

/* A lição de largura da fase 3, cobrada pela terceira vez — e agora com a
 * conta escrita, porque foi ela que decidiu o desenho.
 *
 * Em 375 px a linha do player tem 349 px, e com os 12 px de padding de cada
 * lado sobram 325 de conteúdo. As duas setas pediam 108 px onde havia 42,1
 * livres, e uma linha com sete botões soma 330,9 só de itens — mais do que a
 * linha inteira. A largura saiu do RELÓGIO, que sobe para a linha da barra. */
/* "Pular capítulo é uma função só, com duas direções" — o pedido de quem usa o
 * site, depois de ver as setas num Android (08/09). Duas setas separadas pelo
 * mesmo vão de todo o resto leem como dois botões sem parentesco.
 *
 * O contêiner não é enfeite: no celular a linha distribui a sobra ENTRE os
 * itens, e sem o par ser UM item as duas setas se afastariam exatamente onde
 * deviam se juntar. */
test('as duas setas são um item só da linha, e não dois', () => {
  const montagem = PLAYER_CODIGO.match(/if \(bCapAnt\) \{([\s\S]*?)\n      var tempoBarra/);
  assert.ok(montagem, 'não achei a montagem do par em player.js');
  assert.match(montagem[1], /criar\('div', 'pl-cap-par'\)/,
    'as setas deveriam entrar num contêiner delas');
  assert.match(montagem[1], /capPar\.appendChild\(bCapAnt\)/);
  assert.match(montagem[1], /capPar\.appendChild\(bCapProx\)/);
  assert.ok(!/controles\.appendChild\(bCapAnt\)/.test(montagem[1]),
    'a seta da esquerda ainda entra solta na linha — o par se desfaz no space-between');
  assert.ok(!/controles\.appendChild\(bCapProx\)/.test(montagem[1]),
    'a seta da direita ainda entra solta na linha — o par se desfaz no space-between');
});


test('a linha de 375 px cabe, com as setas e sem o relógio', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  const alvo = css.match(/\.pl-b \{[^}]*?width: (\d+)px/);
  assert.ok(alvo, 'não achei a largura do botão em .pl-b');
  const botao = Number(alvo[1]);
  assert.equal(botao, 44, 'o alvo de toque de 44 px é a medida de que a conta depende');

  const vao = css.match(/\.pl-controles \{[\s\S]*?gap: (\d+)px/);
  assert.ok(vao, 'não achei o vão de .pl-controles');
  const normal = Number(vao[1]);

  /* As duas setas são UM item da linha, não dois: elas moram num contêiner com
     o vão delas. Quem conta itens tem que contar assim, senão a conta abaixo
     descreve uma linha que não existe. */
  const vaoPar = css.match(/\.pl-cap-par \{[^}]*?gap: (\d+)px/);
  assert.ok(vaoPar, 'não achei o vão de dentro do par de capítulo');
  const par = 2 * botao + Number(vaoPar[1]);

  /* O par tem que ser MAIS APERTADO que a linha, senão ele não é um par — é
     isso que faz duas setas lerem como uma função só com duas direções. */
  assert.ok(Number(vaoPar[1]) < normal,
    'o vão de dentro do par (' + vaoPar[1] + ') não é menor que o da linha (' + normal + ')');

  const CONTEUDO = 349 - 12 - 12;          /* a linha em 375 px, menos o padding */
  const soma = (itens, largura, g) => largura + (itens - 1) * g;

  /* Fora da tela cheia, com capítulo: play, o PAR, CC, som e cheia — cinco
     itens, seis botões. */
  const fora = soma(5, botao * 4 + par, normal);
  assert.ok(fora <= CONTEUDO,
    'a linha de fora da tela cheia não cabe em ' + CONTEUDO + ' px: ' + fora);

  /* Dentro dela entra o cadeado: seis itens, sete botões. Em pé não há 10 px
     de vão para eles — e não havia antes desta entrega tampouco: a linha já
     quebrava em três, com a tela cheia sozinha no terceiro andar (medido em
     08/09: os controles iam de 88 px de altura para 134). */
  const vaoCheia = css.match(/\.pl-cheia \.pl-controles \{ column-gap: (\d+)px; \}/);
  assert.ok(vaoCheia, 'não achei o piso do vão da tela cheia em retrato');
  const cheia = soma(6, botao * 5 + par, Number(vaoCheia[1]));
  assert.ok(cheia <= CONTEUDO,
    'a linha da tela cheia não cabe em ' + CONTEUDO + ' px: ' + cheia);

  /* E a prova de que o piso apertado é NECESSÁRIO: com o vão normal, a linha
     da tela cheia não caberia. Se um dia couber, ele virou enfeite e sai. */
  assert.ok(soma(6, botao * 5 + par, normal) > CONTEUDO,
    'a tela cheia passou a caber com o vão normal — o column-gap de 2 px não serve mais para nada');

  /* O 2 px é PISO, não medida final. Sem isto a sobra de um aparelho mais
     largo — 68 px num Android de 412 px em tela cheia — ia toda para um vazio
     à direita, do tamanho de um botão. Foi o que se viu no aparelho em 08/09. */
  const blocos = css.match(/@media \(max-width: 700px\) \{[\s\S]*?\n\}/g) || [];
  const celular = blocos.find((b) => b.includes('.pl-controles {'));
  assert.ok(celular, 'não achei o bloco de celular dos controles');
  assert.match(celular, /\.pl-controles \{ justify-content: space-between; \}/,
    'sem distribuir a sobra, a linha amontoa os botões à esquerda em toda tela maior que 375 px');
});

/* O contêiner do relógio + barra é o que faz os dois subirem JUNTOS no
 * celular. Sem a segunda regra, o `flex-basis: 100%` que a fase 3 pôs na barra
 * é herdado dentro dele, o relógio vai para uma linha e a barra para outra —
 * três linhas, que é exatamente o que a fase 3 evitou. */
test('no celular o relógio sobe junto com a barra, e não sozinho', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  /* Há mais de um `@media (max-width: 700px)` no arquivo — a legenda tem o
     dela. O que interessa é o bloco em que os CONTROLES moram. */
  const blocos = css.match(/@media \(max-width: 700px\) \{[\s\S]*?\n\}/g) || [];
  const celular = blocos.find((b) => b.includes('.pl-controles {'));
  assert.ok(celular, 'não achei o bloco de celular dos controles');
  assert.match(celular, /\.pl-tempo-barra \{ order: -1; flex-basis: 100%; \}/);
  assert.match(celular, /\.pl-tempo-barra \.pl-barra \{ order: 0; flex-basis: auto; \}/,
    'sem devolver a barra ao normal dentro do contêiner, ela empurra o relógio para outra linha');

  /* E o contêiner precisa poder encolher: um filho de flex não vai abaixo do
     conteúdo sem `min-width: 0`, e a barra não tem largura de conteúdo. */
  assert.match(css, /\.pl-tempo-barra \{[\s\S]*?min-width: 0;/);
});

/* ---------------------------------- item 6, o scrubber (fase 6, 03/09) ---
 *
 * Não existe storyboard no Bunny — são 5 quadros por vídeo, tanto num de 10
 * minutos quanto num de 27. O quadro sai de um SEGUNDO <video> apontando para
 * o `play_240p.mp4` que já está no ar, com `Accept-Ranges` e CORS: o caminho
 * "barato" da §4.5 do plano, zero infraestrutura nova. */
test('a prévia do arrasto sai do 240p, e nada é baixado antes de alguém arrastar', () => {
  assert.match(PLAYER_CODIGO, /GTMP\.urlMp4\(fonte, config, '240p'\)/,
    'a prévia tem que sair da menor resolução — o arquivo inteiro tem 51 MB');

  /* O `src` só entra em `ligarPrevia`, e `ligarPrevia` só é chamada de
   * `pedirQuadro`, que só roda dentro de um arrasto. Quem abre a ficha para
   * ler a sinopse não baixa quadro nenhum — a mesma disciplina do vídeo
   * principal e da legenda. */
  const ligar = PLAYER_CODIGO.match(/function ligarPrevia\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(ligar, 'não achei ligarPrevia em player.js');
  assert.match(ligar[1], /previaQuadro\.src = urlPrevia/);
  const usosDoSrc = PLAYER_CODIGO.match(/previaQuadro\.src\s*=/g) || [];
  assert.equal(usosDoSrc.length, 1, 'o src da prévia é posto num lugar só, no primeiro arrasto');

  /* `metadata`, não `auto`: o que se quer é a régua do tempo. Os bytes de cada
   * quadro vêm por faixa, quando o dedo pede. */
  assert.match(PLAYER_CODIGO, /previaQuadro\.preload = 'metadata'/);

  /* E ela nunca toca — a REGRA 1 continua com um dono só. */
  const chamadas = PLAYER_CODIGO.match(/\.play\s*\(/g) || [];
  assert.equal(chamadas.length, 1, 'a prévia virou um segundo caminho para o play()');
});

/* A fila tem UM lugar. O dedo pede um segundo diferente a cada quadro da tela,
 * e enfileirar isso faria a prévia correr atrás do dedo, cada vez mais
 * atrasada — em vez de mostrar o quadro mais recente que deu tempo de buscar. */
test('a prévia guarda só o último pedido, nunca uma fila', () => {
  const pedir = PLAYER_CODIGO.match(/function pedirQuadro\(segundos\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(pedir, 'não achei pedirQuadro em player.js');
  assert.match(pedir[1], /previa\.pedido = GTMP\.limitarTempo/,
    'o pedido é substituído, não empilhado');
  assert.match(pedir[1], /if \(!previa\.ocupado\) servirQuadro\(\)/);
  assert.ok(!/push|shift|concat/.test(pedir[1]), 'apareceu uma fila onde só cabe um pedido');
});

/* Um SEGUNDO elemento de mídia por ficha. Ele morre com o mesmo rigor do
 * primeiro: sem tirar o src e chamar load(), a faixa de bytes em andamento
 * continuaria vindo da pull zone para uma ficha que já saiu da tela. */
test('a prévia é destruída ao sair da ficha, como o hls.js e o AudioContext', () => {
  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(destruir, 'não achei destruir() em player.js');
  assert.match(destruir[1], /previaQuadro\.removeAttribute\('src'\)/);
  assert.match(destruir[1], /previaQuadro\.load\(\)/);
  assert.match(destruir[1], /previa\.morto = true/);
});

/* Pedido depois do teste no dedo, em 03/09: arrastando na horizontal a mão
 * cobre o meio e a metade de baixo do quadro, e na barra ela cobre justamente
 * a dica que a fase 3 desenhou logo acima dela. */
test('a prévia fica no canto superior esquerdo, onde a mão não cobre', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  const caixa = css.match(/\n\.pl-previa \{([\s\S]*?)\n\}/);
  assert.ok(caixa, 'não achei .pl-previa em style.css');
  assert.match(caixa[1], /left: 12px; top: 12px/,
    'a prévia saiu do canto de cima e vai ficar embaixo do dedo');
  /* O mesmo canto do selo, e é de propósito: durante o arrasto quem fala é a
   * moldura, que já mostra o relógio. Por isso ela apaga o selo ao aparecer. */
  const selo = css.match(/\n\.pl-selo \{([\s\S]*?)\n\}/);
  assert.match(selo[1], /left: 12px; top: 12px/);
  const mostrar = PLAYER_CODIGO.match(/function mostrarPrevia\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(mostrar, 'não achei mostrarPrevia em player.js');
  assert.match(mostrar[1], /esconderSelo\(\)/, 'a moldura e o selo apareceriam um por cima do outro');
  assert.match(css, /\.pl-previa\[hidden\] \{ display: none; \}/);

  /* A moldura cresceu em 03/09 e passou a encostar na linha de controles: num
   * quadro embutido de 195 px de altura ela ocupa 152. Em vez de encolher de
   * novo, os BOTÕES desbotam enquanto se procura — mas a BARRA não, porque ela
   * é a única coisa que mostra para onde o ponteiro do vídeo está indo. */
  assert.match(css, /\.pl-procurando \.pl-b,/);
  const procurando = css.match(/\.pl-procurando[\s\S]*?\n\}/);
  assert.ok(procurando, 'não achei a regra de .pl-procurando');
  assert.ok(!/\.pl-procurando \.pl-barra/.test(css),
    'a barra não pode desbotar durante a busca: é o único retorno de posição');
  assert.match(mostrar[1], /classList\.add\('pl-procurando'\)/);
  const esconder = PLAYER_CODIGO.match(/function esconderPrevia\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(esconder, 'não achei esconderPrevia em player.js');
  assert.match(esconder[1], /classList\.remove\('pl-procurando'\)/,
    'sem isto os botões ficariam apagados depois do arrasto');
});

/* Os DOIS arrastos horizontais mostram o quadro: o do quadro (item 11) e o da
 * barra. A moldura do CANTO é a do dedo, e ela continua vindo só no arrasto. */
test('a prévia do canto aparece nos dois arrastos, nunca ao passar o ponteiro', () => {
  const mover = PLAYER_CODIGO.match(/function aoMover\(ev\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(mover, 'não achei aoMover em player.js');
  const posGuarda = mover[1].indexOf("pl-barra-ativa'))");
  const posPrevia = mover[1].indexOf('mostrarPrevia');
  assert.ok(posGuarda >= 0 && posPrevia > posGuarda,
    'a moldura do canto precisa vir DEPOIS da guarda de arrasto ativo');

  const arrasto = PLAYER_CODIGO.match(/function aplicarArrasto\(a\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(arrasto, 'não achei aplicarArrasto em player.js');
  assert.match(arrasto[1], /mostrarPrevia\(alvo, delta, a\.descarte\)/);
  assert.match(arrasto[1], /esconderPrevia\(\)/, 'a moldura tem que sair quando o dedo solta');
});

/* ------------- o quadro ao passar o ponteiro na barra (04/09) ----------- */

/* O que segurava o hover fora da fase 6 era o mouse a CAMINHO do botão de
 * play, que fica a 20 px da barra: um MP4 baixado por engano a cada vez que
 * alguém vai apertar play. Quem resolve isso é a espera, não uma proibição —
 * o primeiro quadro só é pedido depois dela, e atravessar a barra não custa
 * byte nenhum. */
test('o quadro no hover só é pedido depois da espera, e nunca de imediato', () => {
  assert.match(PLAYER_CODIGO, /var QUADRO_HOVER_MS = 300;/);
  const agendar = PLAYER_CODIGO.match(/function agendarQuadroHover\(t\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(agendar, 'não achei agendarQuadroHover em player.js');
  const posTimeout = agendar[1].indexOf('setTimeout');
  const posPedido = agendar[1].indexOf('pedirQuadro');
  assert.ok(posTimeout >= 0 && posPedido > posTimeout,
    'o primeiro quadro do hover não pode sair antes da espera');
  assert.match(agendar[1], /QUADRO_HOVER_MS/);
  /* Um relógio por vez: o segundo pedido dentro da janela só troca o alvo. É a
   * mesma disciplina da fila da prévia, que também guarda um lugar só. */
  assert.match(agendar[1], /if \(quadroHover\.espera\) return;/);
  assert.match(agendar[1], /quadroHover\.alvo = t;/);
  assert.ok(!/push|concat/.test(agendar[1]), 'apareceu fila onde só cabe o último alvo');

  const mover = PLAYER_CODIGO.match(/function aoMover\(ev\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(mover[1], /if \(mouse\) agendarQuadroHover\(/,
    'sem isto o hover não pede quadro nenhum');
});

/* O relógio tem que morrer duas vezes: quando o ponteiro sai da barra e quando
 * a ficha sai da tela. O segundo é a armadilha conhecida — um `setTimeout` que
 * acorda depois da saída pediria quadro a um <video> já destruído. */
test('o relógio do hover morre com o ponteiro e com a ficha', () => {
  const esconder = PLAYER_CODIGO.match(/function esconderDica\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(esconder, 'não achei esconderDica em player.js');
  assert.match(esconder[1], /cancelarQuadroHover\(\)/);
  /* E a moldura sai junto — menos no meio de um arrasto, quando o ponteiro
   * sai da barra o tempo todo por causa do `setPointerCapture`. */
  assert.match(esconder[1],
    /if \(!barra\.classList\.contains\('pl-barra-ativa'\)\) esconderPrevia\(\)/);

  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(destruir[1], /cancelarQuadroHover\(\)/);

  const agendar = PLAYER_CODIGO.match(/function agendarQuadroHover\(t\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(agendar[1], /if \(destruido \|\| !sobreABarra\) return;/,
    'o relógio precisa conferir, ao acordar, se ainda faz sentido pedir');
});

/* A moldura tem DOIS lugares, e cada um tem o seu motivo: o canto é do DEDO,
 * porque a mão cobre a barra; em cima da barra é do MOUSE, que não cobre nada.
 * Trocar de lugar tem que desfazer o outro — o `left`/`bottom` em linha são do
 * modo sobre a barra, e um resto deles deslocaria a moldura do canto. */
test('a moldura volta para o canto quando o dedo assume', () => {
  const canto = PLAYER_CODIGO.match(/function previaNoCanto\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(canto, 'não achei previaNoCanto em player.js');
  assert.match(canto[1], /classList\.remove\('pl-previa-barra'\)/);
  assert.match(canto[1], /style\.left = ''/);
  assert.match(canto[1], /style\.bottom = ''/);

  const mostrar = PLAYER_CODIGO.match(/function mostrarPrevia\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(mostrar[1], /previaNoCanto\(\)/, 'o arrasto do dedo tem que trazer a moldura de volta');
  const esconderP = PLAYER_CODIGO.match(/function esconderPrevia\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(esconderP[1], /previaNoCanto\(\)/);

  /* E o CSS desfaz a âncora do canto: sem `top: auto` o `top: 12px` da regra
   * de cima ganharia do `bottom` em linha, e a moldura ficaria no alto. */
  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /\.pl-previa-barra \{ top: auto; \}/);
});

/* Com o mouse a moldura já diz capítulo e relógio: deixar a dica de texto
 * junto seria a mesma informação duas vezes, uma por cima da outra. E sem o
 * 240p — ou depois de ele falhar — a dica volta a ser o caminho, e o hover
 * fica igual ao de antes de hoje. */
test('a moldura sobre a barra substitui a dica, e a dica é a reserva', () => {
  const sobre = PLAYER_CODIGO.match(/function previaSobreBarra\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(sobre, 'não achei previaSobreBarra em player.js');
  assert.match(sobre[1], /dica\.hidden = true/);
  assert.match(sobre[1], /GTMP\.posicaoDica\(/, 'a moldura é aparada pela borda da barra, como a dica');

  const mDica = PLAYER_CODIGO.match(/function moverDica\(clientX, mouse\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(mDica, 'não achei moverDica em player.js');
  assert.match(mDica[1], /if \(mouse && urlPrevia && !previa\.morto\)/,
    'no dedo, e sem o 240p, quem aparece é a dica de texto');
});

/* O ajuste do /admin tem um caminho inteiro para percorrer — KV, API, grade,
 * player — e ele quebra em silêncio em qualquer um dos elos. O elo mais fácil
 * de errar é o primeiro: `config` vem do AMBIENTE e o PUT o descarta, então um
 * ajuste guardado ali se apagaria na gravação seguinte, sem erro nenhum. */
test('o ajuste do player mora no catálogo, não no config do ambiente', () => {
  const api = lerTexto(path.join(SITE, 'functions', 'api', 'catalogo.js'));

  /* O PUT continua apagando o config — e não pode apagar os ajustes. */
  assert.match(api, /delete novo\.config;/);
  assert.ok(!/delete novo\.ajustes/.test(api),
    'o PUT está apagando os ajustes: eles não sobreviveriam a uma gravação');

  /* E a resposta pública leva os ajustes: campo que não sai por aqui não
   * existe para o navegador. É a mesma armadilha que já tinha sumido com a
   * lista de capítulos uma vez. */
  const get = api.match(/export async function onRequestGet[\s\S]*?\n\}/);
  assert.ok(get, 'não achei o GET em catalogo.js');
  assert.match(get[0], /ajustes: ajustes\(guardado\)/);

  /* A grade repassa ao player. */
  const app = lerTexto(path.join(SITE, 'app.js'));
  assert.match(app, /ajustes: dados\.ajustes \|\| \{\}/);
  assert.match(PLAYER_CODIGO, /config\.ajustes\) \? config\.ajustes\.arrastoTeto/);

  /* E o player entrega a duração junto — sem ela o teto não tem de onde sair. */
  const medir = PLAYER_CODIGO.match(/function medirQuadro\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(medir, 'não achei medirQuadro em player.js');
  assert.match(medir[1], /duracao: duracao\(\)/);
  assert.match(medir[1], /fracaoTeto: fracaoTeto/);
});

test('o /admin tem onde ajustar o teto, e só grava o que está na faixa', () => {
  const html = lerTexto(path.join(SITE, 'admin.html'));
  assert.match(html, /id="aba-ajustes"/);
  assert.match(html, /id="a-teto"/);

  const admin = lerTexto(path.join(SITE, 'admin.js'));
  /* Grava a FRAÇÃO, não a porcentagem: a tela fala em % porque é o que se lê,
   * e o player-core trabalha em fração. Trocar isso silenciosamente faria o
   * teto valer 40 vezes o vídeo. */
  assert.match(admin, /arrastoTeto: Math\.round\(pct\) \/ 100/);
  assert.match(admin, /pct < 5 \|\| pct > 100/);
  /* E passa pelo mesmo salvarCatalogo de todo o resto — ler, alterar, gravar,
   * com o `rev` do servidor. Duas telas abertas não se sobrescrevem. */
  const salvar = admin.match(/\$\('a-salvar'\)\.addEventListener[\s\S]*?\n  \}\);/);
  assert.ok(salvar, 'não achei o botão de salvar dos ajustes');
  assert.match(salvar[0], /salvarCatalogo\(/);
});

/* ------------------- o sumiço dos controles (03/09) --------------------- */

/* Cada recusa aqui é um jeito de o player parecer quebrado. Elas moram no
 * core, e não no player.js, exatamente porque são fáceis de esquecer uma. */
test('os controles não somem quando sumir seria um defeito', () => {
  const base = { tocando: true, painelAberto: false, arrastando: false, focoDentro: false };
  assert.equal(GTMP.podeEsconderControles(base), true, 'tocando e quieto: somem');

  assert.equal(GTMP.podeEsconderControles({ ...base, tocando: false }), false,
    'vídeo parado com controle sumido é a tela morta — e quem pausou pausou para mexer');
  assert.equal(GTMP.podeEsconderControles({ ...base, painelAberto: true }), false,
    'o painel de som pendura no botão de mudo: sumir levaria o painel junto');
  assert.equal(GTMP.podeEsconderControles({ ...base, arrastando: true }), false,
    'a barra é o retorno de posição no meio do arrasto');
  assert.equal(GTMP.podeEsconderControles({ ...base, focoDentro: true }), false,
    'foco preso num controle invisível é o pior resultado para quem usa teclado');

  assert.equal(GTMP.podeEsconderControles(), false, 'sem estado, não some');
});

/* A armadilha desta entrega, e ela é silenciosa: `Number(null)` é ZERO, e zero
 * aqui quer dizer "nunca some". Um catálogo sem o ajuste — o estado de todo
 * catálogo até alguém abrir o /admin — desligaria o sumiço, e o padrão de 3 s
 * nunca valeria para ninguém. */
test('"não configurado" não pode virar "nunca some"', () => {
  assert.equal(GTMP.SUMICO_PADRAO_S, 3);
  for (const vazio of [null, undefined, '']) {
    assert.equal(GTMP.segundosDeSumico(vazio), 3, 'valor vazio: ' + JSON.stringify(vazio));
  }
  /* Mas o zero escrito de propósito continua valendo. */
  assert.equal(GTMP.segundosDeSumico(0), 0);
  assert.equal(GTMP.segundosDeSumico('0'), 0);

  assert.equal(GTMP.segundosDeSumico(5), 5);
  assert.equal(GTMP.segundosDeSumico(-2), 3, 'negativo não é escolha');
  assert.equal(GTMP.segundosDeSumico('tarde'), 3);
  assert.equal(GTMP.segundosDeSumico(9000), GTMP.SUMICO_MAX_S);
});

test('o sumiço volta ao primeiro sinal de vida, e o teclado é um deles', () => {
  /* `opacity` e não `display: none`: o Tab ainda chega aos controles, e o
   * `focusin` os traz de volta antes de o foco pousar num botão invisível. */
  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /\.pl-sem-controles \.pl-controles \{ opacity: 0; pointer-events: none; \}/);
  assert.ok(!/\.pl-sem-controles \.pl-controles \{[^}]*display: none/.test(css),
    'display:none tiraria os controles do alcance do Tab');

  assert.match(PLAYER_CODIGO, /controles\.addEventListener\('focusin', acordarControles\)/);
  const teclar = PLAYER_CODIGO.match(/function aoTeclar\(ev\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(teclar, 'não achei aoTeclar em player.js');
  assert.match(teclar[1], /acordarControles\(\)/, 'apertar L sem ver a barra andar parece tecla morta');

  /* E o relógio morre com a ficha, como todos os outros. */
  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(destruir[1], /cancelarSumico\(\)/);
});

test('soltar o dedo devolve a velocidade que estava, não 1×', () => {
  const corpo = PLAYER_JS.match(/function velocidadeTemporaria\(ligada\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(corpo, 'não achei velocidadeTemporaria em player.js');
  assert.match(corpo[1], /velocidadeAntes = video\.playbackRate \|\| 1/,
    'quem estava em 1,5× pelo Shift+> tem que voltar para 1,5×');
  assert.match(corpo[1], /video\.playbackRate = velocidadeAntes/);
  assert.match(corpo[1], /video\.paused\) return/,
    'segurar num vídeo parado não é 2× de nada');
});

/* O item 3 depende de o navegador não roubar o gesto: no Android o menu de
 * contexto, no iOS a lupa e o "copiar". E o menu nativo do <video> oferece
 * "repetir" e "baixar" — a REGRA 2 e a pull zone. */
test('o menu de contexto do vídeo fica fora do caminho do segurar', () => {
  assert.match(PLAYER_CODIGO, /addEventListener\('contextmenu'/);
  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /-webkit-touch-callout: none/);
  assert.match(css, /user-select: none/);
});

/* --------------- o painel de som encostado no ícone (04/09) ------------- */

/* Defeito relatado no uso: o painel fechava na cara de quem ia mexer no
 * volume. A causa era geometria — ele nascia ACIMA do botão, com 8 px de
 * respiro entre os dois, e esses 8 px não pertencem a `somCaixa` nem a filho
 * nenhum dela: o ponteiro que subisse do alto-falante até o controle
 * deslizante atravessava um vão que dispara `pointerleave`.
 *
 * Agora ele cresce para a ESQUERDA a partir da borda do botão, com o controle
 * deitado na mesma altura do ícone: o caminho do ponteiro é uma reta de 0 px
 * de espaço vazio. */
test('o painel de som encosta no ícone — vão nenhum entre os dois', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  const painel = css.match(/\n\.pl-som \{([\s\S]*?)\n\}/);
  assert.ok(painel, 'não achei .pl-som em style.css');
  assert.match(painel[1], /right: 100%/,
    'o painel precisa encostar na borda do botão, sem vão');
  assert.ok(!/bottom: calc\(100% \+ \d+px\)/.test(painel[1]),
    'voltou o respiro entre o botão e o painel: é por ali que o ponteiro escapa');

  /* Os 9 px de baixo são medida, não gosto: o botão tem 44 px de altura e a
   * linha do volume, 26. (44 − 26) / 2 = 9 é o que põe o controle deslizante
   * no meio do ícone. Mexer num dos três números sem os outros desalinha. */
  assert.match(painel[1], /padding: 10px 12px 9px/);
  assert.match(css, /\.pl-b \{\n\s*flex: none; width: 44px; height: 44px;/);
  assert.match(css, /\.pl-som-faixa \{[^}]*height: 26px/);
});

/* E a ORDEM das linhas é geometria também: o CSS ancora o painel pelo pé, e
 * por isso a linha do volume é a ÚLTIMA — é ela que fica ao lado do ícone. O
 * "Volume estável" empilha logo ACIMA dela, que é onde foi pedido. */
test('o Volume estável fica acima do controle deslizante', () => {
  const pos = (nome) => PLAYER_CODIGO.indexOf('painel.appendChild(' + nome + ')');
  assert.ok(pos('linhaVol') > 0 && pos('rotEstavel') > 0 && pos('recadoSom') > 0,
    'não achei as três linhas do painel em player.js');
  assert.ok(pos('rotEstavel') < pos('linhaVol'),
    'o Volume estável tem que ser desenhado ANTES da linha do volume, para ficar acima dela');
  assert.ok(pos('recadoSom') < pos('rotEstavel'),
    'o recado sobe para o topo: a linha do volume é a que se alinha ao ícone');
});

/* Defeito relatado no uso, um dia depois: hover no alto-falante abre o painel,
 * um CLIQUE dentro dele (a caixinha, o Mudo, o controle deslizante) e o painel
 * não fechava mais ao tirar o mouse. Sem clique fechava; com clique, não.
 *
 * A causa era a guarda do teclado: `document.activeElement` fica no controle
 * clicado, e a linha que protegia quem chega pelo Tab passou a proteger também
 * quem só clicou. `:focus-visible` separa os dois — é o próprio navegador
 * dizendo se aquele foco merece anel, e ele responde `false` para o clique.
 * Conferido no navegador em 04/09, nos dois sentidos. */
test('o painel de som fecha ao sair, mesmo depois de um clique dentro dele', () => {
  const sai = PLAYER_CODIGO.match(
    /somCaixa\.addEventListener\('pointerleave'[\s\S]*?\n    \}\);/);
  assert.ok(sai, 'não achei o pointerleave do painel de som');
  assert.ok(!/painel\.contains\(document\.activeElement\)\) return/.test(sai[0]),
    'a guarda voltou a segurar QUALQUER foco: um clique no controle deixa o painel aberto');
  assert.match(sai[0], /focoDeTecladoNoPainel\(\)\) return/);

  /* Botão apertado é arrasto em curso. O `pointerleave` chega mesmo com
   * `buttons: 1` — medido —, e sem esta guarda o arrasto do volume morreria
   * pela metade toda vez que a mão transbordasse os 26 px da linha. */
  assert.match(sai[0], /if \(ev\.buttons\) return/,
    'sem isto o arrasto do volume morre ao transbordar o painel');

  const foco = PLAYER_CODIGO.match(
    /function focoDeTecladoNoPainel\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(foco, 'não achei focoDeTecladoNoPainel em player.js');
  assert.match(foco[1], /querySelector\(':focus-visible'\)/);
  /* E a reserva é a linha antiga, para navegador sem `:focus-visible`: ela erra
   * para o lado de não arrancar o painel de quem está no teclado. */
  assert.match(foco[1], /catch[\s\S]*painel\.contains\(document\.activeElement\)/);
});

/* ---------- titularidade e evidência saem da ficha (04/09) -------------- */

/* São classificação interna — quem responde pela obra e o quanto a origem foi
 * conferida —, e servem a quem cataloga, não a quem vai assistir. Saíram
 * também da projeção pública: campo que o site não desenha não precisa
 * viajar. O /admin continua com as duas, lendo o item cru por `?completo=1`. */
test('titularidade e evidência só existem no /admin', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  assert.ok(!/linhaDados\(dl, 'Titularidade'/.test(app), 'a ficha voltou a mostrar titularidade');
  assert.ok(!/linhaDados\(dl, 'Evid/.test(app), 'a ficha voltou a mostrar o nível de evidência');

  const api = semComentarios(
    lerTexto(path.join(SITE, 'functions', 'api', 'catalogo.js')));
  const publico = api.match(/function paraPublico\(item\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(publico, 'não achei paraPublico em catalogo.js');
  assert.ok(!/titularidade|nivel_evidencia/.test(publico[1]),
    'os dois campos voltaram para a resposta pública');

  /* E o /admin não perdeu nada: o formulário continua lá, e ele lê o catálogo
   * inteiro, não a projeção. */
  const admin = lerTexto(path.join(SITE, 'admin.html'));
  assert.match(admin, /id="m-titularidade"/);
  assert.match(admin, /id="m-evidencia"/);
  assert.match(lerTexto(path.join(SITE, 'admin.js')), /\/api\/catalogo\?completo=1/);
});

/* ============================ segredos ================================== */

test('a AccessKey do Bunny não aparece em nenhum arquivo servido ao navegador', () => {
  const servidos = ['app.js', 'admin.js', 'catalogo-core.js', 'player.js', 'player-core.js',
    'index.html', 'admin.html'];
  const guid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  for (const arquivo of servidos) {
    const conteudo = lerTexto(path.join(SITE, arquivo));
    /* Citar a AccessKey num comentário é permitido; usá-la como header ou
     * variável, não. O que a busca procura é o uso, e a chave literal. */
    assert.ok(!/AccessKey\s*[:=]/.test(conteudo), arquivo + ' usa AccessKey como header/variável');
    assert.ok(!/BUNNY_API_KEY/.test(conteudo), arquivo + ' menciona BUNNY_API_KEY');
    assert.ok(!guid.test(conteudo), arquivo + ' contém um literal com cara de chave do Bunny');
  }
});

/* ============================ capa: um arquivo, dois fregueses ========== */

/* Armadilha de 08/09, ao encolher as capas: a §5.5 mediu a caixa do CARTÃO
 * (180 px no celular, 321 no computador) e concluiu que 360-400 px bastavam.
 * A mesma URL é o `poster` do player, num quadro de 881 px — a 400 px ele
 * subiria 2,2x. Este teste existe para que a próxima pessoa que for mexer no
 * tamanho da capa ESBARRE no segundo freguês antes de escolher o número. */
test('a capa também é o poster do player — quem encolher a capa mexe nos dois', () => {
  const player = lerTexto(path.join(SITE, 'player.js'));
  assert.match(player, /\.poster\s*=/,
    'player.js não define poster nenhum — se isso saiu de propósito, tire este teste junto');
  assert.match(player, /GTM\.urlCapa\(/,
    'o poster do player tem que sair de GTM.urlCapa, o mesmo lugar que a grade usa');

  const app = lerTexto(path.join(SITE, 'app.js'));
  assert.match(app, /GTM\.urlCapa\(/, 'a grade também tem que passar por urlCapa');
});

/* ============================ a curadoria do repositório aberto ========= */

/* Uma das DUAS travas da §3.2. A outra é o `.gitignore` do repositório ABERTO,
 * que não está nesta árvore e por isso nenhum teste daqui alcança — quem
 * confere as duas juntas é o ensaio do espelho-publico.mjs. O que dá para
 * guardar aqui é que a lista não perdeu a linha, e que ela casa com o nome da
 * pasta LETRA POR LETRA: o espaço no meio é a parte que erra sozinha. */
test('toda pasta interna na raiz está na lista PROIBIDOS do espelho', () => {
  const raiz = path.join(__dirname, '..', '..');
  const espelho = lerTexto(
    path.join(__dirname, '..', 'scripts', 'espelho-publico.mjs'));
  const bloco = espelho.match(/const PROIBIDOS = \[([\s\S]*?)\n\];/);
  assert.ok(bloco, 'não achei a lista PROIBIDOS em espelho-publico.mjs');
  const proibidos = [...bloco[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

  /* Derivado do disco, não escrito à mão: se a pasta for renomeada, é o nome
   * novo que a lista passa a dever. */
  for (const nome of ['briefing visual', 'inventario', 'apresentacao']) {
    if (!fs.existsSync(path.join(raiz, nome))) continue;
    assert.ok(proibidos.includes(nome + '/'),
      'a pasta "' + nome + '" existe na raiz e NÃO está em PROIBIDOS — ' +
      'ela sairia no snapshot se o .gitignore de lá também esquecesse dela');
  }
});

/* ------------------- a trava do CRLF (09/09) ---------------------------- */

/* CUSTOU UMA INVESTIGAÇÃO, e o defeito estava no ar no repositório ABERTO.
 *
 * A árvore de trabalho no Windows é CRLF (`core.autocrlf=true`) e o
 * repositório guarda LF. Um regex que atravessa uma quebra de linha —
 * `/\.pl-b \{\n\s*flex: none/` — casa contra o blob e FALHA contra o arquivo
 * do disco, onde há um `\r` antes do `\n`. O teste do painel de som estava
 * assim: **verde no CI (Linux, LF) e vermelho em todo clone Windows**, do lado
 * de cá e do lado de lá, onde o README promete que os testes rodam.
 *
 * Ele nunca apareceu aqui porque as leituras dos arquivos servidos vinham de
 * uma árvore que, por acaso, estava em LF. É a armadilha clássica desta
 * plataforma vista pelo avesso: em vez de acusar formatação onde não há, ela
 * ESCONDE um teste quebrado.
 *
 * O conserto foi normalizar na LEITURA (`lerTexto`), o que mata a classe
 * inteira em vez de cada regex. Este teste guarda a porta: um
 * `fs.readFileSync` cru reabre o buraco, e a próxima pessoa que precisar ler
 * um arquivo vai copiar a linha de cima. */
test('todo arquivo lido nos testes passa pelo lerTexto — CRLF não pode decidir nada', () => {
  const eu = lerTexto(__filename);
  /* A definição do helper e a menção dele nos comentários são as únicas
   * ocorrências permitidas: uma é o próprio conserto, a outra o explica. */
  const crus = eu.split('\n')
    .map((linha, i) => ({ linha, n: i + 1 }))
    .filter(({ linha }) => /fs\.readFileSync\(/.test(linha))
    .filter(({ linha }) => !/^const lerTexto =/.test(linha.trim()))
    .filter(({ linha }) => !/^\s*\*/.test(linha));

  assert.deepEqual(crus, [],
    'leitura crua de arquivo nos testes: use lerTexto(), senão um regex com \\n ' +
    'passa no CI em Linux e reprova em qualquer clone Windows');
});
