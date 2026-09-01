/* Testes das regras que o produto não pode perder. Rodar com:
 *     node --test tests/
 * Sem dependências: só o test runner embutido do Node.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GTM = require('../site/catalogo-core.js');
const SITE = path.join(__dirname, '..', 'site');

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
  for (const arquivo of ['app.js', 'admin.js']) {
    const fonteJs = fs.readFileSync(path.join(SITE, arquivo), 'utf8');
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
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  const m = html.match(/<meta\s+name="referrer"\s+content="([^"]*)"/);
  assert.ok(m, 'index.html precisa declarar uma política de referrer');
  assert.notEqual(m[1], 'no-referrer', 'no-referrer faz a pull zone do Bunny responder 403');
  assert.notEqual(m[1], 'same-origin', 'same-origin também não manda Referer para o Bunny');
});

/* Bug real, achado no piloto: voltar para a grade pelo botão do navegador
 * escondia a ficha com `hidden` mas deixava o iframe no DOM — e o vídeo seguia
 * tocando, com áudio, por cima da grade. Só remover o elemento interrompe. */
test('voltar para a grade destrói o player — esconder não para o vídeo', () => {
  const app = fs.readFileSync(path.join(SITE, 'app.js'), 'utf8');
  const corpo = app.match(/function renderGrade\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei renderGrade em app.js');
  assert.match(corpo[1], /limpar\(el\.ficha\)/,
    'renderGrade precisa esvaziar el.ficha; só `el.ficha.hidden = true` mantém o iframe tocando');
});

/* Bug real: a capa trocada pela tela de admin aparecia na ficha mas não na grade.
 * `urlCapa` depende de `capa_versao` para furar o cache do CDN — e a projeção
 * pública não estava mandando esse campo. */
test('a projeção pública leva capa_versao — sem ela a grade mostra a capa em cache', () => {
  const fn = fs.readFileSync(path.join(SITE, 'functions', 'api', 'catalogo.js'), 'utf8');
  const proj = fn.match(/function paraPublico\(item\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(proj, 'não achei paraPublico em functions/api/catalogo.js');
  assert.match(proj[1], /capa_versao/,
    'paraPublico precisa incluir capa_versao, senão a grade nunca vê a capa nova');
});

test('o iframe não recebe permissão de autoplay na permission policy', () => {
  const app = fs.readFileSync(path.join(SITE, 'app.js'), 'utf8');
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

/* O preview.webp tem ~450 KB. Pedir os 33 junto com a grade são ~15 MB e a tela
 * inicial morre no celular — por isso o <img> só pode nascer no mouseenter e
 * tem que morrer no mouseleave. */
test('o preview do hover não é carregado junto com a grade', () => {
  const app = fs.readFileSync(path.join(SITE, 'app.js'), 'utf8');

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
  const app = fs.readFileSync(path.join(SITE, 'app.js'), 'utf8');
  assert.match(app, /\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/,
    'falta a guarda de hover/pointer antes de carregar o preview');
  assert.match(app, /prefers-reduced-motion:\s*reduce/,
    'falta respeitar prefers-reduced-motion antes de carregar o preview');
});

/* Mesma armadilha do <meta> do index.html, agora dentro do JS: qualquer imagem
 * marcada com referrerpolicy="no-referrer" leva 403 da pull zone. */
test('nenhuma imagem da grade define referrerpolicy por conta própria', () => {
  const app = fs.readFileSync(path.join(SITE, 'app.js'), 'utf8');
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

  const app = fs.readFileSync(path.join(SITE, 'app.js'), 'utf8');
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
  const app = fs.readFileSync(path.join(SITE, 'app.js'), 'utf8');
  const corpo = app.match(/function renderGrade\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei renderGrade em app.js');
  assert.ok(!/serie-bloco|serie-titulo/.test(corpo[1]),
    'renderGrade voltou a quebrar a grade em blocos por série');
  assert.match(corpo[1], /GTM\.ordenar\(/,
    'a grade única ainda precisa da ordem de ordenar(): série, temporada, episódio');

  const css = fs.readFileSync(path.join(SITE, 'style.css'), 'utf8');
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

  /* 22 dos 33 no ar não têm capítulo nenhum: [] é o caminho normal, não erro. */
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

/* A lista clicável só existe porque o Player.js atravessa a fronteira do
 * iframe. Ela NÃO pode chamar play(): pular para um capítulo posiciona o
 * vídeo, quem decide tocar é quem aperta o play. */
test('a lista de capítulos só posiciona o vídeo — nunca manda tocar', () => {
  const app = fs.readFileSync(path.join(SITE, 'app.js'), 'utf8');
  const corpo = app.match(/function listaCapitulos\(item, iframe\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei listaCapitulos em app.js');
  assert.match(corpo[1], /setCurrentTime/, 'o clique no capítulo precisa posicionar o vídeo');
  assert.ok(!/\.play\s*\(/.test(corpo[1]), 'listaCapitulos manda o vídeo tocar');
});

/* O Player.js é externo. Carregá-lo na tela inicial custaria um script a quem
 * só está olhando a grade — e ele só serve na ficha de quem tem capítulos. */
test('o Player.js é carregado sob demanda, não junto com a página', () => {
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  assert.ok(!/playerjs/i.test(html), 'index.html carrega o Player.js de saída');
  const app = fs.readFileSync(path.join(SITE, 'app.js'), 'utf8');
  assert.match(app, /function carregarPlayerjs\(\)/);
  assert.match(app, /iframe\.isConnected/,
    'voltar para a grade destrói a ficha; o Player.js só pode se ligar a um iframe ainda vivo');
});

/* Mesmo bug da capa: campo que não sai por paraPublico não existe para a
 * grade, e a lista de capítulos sumiria da ficha sem ninguém entender por quê. */
test('a projeção pública leva os capítulos — sem eles a lista some da ficha', () => {
  const fn = fs.readFileSync(path.join(SITE, 'functions', 'api', 'catalogo.js'), 'utf8');
  const proj = fn.match(/function paraPublico\(item\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(proj, 'não achei paraPublico em functions/api/catalogo.js');
  assert.match(proj[1], /capitulos/, 'paraPublico precisa incluir capitulos');
});

/* O corte NÃO é por duração: é decisão de conteúdo, vídeo a vídeo. A Campanha
 * 20 de Novembro tem 4:09 e é uma lista de quatro pessoas — capítulo ali é
 * ótimo. O 5º Encontro tem 4:12 de depoimentos sobre o mesmo assunto — corte
 * ali seria arbitrário. O que este teste guarda é a disciplina do arquivo. */
test('capitulos.json: todo título é decidido, e nenhum está nas duas listas', () => {
  const definidos = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'capitulos.json'), 'utf8'));
  const comCapitulo = Object.keys(definidos.titulos);
  const semCapitulo = Object.keys(definidos.sem_capitulos).filter(k => k !== 'observacao');

  assert.ok(comCapitulo.length >= 22, 'capitulos.json encolheu: ' + comCapitulo.length);
  assert.equal(comCapitulo.length + semCapitulo.length, 33,
    'as duas listas juntas têm que cobrir os 33 publicados — sobrou ou faltou título');

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
  const definidos = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'capitulos.json'), 'utf8'));
  const id = 'inst-video-geral-goias-tec-2025-master';
  assert.ok(!(id in definidos.titulos), id + ' ganhou capítulos, mas não tem legenda de onde tirá-los');
  assert.match(definidos.sem_capitulos[id], /LEGENDA/,
    'o motivo do institucional precisa dizer que não há legenda, senão alguém o manda para a transcrição paga');
});

/* ============================ segredos ================================== */

test('a AccessKey do Bunny não aparece em nenhum arquivo servido ao navegador', () => {
  const servidos = ['app.js', 'admin.js', 'catalogo-core.js', 'index.html', 'admin.html'];
  const guid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  for (const arquivo of servidos) {
    const conteudo = fs.readFileSync(path.join(SITE, arquivo), 'utf8');
    /* Citar a AccessKey num comentário é permitido; usá-la como header ou
     * variável, não. O que a busca procura é o uso, e a chave literal. */
    assert.ok(!/AccessKey\s*[:=]/.test(conteudo), arquivo + ' usa AccessKey como header/variável');
    assert.ok(!/BUNNY_API_KEY/.test(conteudo), arquivo + ' menciona BUNNY_API_KEY');
    assert.ok(!guid.test(conteudo), arquivo + ' contém um literal com cara de chave do Bunny');
  }
});
