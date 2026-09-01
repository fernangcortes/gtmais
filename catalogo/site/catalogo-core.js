/* catalogo-core.js — funções puras do catálogo: sem DOM, sem rede.
 *
 * Carregado de dois jeitos, sem etapa de build:
 *   - no navegador, como <script> comum, expondo window.GTM;
 *   - nos testes, como módulo CommonJS (require('./catalogo-core.js')).
 */
(function (raiz) {
  'use strict';

  var PLAYER_BASE = 'https://player.mediadelivery.net/embed';

  /* Rótulos de triagem — não são séries de verdade, vão para o fim da grade. */
  var SERIES_AO_FIM = ['A classificar', 'A identificar'];

  var ROTULO_PENDENCIA = {
    audio_sem_trilha: 'Áudio sem trilha',
    sem_identificacao: 'Sem identificação',
    direitos_a_verificar: 'Direitos a verificar',
    piloto_decidir: 'Piloto — publicação a decidir',
    material_bruto: 'Material bruto — não publicar',
    versao_duplicada: 'Versão duplicada — escolher uma',
    nao_e_conteudo: 'Não é conteúdo — cartela ou sobra'
  };

  /* ---------------------------------------------------------------- texto */

  function normalizar(texto) {
    return String(texto == null ? '' : texto)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  /* "00:10:14" -> "10:14";  "01:02:03" -> "1:02:03" */
  function formatarDuracao(item) {
    var seg = item && typeof item.duracao_seg === 'number' ? item.duracao_seg : null;
    if (seg == null) return item && item.duracao ? String(item.duracao) : '';
    var h = Math.floor(seg / 3600);
    var m = Math.floor((seg % 3600) / 60);
    var s = seg % 60;
    var dois = function (n) { return n < 10 ? '0' + n : String(n); };
    return h > 0 ? h + ':' + dois(m) + ':' + dois(s) : m + ':' + dois(s);
  }

  /* "T1 · E2", "E2" ou "" */
  function rotuloEpisodio(item) {
    if (!item) return '';
    var partes = [];
    if (item.temporada != null) partes.push('T' + item.temporada);
    if (item.episodio != null) partes.push('E' + item.episodio);
    return partes.join(' · ');
  }

  function rotuloPendencia(pendencia) {
    if (!pendencia) return '';
    return ROTULO_PENDENCIA[pendencia] || String(pendencia).replace(/_/g, ' ');
  }

  /* Mini-sinopse do cartão da grade: uma linha só de texto, cortada na palavra.
   * O corte fino para 2 ou 3 linhas é do CSS (`line-clamp`), que conhece a
   * largura real do cartão; aqui a única função é não despejar sinopses de
   * 2 000 caracteres no DOM 33 vezes e não deixar quebra de linha vazar.
   *
   * Devolve '' quando não há sinopse — há título publicado sem ela
   * (`inst-video-geral-goias-tec-2025-master`), e o cartão tem que aguentar. */
  function resumoSinopse(item, limite) {
    var texto = item && typeof item.sinopse === 'string' ? item.sinopse : '';
    texto = texto.replace(/\s+/g, ' ').trim();
    if (!texto) return '';
    var max = typeof limite === 'number' && limite > 0 ? limite : 190;
    if (texto.length <= max) return texto;
    var corte = texto.slice(0, max);
    var espaco = corte.lastIndexOf(' ');
    if (espaco > max * 0.6) corte = corte.slice(0, espaco);
    return corte.replace(/[\s.,;:!?—–-]+$/, '') + '…';
  }

  /* ------------------------------------------------------------ capítulos */

  /* 62 -> '1:02'  ·  3723 -> '1:02:03'. Mesmo formato de `formatarDuracao`,
   * mas a partir de um número solto — o capítulo não é um item do catálogo. */
  function formatarTempo(segundos) {
    var t = Math.max(0, Math.floor(Number(segundos) || 0));
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    var dois = function (n) { return n < 10 ? '0' + n : String(n); };
    return h > 0 ? h + ':' + dois(m) + ':' + dois(s) : m + ':' + dois(s);
  }

  /* Lista de capítulos do item, saneada, pronta para desenhar.
   *
   * Defensiva de propósito: os capítulos vêm do KV, que é editado pela tela de
   * admin e por script. Um `inicio` que virou texto, um título vazio ou dois
   * capítulos no mesmo segundo não podem derrubar a ficha inteira — a ficha
   * tem que abrir com o vídeo mesmo quando os capítulos estiverem tortos.
   * Por isso aqui nada lança: o que não presta é descartado em silêncio.
   *
   * Devolve [] quando não há nada aproveitável, e quem chama trata [] como
   * "esse título não tem capítulos" — que é o caso de 22 dos 33 no ar. */
  function capitulos(item) {
    var bruto = item && Array.isArray(item.capitulos) ? item.capitulos : [];
    var limpos = [];
    bruto.forEach(function (c) {
      if (!c) return;
      var inicio = Number(c.inicio);
      if (!isFinite(inicio) || inicio < 0) return;
      var titulo = String(c.titulo == null ? '' : c.titulo).replace(/\s+/g, ' ').trim();
      if (!titulo) return;
      limpos.push({ inicio: Math.floor(inicio), titulo: titulo });
    });

    limpos.sort(function (a, b) { return a.inicio - b.inicio; });

    /* Dois capítulos no mesmo segundo viram um: o player não consegue
     * desenhar um segmento de largura zero, e a lista mostraria o mesmo
     * horário duas vezes. Fica o primeiro. */
    var saida = [];
    limpos.forEach(function (c) {
      if (saida.length && saida[saida.length - 1].inicio === c.inicio) return;
      saida.push(c);
    });
    return saida;
  }

  /* Índice do capítulo que contém `segundos`, ou -1.
   *
   * É o que destaca a linha certa na lista enquanto o vídeo anda. -1 antes do
   * primeiro capítulo é caso real: nem todo vídeo começa em 0 (a Jornada só
   * tem fala a partir de 1:58), e o primeiro capítulo pode ser escrito depois
   * do começo. */
  function capituloEm(lista, segundos) {
    var t = Number(segundos);
    if (!isFinite(t)) return -1;
    var achado = -1;
    for (var i = 0; i < (lista || []).length; i++) {
      if (lista[i].inicio <= t) achado = i;
      else break;
    }
    return achado;
  }

  /* --------------------------------------------------------------- player */

  /* O libraryId do item manda; o da config é só a rede de segurança para
   * itens gravados antes de a library existir. */
  function resolverFonte(item, config) {
    var fonte = item && item.fonte;
    if (!fonte || !fonte.videoId) return null;
    var libraryId = fonte.libraryId || (config && config.libraryId) || null;
    if (!libraryId) return null;
    return {
      tipo: fonte.tipo || 'bunny',
      libraryId: String(libraryId),
      videoId: String(fonte.videoId)
    };
  }

  /* ARMADILHA CENTRAL DO PROJETO: autoplay do Bunny é `true` por padrão.
   * Omitir o parâmetro faz o vídeo tocar sozinho — o que o produto proíbe.
   * Os quatro parâmetros abaixo são obrigatórios; há teste cobrindo isso. */
  function urlEmbed(fonte) {
    if (!fonte || !fonte.libraryId || !fonte.videoId) return null;
    if (fonte.tipo && fonte.tipo !== 'bunny') return null;
    var p = new URLSearchParams({
      autoplay: 'false',
      loop: 'false',
      preload: 'false',
      rememberPosition: 'false'
    });
    return PLAYER_BASE + '/' + fonte.libraryId + '/' + fonte.videoId + '?' + p.toString();
  }

  function hostPullzone(config) {
    var pullzone = config && config.pullzone;
    if (!pullzone) return null;
    return String(pullzone).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }

  /* Capa servida pela pull zone do Bunny — evita carregar 55 JPGs no repositório.
   *
   * ARMADILHA: o nome do arquivo NÃO é sempre `thumbnail.jpg`. Ao receber uma capa
   * enviada por nós, o Bunny grava com um hash no nome (`thumbnail_2c504259.jpg`) e
   * MANTÉM o `thumbnail.jpg` antigo, gerado automaticamente, no lugar. Quem monta o
   * caminho fixo continua servindo a capa velha para sempre — e nem percebe, porque
   * a requisição responde 200.
   *
   * Por isso `capa_arquivo` guarda o `thumbnailFileName` que o Bunny informa.
   * `capa_versao` fica como reforço contra cache do navegador. */
  function urlCapa(item, config) {
    var fonte = resolverFonte(item, config);
    var host = hostPullzone(config);
    if (!fonte || !host) return null;
    var arquivo = (item && item.capa_arquivo) || 'thumbnail.jpg';
    var url = 'https://' + host + '/' + fonte.videoId + '/' + arquivo;
    return item && item.capa_versao ? url + '?v=' + encodeURIComponent(item.capa_versao) : url;
  }

  /* Trecho animado que o Bunny gera amostrando o vídeo inteiro (WebP animado).
   * É o que a grade mostra no lugar da capa enquanto o ponteiro está sobre o
   * cartão — sem um segundo player na página e sem decodificar vídeo.
   *
   * ARMADILHA: o arquivo tem ~450 KB. Carregar os 33 de uma vez junto com a
   * grade são ~15 MB e a tela inicial morre no celular. Quem chama isto tem
   * obrigação de pedir a imagem SÓ no `mouseenter` e descartá-la no
   * `mouseleave`. Há teste cobrindo isso em tests/catalogo.test.js. */
  function urlPreview(item, config) {
    var fonte = resolverFonte(item, config);
    var host = hostPullzone(config);
    if (!fonte || !host) return null;
    return 'https://' + host + '/' + fonte.videoId + '/preview.webp';
  }

  /* MP4 direto da pull zone, usado pelo seletor de capa da tela de admin.
   * Depende de `hasMP4Fallback` ligado na library (está). A pull zone devolve
   * Access-Control-Allow-Origin: *, o que permite capturar o quadro num canvas. */
  function urlMp4(item, config, resolucao) {
    var fonte = resolverFonte(item, config);
    var host = hostPullzone(config);
    if (!fonte || !host) return null;
    return 'https://' + host + '/' + fonte.videoId + '/play_' + (resolucao || '720p') + '.mp4';
  }

  /* ------------------------------------------------------------- listagem */

  function publicaveis(itens) {
    return (itens || []).filter(function (i) { return i && i.publicar === true; });
  }

  function chaveSerie(serie) {
    var nome = serie || 'Sem série';
    var atrasa = SERIES_AO_FIM.indexOf(nome) >= 0 ? 1 : 0;
    return atrasa + '' + normalizar(nome);
  }

  /* Ordena por série, temporada, episódio e título.
   * Nunca por nome de arquivo: "V1"/"MASTER" bagunçam a ordem alfabética. */
  function ordenar(itens) {
    var alto = Number.MAX_SAFE_INTEGER;
    return (itens || []).slice().sort(function (a, b) {
      var sa = chaveSerie(a.serie), sb = chaveSerie(b.serie);
      if (sa !== sb) return sa < sb ? -1 : 1;
      var ta = a.temporada == null ? alto : a.temporada;
      var tb = b.temporada == null ? alto : b.temporada;
      if (ta !== tb) return ta - tb;
      var ea = a.episodio == null ? alto : a.episodio;
      var eb = b.episodio == null ? alto : b.episodio;
      if (ea !== eb) return ea - eb;
      return normalizar(a.titulo).localeCompare(normalizar(b.titulo), 'pt');
    });
  }

  function agrupar(itens) {
    var grupos = [];
    var indice = Object.create(null);
    ordenar(itens).forEach(function (item) {
      var nome = item.serie || 'Sem série';
      if (!(nome in indice)) {
        indice[nome] = grupos.length;
        grupos.push({ serie: nome, itens: [] });
      }
      grupos[indice[nome]].itens.push(item);
    });
    return grupos;
  }

  function series(itens) {
    var vistas = Object.create(null);
    var nomes = [];
    ordenar(itens).forEach(function (i) {
      var nome = i.serie || 'Sem série';
      if (!vistas[nome]) { vistas[nome] = true; nomes.push(nome); }
    });
    return nomes;
  }

  function textoBusca(item) {
    return normalizar([
      item.titulo, item.serie, item.sinopse, item.tema, item.publico_alvo,
      item.ano, rotuloEpisodio(item), (item.tags || []).join(' ')
    ].join(' '));
  }

  /* Busca por todos os termos (AND), acento-insensível. */
  function buscar(itens, termo) {
    var alvo = normalizar(termo);
    if (!alvo) return (itens || []).slice();
    var termos = alvo.split(/\s+/);
    return (itens || []).filter(function (item) {
      var texto = textoBusca(item);
      return termos.every(function (t) { return texto.indexOf(t) >= 0; });
    });
  }

  function filtrarPorSerie(itens, serie) {
    if (!serie) return (itens || []).slice();
    return (itens || []).filter(function (i) { return (i.serie || 'Sem série') === serie; });
  }

  function porId(itens, id) {
    return (itens || []).find(function (i) { return i.id === id; }) || null;
  }

  /* Vizinhos dentro da mesma série, para os botões EXPLÍCITOS de navegação.
   * Nunca use isto para avançar sozinho ao fim do vídeo — é proibido pelo produto. */
  function vizinhos(itens, id) {
    var atual = porId(itens, id);
    if (!atual) return { anterior: null, proximo: null };
    var irmaos = ordenar(filtrarPorSerie(publicaveis(itens), atual.serie));
    var pos = irmaos.findIndex(function (i) { return i.id === id; });
    if (pos < 0) return { anterior: null, proximo: null };
    return {
      anterior: pos > 0 ? irmaos[pos - 1] : null,
      proximo: pos < irmaos.length - 1 ? irmaos[pos + 1] : null
    };
  }

  /* ---------------------------------------------------------------- admin */

  function slug(texto) {
    var s = normalizar(texto)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/, '');
    return s || 'sem-titulo';
  }

  function idUnico(itens, titulo) {
    var base = slug(titulo);
    var usados = Object.create(null);
    (itens || []).forEach(function (i) { usados[i.id] = true; });
    if (!usados[base]) return base;
    for (var n = 2; n < 1000; n++) {
      if (!usados[base + '-' + n]) return base + '-' + n;
    }
    return base + '-' + Date.now();
  }

  function precisaRevisao(item) {
    return !!item && item.sinopse_origem === 'auto';
  }

  /* Item novo criado pela tela de admin, no mesmo esquema do seed. */
  function itemNovo(campos) {
    var c = campos || {};
    return {
      id: c.id || '',
      arquivo: c.arquivo || '',
      caminho_local: '',
      titulo: c.titulo || '',
      serie: c.serie || 'A classificar',
      temporada: c.temporada == null ? null : Number(c.temporada),
      episodio: c.episodio == null ? null : Number(c.episodio),
      duracao: c.duracao || '',
      duracao_seg: c.duracao_seg == null ? null : Number(c.duracao_seg),
      tamanho_mb: c.tamanho_mb == null ? null : Number(c.tamanho_mb),
      ano: c.ano || '',
      data_publicacao_original: '',
      sinopse: c.sinopse || '',
      tema: c.tema || '',
      publico_alvo: c.publico_alvo || '',
      tags: Array.isArray(c.tags) ? c.tags : [],
      capa_local: null,
      legenda_local: null,
      titularidade: c.titularidade || 'INCONCLUSIVO',
      nivel_evidencia: c.nivel_evidencia || 'SEM EVIDÊNCIA',
      registro: '',
      link_origem: '',
      fonte: {
        tipo: 'bunny',
        libraryId: c.libraryId == null ? null : String(c.libraryId),
        videoId: c.videoId == null ? null : String(c.videoId)
      },
      pendencia: c.pendencia || null,
      publicar: c.publicar === true,
      piloto: false,
      sinopse_origem: c.sinopse_origem || (c.sinopse ? 'manual' : '')
    };
  }

  var GTM = {
    PLAYER_BASE: PLAYER_BASE,
    normalizar: normalizar,
    formatarDuracao: formatarDuracao,
    rotuloEpisodio: rotuloEpisodio,
    rotuloPendencia: rotuloPendencia,
    resumoSinopse: resumoSinopse,
    formatarTempo: formatarTempo,
    capitulos: capitulos,
    capituloEm: capituloEm,
    resolverFonte: resolverFonte,
    urlEmbed: urlEmbed,
    urlCapa: urlCapa,
    urlPreview: urlPreview,
    urlMp4: urlMp4,
    publicaveis: publicaveis,
    ordenar: ordenar,
    agrupar: agrupar,
    series: series,
    buscar: buscar,
    filtrarPorSerie: filtrarPorSerie,
    porId: porId,
    vizinhos: vizinhos,
    slug: slug,
    idUnico: idUnico,
    precisaRevisao: precisaRevisao,
    itemNovo: itemNovo
  };

  raiz.GTM = GTM;
  if (typeof module !== 'undefined' && module.exports) module.exports = GTM;
})(typeof globalThis !== 'undefined' ? globalThis : this);
