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

  /* Título do CARTÃO da prateleira — o nome inteiro repete o que já está
   * escrito ali em cima.
   *
   * Duas podas, e as duas nasceram dos dados de 10/09, não de gosto:
   *
   * 1. O PREFIXO "Algo: ", em 43 dos 66. Dentro da prateleira *De Olho no
   *    Futuro*, "De Olho no Futuro: Bombeiro militar" diz duas vezes o nome
   *    da linha. Mas ele só sai quando BATE COM A SÉRIE, e a comparação é por
   *    início do nome normalizado, nesta direção: a série tem que começar
   *    pelo prefixo.
   *      "De Olho no Futuro"  = a série            -> corta
   *      "Blá Blá Blá"        começa "Blá Blá Blá com o Ivair" -> corta
   *      "Aula"               começa "Aulas"       -> corta
   *      "PCAs na Natureza"   na série Paraquedismo -> FICA
   *      "Jornada Goiás Tec"  na série A classificar -> FICA
   *    A direção contrária (prefixo começando pela série) ficou de fora de
   *    propósito: nenhum dos 66 precisa dela, e ela cortaria informação que
   *    a linha da prateleira não mostra — "Aulas de campo: X" viraria "X".
   *
   * 2. O SUFIXO "(Episódio N)" / "(Parte N)", em 28 dos 66.
   *
   * A poda 2 CRIA COLISÃO, e isso é sabido e aceito: sobram cinco
   * "Literatura e cidadania" no *Blá Blá Blá* e três "Português" na
   * *Enquete*. O que desfaz a colisão é a linha de baixo do cartão, e é para
   * ela que serve `rotuloNumero`. Quem desenhar um cartão sem essa linha
   * reabre a colisão. */
  function tituloCurto(item) {
    var titulo = String((item && item.titulo) || '').trim();
    if (!titulo) return '';
    var serie = (item && item.serie) || '';

    var m = titulo.match(/^([^:]{2,60}):\s*(\S.*)$/);
    if (m && serie && normalizar(serie).indexOf(normalizar(m[1])) === 0) {
      titulo = m[2].trim();
    }
    titulo = titulo.replace(/\s*\((?:epis[oó]dio|parte)\s+[^)]*\)\s*$/i, '').trim();

    /* Poda que come o título inteiro devolve o original: um cartão sem nome é
     * pior do que um cartão repetindo a série. */
    return titulo || String((item && item.titulo) || '').trim();
  }

  /* O tamanho de uma série somada, para gente: "2 h 10 min", e não "130 min".
   * Arredonda para o minuto mais perto, com piso em 1 — um vídeo de 20 s não é
   * "0 min". Sem duração conhecida, devolve '' e o cartão fica só com a
   * contagem. */
  function formatarMinutos(segundos) {
    var s = Number(segundos);
    if (segundos == null || !isFinite(s) || s <= 0) return '';
    var min = Math.max(1, Math.round(s / 60));
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60);
    var resto = min % 60;
    return resto ? h + ' h ' + resto + ' min' : h + ' h';
  }

  /* "Parte 3", "Episódio 2" — o número que `tituloCurto` tirou do nome.
   *
   * A PALAVRA sai do título, não do campo: o *Blá Blá Blá* é numerado em
   * "Parte" e o resto em "Episódio", e mostrar "E3" onde o vídeo diz "Parte
   * 3" troca o nome das coisas para quem procura o episódio certo. Sem sufixo
   * no nome, cai no campo `episodio`, que é de onde vem a numeração dos
   * outros. */
  function rotuloNumero(item) {
    var m = String((item && item.titulo) || '')
      .match(/\((epis[oó]dio|parte)\s+([^)]+)\)\s*$/i);
    if (m) {
      return (normalizar(m[1]) === 'parte' ? 'Parte ' : 'Episódio ') + m[2].trim();
    }
    if (item && item.episodio != null) return 'Episódio ' + item.episodio;
    return '';
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
   * ARMADILHA, com o número MEDIDO na pull zone em 14/09, nos 66 títulos: a
   * mediana é de **1,13 MB**, a menor 454 KB e a maior 3,1 MB, e os 66 somam
   * **82,2 MB**. O "~450 KB" que este comentário dizia era o menor arquivo
   * tomado pelo tamanho típico, e vinha de quando o catálogo tinha 33 títulos.
   *
   * Carregar os 66 junto com a chegada são 82 MB, e a tela morre no celular.
   * Quem chama isto tem obrigação de pedir a imagem SÓ no `mouseenter` e
   * descartá-la no `mouseleave`. Há teste cobrindo isso em
   * tests/catalogo.test.js. */
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

  /* ------------------------------------------------ a estrutura do site (M4)
   *
   * O nome e a ordem das prateleiras, de que lado cada série cai, o título em
   * destaque e os textos fixos nasceram escritos no código — e mudar qualquer
   * um deles era mudar este arquivo e publicar o site. A M4 (PLANO-MESA §3.3)
   * põe os quatro num campo de topo do catálogo, `site`, que a mesa edita.
   *
   * O PADRÃO CONTINUA AQUI. O dado é uma camada POR CIMA, e só do que alguém
   * escolheu: catálogo sem `site` — ou com `site` pela metade — desenha a
   * chegada de hoje, linha por linha. Duas consequências que valem o preço:
   *
   *   - voltar ao padrão é APAGAR a entrada, nunca gravar o valor do código.
   *     Quem não escolheu nada anda junto quando o padrão mudar;
   *   - um dado torto não derruba o site: o saneador descarta o que não tem a
   *     forma certa, como o `ajustes()` da API já fazia com o número do arrasto.
   *
   * O `site` que chega ao navegador passa por `siteSaneado` no SERVIDOR (o GET
   * público) e é saneado de novo aqui, porque a mesa lê o documento cru pelo
   * `?completo=1`. */

  var CLASSES_SERIE = ['pedagogica', 'curta', 'institucional'];

  /* O rodapé e os cinco estados do B8 do briefing — "sem capa", a busca vazia,
   * o selo de vídeo indisponível, a ficha que não existe e a falha de rede.
   * Dois deles têm título e ajuda, e por isso são oito chaves.
   *
   * A mensagem técnica do erro (`erro.message`) NÃO mora aqui: ela é colada no
   * fim pelo `app.js`. Um texto editável com um buraco no meio é um texto que
   * a próxima pessoa reescreve sem o buraco, e aí o detalhe some. */
  var TEXTOS_PADRAO = {
    rodape: 'Uso interno da rede. Não divulgar o endereço.',
    semCapa: 'sem capa',
    videoIndisponivel: 'vídeo indisponível',
    buscaVazia: 'Nada encontrado',
    buscaVaziaAjuda: 'Tente outro termo ou remova o filtro de série.',
    fichaAusente: 'Título não encontrado ou ainda não publicado.',
    erroCatalogo: 'Não foi possível carregar o catálogo',
    erroCatalogoAjuda: 'A página está no ar, mas o catálogo não respondeu. ' +
      'Recarregue em alguns instantes; se persistir, avise a equipe técnica.'
  };

  /* Texto de tela, não de artigo: o maior padrão tem 118 caracteres. O limite
   * é o que impede que um `paste` de uma página inteira vá para o KV e volte
   * em toda visita ao site. */
  var LIMITE_TEXTO = 300;

  function textoAparado(valor) {
    return typeof valor === 'string' ? valor.trim().slice(0, LIMITE_TEXTO) : '';
  }

  function mapaSimples(valor) {
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
  }

  /* A forma conferida, sempre com as quatro chaves — quem lê não precisa de
   * guarda. As chaves dos mapas saem ORDENADAS: o rascunho compara valor por
   * `JSON.stringify`, e um mapa com as mesmas entradas em outra ordem contaria
   * como mudança que ninguém fez. */
  function siteSaneado(site) {
    var cru = mapaSimples(site);
    var saida = {
      destaque: typeof cru.destaque === 'string' && cru.destaque ? cru.destaque : null,
      prateleiras: {},
      classes: {},
      textos: {}
    };

    var ps = mapaSimples(cru.prateleiras);
    Object.keys(ps).sort().forEach(function (id) {
      var p = mapaSimples(ps[id]);
      var limpa = {};
      var titulo = textoAparado(p.titulo);
      if (titulo) limpa.titulo = titulo;
      /* Número é número e `true` é `true`: o saneador confere a FORMA e não
       * adivinha a intenção. Um `'nao'` coagido para verdadeiro esconderia uma
       * prateleira sem ninguém entender de onde veio. */
      if (typeof p.ordem === 'number' && isFinite(p.ordem)) limpa.ordem = p.ordem;
      if (p.escondida === true) limpa.escondida = true;
      if (Object.keys(limpa).length) saida.prateleiras[id] = limpa;
    });

    var cs = mapaSimples(cru.classes);
    Object.keys(cs).sort().forEach(function (serie) {
      if (CLASSES_SERIE.indexOf(cs[serie]) >= 0) saida.classes[serie] = cs[serie];
    });

    var ts = mapaSimples(cru.textos);
    Object.keys(ts).sort().forEach(function (chave) {
      if (!(chave in TEXTOS_PADRAO)) return;
      var texto = textoAparado(ts[chave]);
      if (texto) saida.textos[chave] = texto;
    });

    return saida;
  }

  /* Estrutura vazia NÃO É DADO: um `site` com as quatro chaves vazias diz
   * exatamente o que a ausência dele já dizia — "ninguém escolheu nada". O PUT
   * apaga o campo nesse caso, senão a projeção do GET voltaria no PUT e
   * inventaria um campo (e uma linha no histórico) que ninguém pediu. */
  function siteVazio(site) {
    var s = siteSaneado(site);
    return !s.destaque && !Object.keys(s.prateleiras).length &&
      !Object.keys(s.classes).length && !Object.keys(s.textos).length;
  }

  /* De que lado a série cai. O dado vence; sem dado, as três listas; sem lista
   * nenhuma, pedagógica — o site não esconde título por lista desatualizada, e
   * quem avisa continua sendo o teste. */
  function classeDaSerie(nome, site) {
    var escolhida = siteSaneado(site).classes[nome];
    if (escolhida) return escolhida;
    if (SERIES_INSTITUCIONAIS.indexOf(nome) >= 0) return 'institucional';
    if (SERIES_CURTAS.indexOf(nome) >= 0) return 'curta';
    return 'pedagogica';
  }

  /* Texto vazio é o PADRÃO, não o silêncio: um campo limpo sem querer não pode
   * apagar da tela o aviso que explica o que houve. */
  function textoDoSite(site, chave) {
    if (!(chave in TEXTOS_PADRAO)) return '';
    return siteSaneado(site).textos[chave] || TEXTOS_PADRAO[chave];
  }

  /* As escritas da mesa. Todas puras, todas devolvendo um `site` NOVO: o
   * rascunho guarda o valor inteiro do campo como "antes", e mexer no objeto
   * que a tela está mostrando apagaria o lado de lá da comparação. */
  function comPrateleira(site, id, mudanca) {
    var novo = siteSaneado(site);
    var atual = novo.prateleiras[id] || {};
    var limpa = {
      titulo: 'titulo' in mudanca ? textoAparado(mudanca.titulo) : atual.titulo,
      ordem: 'ordem' in mudanca ? mudanca.ordem : atual.ordem,
      escondida: 'escondida' in mudanca ? mudanca.escondida === true : atual.escondida === true
    };
    delete novo.prateleiras[id];
    var guardar = {};
    if (limpa.titulo) guardar.titulo = limpa.titulo;
    if (typeof limpa.ordem === 'number' && isFinite(limpa.ordem)) guardar.ordem = limpa.ordem;
    if (limpa.escondida) guardar.escondida = true;
    if (Object.keys(guardar).length) novo.prateleiras[id] = guardar;
    return siteSaneado(novo);
  }

  function comOrdemPrateleiras(site, ids) {
    var novo = site;
    (ids || []).forEach(function (id, i) { novo = comPrateleira(novo, id, { ordem: i }); });
    return siteSaneado(novo);
  }

  function comClasse(site, serie, classe) {
    var novo = siteSaneado(site);
    delete novo.classes[serie];
    if (CLASSES_SERIE.indexOf(classe) >= 0) novo.classes[serie] = classe;
    return siteSaneado(novo);
  }

  function comTexto(site, chave, valor) {
    var novo = siteSaneado(site);
    delete novo.textos[chave];
    if (chave in TEXTOS_PADRAO) {
      var texto = textoAparado(valor);
      if (texto) novo.textos[chave] = texto;
    }
    return siteSaneado(novo);
  }

  /* ----------------------------------------------------------- prateleiras */

  /* "Pedagógico" e "institucional" NÃO EXISTEM COMO DADO. Os campos que
   * serviriam — tema, público-alvo, tags — estão vazios nos 66 títulos, e
   * preenchê-los é trabalho de catalogação que ninguém fez ainda. Então a
   * divisão mora aqui, escrita à mão, e as TRÊS listas são explícitas de
   * propósito: com uma lista só, uma série nova cairia no outro lado em
   * silêncio. Com três, ela não está em nenhuma, e há teste reprovando.
   *
   * Em produção uma série desconhecida é tratada como pedagógica e aparece em
   * "Mais séries" — o site não pode esconder título por causa de uma lista
   * desatualizada. Quem avisa é o teste, não a tela. */
  var SERIES_INSTITUCIONAIS = [
    'Campanhas', 'Institucional', 'Eventos', 'Datas comemorativas',
    'A classificar', 'Depoimentos'
  ];

  /* Cinco séries de UM título, de 2 min cada. Juntas viram uma prateleira; em
   * "Mais séries" elas afogariam as outras. */
  var SERIES_CURTAS = [
    'Curtas — Kalunga', 'Curtas — Leitura', 'Curtas — Matematicidades',
    'Curtas — Paraquedismo', 'Curtas — Tapunga'
  ];

  var SERIES_PEDAGOGICAS = [
    'De Olho no Futuro', 'Blá Blá Blá com o Ivair', 'Festas Típicas de Goiás',
    'Papo de Palavra', 'Enquete', 'Projeto Leitura', 'Matematicidades',
    'Paraquedismo', 'Série Kalunga', 'Esportes de Invasão', 'Aulas',
    'PequiPod / Ciranda da Arte'
  ];

  /* Abaixo disto a série não vira linha própria: vai para "Mais séries".
   *
   * É a mesma decisão que tirou os blocos por série da grade, e o comentário
   * do `renderGrade` conta como ela foi tomada — os blocos "deixavam um cartão
   * sozinho por faixa e a tela inteira vazia à direita". Rolar de lado resolve
   * a SOBRA das séries grandes; não salva uma linha de uma capa só. Nove das
   * 23 séries têm um título, cinco têm dois. */
  var MINIMO_PRATELEIRA = 3;

  /* Cinco minutos: o tamanho de quem passa um vídeo no começo da aula. É o
   * único corte transversal que o catálogo já tem — duração é dado, tema não. */
  var SEGUNDOS_CURTO = 300;

  /* As duas perguntas passam pela `classeDaSerie` desde a M4: a lista acima é o
   * PADRÃO, e o `site.classes` do catálogo é quem manda quando existe. Sem o
   * campo, a resposta é idêntica à de antes. */
  function ehInstitucional(item, site) {
    return classeDaSerie((item && item.serie) || '', site) === 'institucional';
  }

  function ehCurta(item, site) {
    return classeDaSerie((item && item.serie) || '', site) === 'curta';
  }

  /* A chegada, em linhas que rolam de lado. Pura: devolve a lista pronta e
   * quem desenha é o app.js.
   *
   * Cada prateleira é { id, titulo, itens }. O `id` é o que o "Ver tudo" usa
   * para achar a mesma prateleira de novo e virar grade — uma fonte só da
   * verdade, sem repetir a regra do lado do desenho.
   *
   * A ordem: primeiro o corte por duração, depois as séries grandes da maior
   * para a menor, e por fim os três agrupamentos. Empate entre séries do mesmo
   * tamanho desempata pelo nome, para a ordem não depender da ordem em que o
   * catálogo veio.
   *
   * TODO TÍTULO APARECE PELO MENOS UMA VEZ, e só a primeira prateleira
   * repete — é o primeiro teste desta função. */
  function prateleiras(itens, site) {
    var base = ordenar(publicaveis(itens));
    var saida = [];

    var curtos = base.filter(function (i) {
      return !ehInstitucional(i, site) && typeof i.duracao_seg === 'number' &&
        i.duracao_seg > 0 && i.duracao_seg <= SEGUNDOS_CURTO;
    });
    if (curtos.length >= MINIMO_PRATELEIRA) {
      saida.push({ id: 'curtos', titulo: 'Até 5 minutos, para a aula', itens: curtos });
    }

    /* As séries pedagógicas que não são curtas, agrupadas. */
    var porSerie = [];
    var indice = Object.create(null);
    base.forEach(function (i) {
      if (ehInstitucional(i, site) || ehCurta(i, site)) return;
      var nome = i.serie || 'Sem série';
      if (!(nome in indice)) { indice[nome] = porSerie.length; porSerie.push({ serie: nome, itens: [] }); }
      porSerie[indice[nome]].itens.push(i);
    });

    var grandes = porSerie.filter(function (g) { return g.itens.length >= MINIMO_PRATELEIRA; });
    grandes.sort(function (a, b) {
      if (a.itens.length !== b.itens.length) return b.itens.length - a.itens.length;
      return normalizar(a.serie).localeCompare(normalizar(b.serie), 'pt');
    });
    grandes.forEach(function (g) {
      saida.push({ id: 'serie:' + g.serie, titulo: g.serie, itens: g.itens });
    });

    /* Os agrupamentos NÃO são descartados quando ficam abaixo do mínimo: eles
     * existem justamente para recolher o que sobrou, e sumir com eles esconde
     * título. Hoje os três passam com folga (9, 5 e 18), e há teste medindo
     * isso no catálogo de verdade — se um deles encolher, quem decide o que
     * fazer é uma pessoa, não este `if`. */
    var restos = [];
    porSerie.forEach(function (g) {
      if (g.itens.length < MINIMO_PRATELEIRA) restos = restos.concat(g.itens);
    });
    if (restos.length) saida.push({ id: 'mais-series', titulo: 'Mais séries', itens: ordenar(restos) });

    var curtas = base.filter(function (i) { return ehCurta(i, site); });
    if (curtas.length) saida.push({ id: 'curtas', titulo: 'Curtas', itens: curtas });

    var inst = base.filter(function (i) { return ehInstitucional(i, site); });
    if (inst.length) saida.push({ id: 'institucional', titulo: 'Do Goiás Tec', itens: inst });

    return comEscolhasDaMesa(saida, site);
  }

  /* O nome, a ordem e o "escondida" escolhidos na mesa, por cima da lista que o
   * código acabou de montar (M4).
   *
   * A ordem: quem tem `ordem` escolhida vai na frente, na ordem dela; quem não
   * tem fica atrás, na ordem do código. Uma série nova que cruze os três
   * títulos vira prateleira meses depois de alguém ter arrumado a chegada — e
   * entra no FIM, que é previsível, em vez de brotar no meio.
   *
   * A escondida CONTINUA NA LISTA, com a marca. Quem some com ela da tela é o
   * site (`prateleirasVisiveis`); aqui ela fica, porque o "Ver tudo", o painel
   * da mesa e o teste de que todo título aparece em algum lugar leem daqui. */
  function comEscolhasDaMesa(lista, site) {
    var cfg = siteSaneado(site);
    var comIndice = lista.map(function (p, i) {
      var escolha = cfg.prateleiras[p.id] || {};
      if (escolha.titulo) p.titulo = escolha.titulo;
      if (escolha.escondida) p.escondida = true;
      return { p: p, i: i, ordem: typeof escolha.ordem === 'number' ? escolha.ordem : null };
    });
    comIndice.sort(function (a, b) {
      if (a.ordem === null && b.ordem === null) return a.i - b.i;
      if (a.ordem === null) return 1;
      if (b.ordem === null) return -1;
      if (a.ordem !== b.ordem) return a.ordem - b.ordem;
      return a.i - b.i;
    });
    return comIndice.map(function (x) { return x.p; });
  }

  /* O que a chegada desenha. */
  function prateleirasVisiveis(itens, site) {
    return prateleiras(itens, site).filter(function (p) { return !p.escondida; });
  }

  /* Quem some da CHEGADA se as prateleiras escondidas ficarem como estão — o
   * aviso que a mesa mostra antes de alguém esconder uma linha. Não é perda de
   * título: eles continuam na busca, na página da série e no link direto. */
  function titulosSoEmEscondidas(itens, site) {
    var todas = prateleiras(itens, site);
    var visiveis = Object.create(null);
    todas.forEach(function (p) {
      if (p.escondida) return;
      p.itens.forEach(function (i) { visiveis[i.id] = true; });
    });
    var perdidos = [];
    var vistos = Object.create(null);
    todas.forEach(function (p) {
      if (!p.escondida) return;
      p.itens.forEach(function (i) {
        if (visiveis[i.id] || vistos[i.id]) return;
        vistos[i.id] = true;
        perdidos.push(i);
      });
    });
    return perdidos;
  }

  /* O título do DESTAQUE da chegada. Um só, e nunca nenhum quando há catálogo.
   *
   * Quem escolhe é a mesa, e desde a M4 ela grava o ID em `site.destaque`. A
   * marca `destaque` no próprio título é o LEGADO — o que o /admin de 14/09
   * gravou e o que está no KV até a primeira publicação da mesa, que apaga as
   * marcas ao escrever o id. Ela continua valendo até lá, e por isso a ordem
   * de consulta abaixo é id, marca, padrão.
   *
   * As defesas contra o dado torto ficam, porque a tela não é a única coisa
   * que escreve no KV:
   *
   *   - escolhido mas NÃO PUBLICADO não vale — o destaque é a primeira coisa
   *     que a chegada mostra, e mostrar um título despublicado é vazá-lo. Vale
   *     para o id do `site` e para a marca antiga;
   *   - DOIS marcados não quebram nada: fica o primeiro pela ordem de
   *     `ordenar()`, que é estável. Sem isso o destaque dependeria da ordem em
   *     que os itens estão no KV, e mudaria sozinho na próxima gravação.
   *
   * Sem escolha nenhuma, o padrão é o primeiro título da MAIOR SÉRIE
   * PEDAGÓGICA — e ele sai da própria `prateleiras()`, cuja primeira linha de
   * série já é a maior. Repetir aqui o critério de "maior série" criaria duas
   * regras que envelheceriam separadas. Prateleira escondida não entra nessa
   * conta: destacar a primeira capa de uma linha que ninguém vê é estranho. */
  function destaque(itens, site) {
    var pub = publicaveis(itens);
    if (!pub.length) return null;

    var escolhido = siteSaneado(site).destaque;
    if (escolhido) {
      var doSite = porId(pub, escolhido);
      if (doSite) return doSite;
    }

    var marcados = pub.filter(function (i) { return i.destaque === true; });
    if (marcados.length) return ordenar(marcados)[0];

    var deSerie = prateleirasVisiveis(itens, site).find(function (p) {
      return p.id.indexOf('serie:') === 0;
    });
    if (deSerie && deSerie.itens.length) return deSerie.itens[0];

    /* Catálogo sem nenhuma série grande o bastante para virar linha: o
     * primeiro da ordem, que é melhor do que nenhum destaque. */
    return ordenar(pub)[0];
  }

  /* A prateleira de um `id`, para o "Ver tudo" e para a rota que ele abre.
   * Deriva da mesma `prateleiras()`: a regra não é escrita duas vezes. Acha
   * também a escondida — o link dela continua funcionando, que é a diferença
   * entre esconder da chegada e tirar do ar. */
  function prateleiraPorId(itens, id, site) {
    return prateleiras(itens, site).find(function (p) { return p.id === id; }) || null;
  }

  /* A PÁGINA SÉRIES (D5) — para onde os chips da chegada foram (decisão D8).
   *
   * Dois grupos, pelas MESMAS listas das prateleiras: o que é para a aula
   * (pedagógicas e curtas) e o que é do Goiás Tec (institucionais). Uma série
   * que não está em lista nenhuma cai do lado da aula, pela mesma razão da
   * chegada: o site não esconde título por causa de uma lista desatualizada —
   * quem avisa é o teste "toda série está em exatamente uma das três listas".
   *
   * Cada série é { nome, itens, segundos }. Os itens vêm na ordem de
   * `ordenar()`, e o primeiro deles é a capa do cartão — a mesma que a página
   * da série vai usar na D6. Dentro do grupo a ordem é a de `series()`:
   * alfabética, com a triagem ("A classificar") no fim. */
  function gruposDeSeries(itens, site) {
    var porNome = Object.create(null);
    var nomes = [];
    ordenar(publicaveis(itens)).forEach(function (i) {
      var nome = i.serie || 'Sem série';
      if (!(nome in porNome)) {
        porNome[nome] = { nome: nome, itens: [], segundos: 0 };
        nomes.push(nome);
      }
      porNome[nome].itens.push(i);
      if (typeof i.duracao_seg === 'number' && i.duracao_seg > 0) porNome[nome].segundos += i.duracao_seg;
    });

    var aula = [];
    var inst = [];
    nomes.forEach(function (nome) {
      (classeDaSerie(nome, site) === 'institucional' ? inst : aula).push(porNome[nome]);
    });

    var saida = [];
    if (aula.length) saida.push({ id: 'aula', titulo: 'Para a aula', series: aula });
    if (inst.length) saida.push({ id: 'institucional', titulo: 'Do Goiás Tec', series: inst });
    return saida;
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

  /* Os chips do FILTRO POR SÉRIE, que saíram do cabeçalho na D5 e moram na
   * grade da resposta — busca e "Ver tudo".
   *
   * Recebe a resposta ANTES do filtro de série e oferece só as séries que
   * estão nela: os 23 chips de antes, sobre uma busca de 3 resultados, eram 21
   * caminhos para "Nada encontrado". Uma série só não pede filtro — não há o
   * que escolher —, e aí a lista volta vazia e a linha nem é desenhada.
   *
   * A série LIGADA fica sempre, mesmo quando a resposta não a tem mais: é o
   * botão que desfaz o filtro. */
  function seriesDoFiltro(itens, ativa) {
    var nomes = series(itens);
    if (ativa && nomes.indexOf(ativa) < 0) nomes.push(ativa);
    return nomes.length >= 2 || ativa ? nomes : [];
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

  /* -------------------------------------------------------- filas de trabalho
   *
   * M3: três filas que a mesa oferece para andar item por item, sempre na
   * mesma ordem de `ordenar` — senão "3 de 56" mudaria de sentido a cada
   * redesenho. Puras: não sabem de tela, só filtram e ordenam. */

  function filaSinopses(itens) {
    return ordenar((itens || []).filter(precisaRevisao));
  }

  function filaSemSinopse(itens) {
    return ordenar((itens || []).filter(function (i) { return !!i && i.publicar === true && !i.sinopse; }));
  }

  function filaPendencias(itens) {
    return ordenar((itens || []).filter(function (i) { return !!i && !!i.pendencia; }));
  }

  /* "curta-kalunga-2024-v1" e "curta-kalunga-2024-master" têm a mesma base —
   * é a convenção de nome que separa duas versões do mesmo material (ver
   * catalogo/ESTADO.md). Não é um vínculo gravado no dado, é o único sinal que
   * existe hoje para achar a "outra versão" de uma pendência `versao_duplicada`. */
  function baseIdSemVersao(id) {
    return String(id || '').replace(/-(v\d+|master)$/i, '');
  }

  function outraVersaoDuplicada(itens, item) {
    if (!item) return null;
    var base = baseIdSemVersao(item.id);
    return (itens || []).find(function (i) { return i && i.id !== item.id && baseIdSemVersao(i.id) === base; }) || null;
  }

  /* -------------------------------------------------------- rascunho da mesa
   *
   * O rascunho é uma lista de mudanças campo a campo — { alvo, campo, antes,
   * depois } —, e o alvo é o id de um título ou 'ajustes'. Tudo aqui é puro:
   * quem guarda a lista (no navegador) e quem grava (o Publicar) são da mesa.
   * PLANO-MESA §3.2. */

  /* O que a mesa edita. `id`, `fonte` e `rev` ficam de fora: um `fonte` trocado
   * aponta a ficha para outro vídeo, e o `rev` é a trava de concorrência. */
  var CAMPOS_ITEM_MESA = ['titulo', 'serie', 'temporada', 'episodio', 'ano', 'sinopse',
    'sinopse_origem', 'tema', 'publico_alvo', 'tags', 'pendencia', 'publicar',
    'titularidade', 'nivel_evidencia', 'capa_arquivo', 'capa_versao', 'nota_curadoria',
    'destaque'];
  var CAMPOS_AJUSTES_MESA = ['arrastoTeto', 'controlesEspera'];

  /* O alvo `site` da M4. Os quatro campos são os objetos INTEIROS — e não "a
   * prateleira X" ou "o texto Y" — porque é assim que o Publicar confere contra
   * a leitura fresca do servidor: duas pessoas arrumando a chegada ao mesmo
   * tempo têm de brigar, e não gravar uma por cima da outra em silêncio. O
   * preço é um conflito a mais quando as duas mexem em prateleiras diferentes,
   * e ele é barato: a mesa mostra os dois valores e deixa escolher. */
  var CAMPOS_SITE_MESA = ['destaque', 'prateleiras', 'classes', 'textos'];

  function campoDaMesa(alvo, campo) {
    if (alvo === 'ajustes') return CAMPOS_AJUSTES_MESA.indexOf(campo) >= 0;
    if (alvo === 'site') return CAMPOS_SITE_MESA.indexOf(campo) >= 0;
    return CAMPOS_ITEM_MESA.indexOf(campo) >= 0;
  }

  /* Igual por valor: `tags` é lista, e ausente vale o mesmo que nulo. */
  function mesmoValor(a, b) {
    return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  }

  /* Mudar o mesmo campo de novo guarda o `antes` da PRIMEIRA vez — é contra ele
   * que o Publicar confere se outra tela mexeu. Voltar ao original tira a
   * mudança da lista. Devolve uma lista nova. */
  function registrarMudanca(lista, m) {
    var saida = [];
    var achou = false;
    (lista || []).forEach(function (x) {
      if (x.alvo !== m.alvo || x.campo !== m.campo) { saida.push(x); return; }
      achou = true;
      if (!mesmoValor(x.antes, m.depois)) {
        saida.push({ alvo: x.alvo, campo: x.campo, antes: x.antes, depois: m.depois });
      }
    });
    if (!achou && !mesmoValor(m.antes, m.depois)) {
      saida.push({ alvo: m.alvo, campo: m.campo, antes: m.antes, depois: m.depois });
    }
    return saida;
  }

  function valorNoCatalogo(catalogo, alvo, campo) {
    if (alvo === 'ajustes') {
      return { existe: true, valor: catalogo && catalogo.ajustes ? catalogo.ajustes[campo] : undefined };
    }
    /* O `site` pode não existir no documento, e isso não é "campo sumido": é o
     * catálogo que nunca teve estrutura escolhida. O `undefined` é o valor de
     * antes, e é contra ele que o Publicar confere. */
    if (alvo === 'site') {
      return { existe: true, valor: catalogo && catalogo.site ? catalogo.site[campo] : undefined };
    }
    var item = porId(catalogo && catalogo.itens, alvo);
    return item ? { existe: true, valor: item[campo] } : { existe: false };
  }

  /* O catálogo com o rascunho por cima, numa cópia: a mesa guarda o original
   * para mostrar o "antes" e o site no ar. Campo fora da lista é ignorado. */
  function aplicarRascunho(catalogo, lista) {
    var copia = JSON.parse(JSON.stringify(catalogo || {}));
    var destacado = null;
    (lista || []).forEach(function (m) {
      if (!campoDaMesa(m.alvo, m.campo)) return;
      if (m.alvo === 'ajustes') {
        copia.ajustes = copia.ajustes || {};
        copia.ajustes[m.campo] = m.depois;
        return;
      }
      if (m.alvo === 'site') {
        copia.site = copia.site || {};
        copia.site[m.campo] = m.depois;
        return;
      }
      var item = porId(copia.itens, m.alvo);
      if (!item) return;
      /* Desmarcar é APAGAR o campo, como o /admin fazia: `false`, `null` e a
       * ausência são a mesma coisa para quem lê (`paraPublico`). */
      if (m.campo === 'destaque') {
        if (m.depois === true) { item.destaque = true; destacado = item; } else delete item.destaque;
        return;
      }
      item[m.campo] = m.depois;
    });

    /* O DESTAQUE É UM (D4), e a regra é aplicada AQUI, sobre a leitura fresca
     * do Publicar — não confiada ao rascunho. Se outra tela marcou um terceiro
     * título enquanto este rascunho esperava, a conferência campo a campo não
     * veria: são campos diferentes. Então quem o rascunho destaca apaga a marca
     * de todos os outros, na mesma gravação. E título fora do ar não fica com
     * a marca, mesmo que o rascunho mande. */
    if (destacado && destacado.publicar !== true) {
      /* Fora do ar não recebe a marca — e a de hoje fica onde está: a chegada
       * não perde o destaque por causa de um pedido que não vale. */
      delete destacado.destaque;
    } else if (destacado) {
      (copia.itens || []).forEach(function (i) { if (i !== destacado && i.destaque === true) delete i.destaque; });
    }
    return copia;
  }

  /* Conflito é o MESMO campo mudado por outra tela desde o começo do rascunho.
   * Se o servidor já tem o `depois`, alguém fez a mesma mudança: não é
   * conflito. Título que sumiu do catálogo é conflito — gravar nele seria
   * gravar no vazio. */
  function conflitosRascunho(catalogo, lista) {
    var saida = [];
    (lista || []).forEach(function (m) {
      var atual = valorNoCatalogo(catalogo, m.alvo, m.campo);
      if (!atual.existe) { saida.push({ alvo: m.alvo, campo: m.campo, sumiu: true }); return; }
      if (mesmoValor(atual.valor, m.antes) || mesmoValor(atual.valor, m.depois)) return;
      saida.push({ alvo: m.alvo, campo: m.campo, antes: m.antes, depois: m.depois, noServidor: atual.valor });
    });
    return saida;
  }


  /* ----------------------------------------------------------- histórico (M5)
   *
   * Cada publicação deixa dois rastros no KV, ao lado do catálogo:
   *
   *   - `historico:<chave>` — o que mudou, campo a campo, com o resumo nos
   *     METADADOS da chave. A linha do tempo sai de UMA listagem, sem abrir
   *     registro nenhum;
   *   - `versao:<rev>` — a cópia inteira, para ver como estava e restaurar. As
   *     30 últimas; a mais velha sai a cada publicação (PLANO-MESA §2 e §3.5).
   *
   * A CHAVE DO HISTÓRICO É INVERTIDA, e isso não é firula. A listagem do KV é
   * sempre ASCENDENTE e não tem "ordem inversa": com a rev crua na chave, mostrar
   * as 20 publicações mais novas exigiria percorrer TODAS as páginas até o fim —
   * e o histórico cresce para sempre. Guardando `LIMITE_REV - rev`, a primeira
   * página da listagem já é o topo da linha do tempo, com uma operação só. */
  var LIMITE_REV = 1000000000;

  function chaveHistorico(rev) {
    var n = Math.max(0, Math.min(LIMITE_REV, Math.floor(Number(rev) || 0)));
    return 'historico:' + String(LIMITE_REV - n).padStart(10, '0');
  }

  function revDaChaveHistorico(chave) {
    var m = /^historico:(\d{10})$/.exec(String(chave || ''));
    return m ? LIMITE_REV - Number(m[1]) : null;
  }

  /* A cópia usa a rev CRUA, com zeros à esquerda: a listagem ascendente devolve
   * a mais velha primeiro, que é justamente a que sai quando passam de 30. */
  function chaveVersao(rev) {
    var n = Math.max(0, Math.floor(Number(rev) || 0));
    return 'versao:' + String(n).padStart(10, '0');
  }

  function revDaChaveVersao(chave) {
    var m = /^versao:(\d{10})$/.exec(String(chave || ''));
    return m ? Number(m[1]) : null;
  }

  /* De que tipo foram as mudanças de uma publicação. Vai nos metadados da
   * chave — que têm 1 KB e não aguentam a lista inteira —, e é o que a linha do
   * tempo mostra sem abrir o registro. */
  function contarMudancasPorAlvo(difs) {
    var conta = { total: 0, titulos: 0, campos: 0, estrutura: 0, ajustes: 0, novos: 0, removidos: 0 };
    var vistos = Object.create(null);
    (difs || []).forEach(function (d) {
      if (!d) return;
      conta.total++;
      if (d.alvo === 'site' || d.alvo === 'catalogo') { conta.estrutura++; return; }
      if (d.alvo === 'ajustes') { conta.ajustes++; return; }
      if (d.tipo === 'novo') { conta.novos++; }
      else if (d.tipo === 'removido') { conta.removidos++; }
      else { conta.campos++; }
      if (!vistos[d.alvo]) { vistos[d.alvo] = true; conta.titulos++; }
    });
    return conta;
  }

  /* A frase da linha do tempo. Some com o que é zero: "3 títulos · estrutura"
   * diz mais do que "3 títulos, 0 ajustes, 0 novos, 0 removidos". */
  function resumoDeMudancas(conta) {
    if (!conta || !conta.total) return 'nada mudou';
    var partes = [];
    if (conta.titulos) partes.push(conta.titulos + (conta.titulos === 1 ? ' título' : ' títulos'));
    if (conta.novos) partes.push(conta.novos + (conta.novos === 1 ? ' novo' : ' novos'));
    if (conta.removidos) partes.push(conta.removidos + (conta.removidos === 1 ? ' removido' : ' removidos'));
    if (conta.estrutura) partes.push('estrutura');
    if (conta.ajustes) partes.push('player');
    return partes.join(' · ') || conta.total + ' alterações';
  }

  /* DESFAZER É UM RASCUNHO NOVO (§3.5): a mesa monta a mudança contrária e ela
   * passa pelo mesmo Publicar, pela mesma conferência de conflito e pela mesma
   * permissão. Não existe um caminho de gravação "do histórico".
   *
   * O que NÃO dá para desfazer assim é título criado ou removido: o rascunho
   * mexe em campo, não em existência. A função diz não em vez de fingir. */
  function desfazerMudanca(dif) {
    if (!dif || !dif.campo || dif.campo === '*') return null;
    if (!campoDaMesa(dif.alvo === 'site' || dif.alvo === 'ajustes' ? dif.alvo : 'item', dif.campo)) return null;
    return { alvo: dif.alvo, campo: dif.campo, valor: dif.antes === undefined ? null : dif.antes };
  }

  /* ------------------------------------------------------ contas e permissões
   *
   * O superadmin é a senha do ambiente e pode tudo. As outras contas moram no
   * KV, e o superadmin escolhe para cada uma quais destas permissões valem —
   * uma, várias ou todas (PLANO-MESA §3.4).
   *
   * A conferência de verdade é no SERVIDOR, campo a campo: o PUT compara o
   * catálogo velho com o novo e recusa o que a conta não pode mudar. Esconder
   * botão na tela é conveniência; segurança é isto aqui. */
  var PERMISSOES = ['conteudo', 'no-ar', 'enviar', 'estrutura', 'player', 'historico'];

  var ROTULO_PERMISSAO = {
    conteudo: 'Conteúdo',
    'no-ar': 'Pôr e tirar do ar',
    enviar: 'Enviar vídeo',
    estrutura: 'Estrutura da chegada',
    player: 'Ajustes do player',
    historico: 'Histórico'
  };

  var AJUDA_PERMISSAO = {
    conteudo: 'título, série, número, ano, sinopse, tema, tags, capa e pendência',
    'no-ar': 'pôr um título na chegada e tirar de lá',
    enviar: 'subir vídeo novo ao Bunny — é o que ocupa armazenamento pago',
    estrutura: 'o destaque da chegada, o nome e a ordem das prateleiras, a classe das séries e os textos fixos',
    player: 'o arrasto e o sumiço dos controles',
    historico: 'desfazer mudança de outra pessoa e restaurar versão (M5)'
  };

  /* Os campos de um título que a permissão `conteudo` cobre. `publicar`,
   * `destaque` e os ajustes têm permissão própria; o resto — `fonte`, `id`,
   * `capitulos`, `framerate`, `duracao` — é só do superadmin, porque não sai
   * da mesa: sai de script. */
  var CAMPOS_CONTEUDO = ['titulo', 'serie', 'temporada', 'episodio', 'ano', 'sinopse',
    'sinopse_origem', 'tema', 'publico_alvo', 'tags', 'pendencia', 'titularidade',
    'nivel_evidencia', 'capa_arquivo', 'capa_versao', 'nota_curadoria'];

  function permissaoDoCampo(alvo, campo) {
    if (alvo === 'ajustes') return CAMPOS_AJUSTES_MESA.indexOf(campo) >= 0 ? 'player' : null;
    if (alvo === 'site') return CAMPOS_SITE_MESA.indexOf(campo) >= 0 ? 'estrutura' : null;
    if (campo === 'publicar') return 'no-ar';
    if (campo === 'destaque') return 'estrutura';
    return CAMPOS_CONTEUDO.indexOf(campo) >= 0 ? 'conteudo' : null;
  }

  /* Campos de topo que toda gravação reescreve, e que não são mudança de
   * ninguém: o servidor os recalcula no PUT. */
  var TOPO_IGNORADO = ['rev', 'total', 'atualizado_em', 'versao', 'config', 'itens', 'ajustes', 'site'];

  /* O que mudou entre dois catálogos, campo a campo, com a permissão que cada
   * diferença exige. É o que o PUT usa para recusar, e é a mesma lista que o
   * histórico da M5 vai guardar. */
  function diferencasDoCatalogo(antes, depois) {
    var saida = [];
    var velhos = Object.create(null);
    ((antes && antes.itens) || []).forEach(function (i) { if (i && i.id) velhos[i.id] = i; });
    var vistos = Object.create(null);

    ((depois && depois.itens) || []).forEach(function (novo) {
      if (!novo || !novo.id) return;
      vistos[novo.id] = true;
      var velho = velhos[novo.id];
      if (!velho) {
        saida.push({ alvo: novo.id, campo: '*', tipo: 'novo', permissao: 'enviar' });
        if (novo.publicar === true) saida.push({ alvo: novo.id, campo: 'publicar', antes: null, depois: true, permissao: 'no-ar' });
        if (novo.destaque === true) saida.push({ alvo: novo.id, campo: 'destaque', antes: null, depois: true, permissao: 'estrutura' });
        return;
      }
      var campos = Object.create(null);
      Object.keys(velho).forEach(function (k) { campos[k] = true; });
      Object.keys(novo).forEach(function (k) { campos[k] = true; });
      Object.keys(campos).forEach(function (campo) {
        if (campo === 'id') return;
        if (mesmoValor(velho[campo], novo[campo])) return;
        saida.push({ alvo: novo.id, campo: campo, antes: velho[campo], depois: novo[campo], permissao: permissaoDoCampo(novo.id, campo) });
      });
    });

    Object.keys(velhos).forEach(function (id) {
      if (!vistos[id]) saida.push({ alvo: id, campo: '*', tipo: 'removido', permissao: null });
    });

    var ajA = (antes && antes.ajustes) || {};
    var ajD = (depois && depois.ajustes) || {};
    var chavesAjuste = Object.create(null);
    Object.keys(ajA).concat(Object.keys(ajD)).forEach(function (k) { chavesAjuste[k] = true; });
    Object.keys(chavesAjuste).forEach(function (campo) {
      if (mesmoValor(ajA[campo], ajD[campo])) return;
      saida.push({ alvo: 'ajustes', campo: campo, antes: ajA[campo], depois: ajD[campo], permissao: permissaoDoCampo('ajustes', campo) });
    });

    /* A ESTRUTURA sai campo a campo, e não como "o campo `site` mudou" (M5): é
     * o que faz o histórico dizer QUAL parte da chegada mexeu, e é o que
     * permite desfazer uma delas sem desfazer as outras. Os nomes são os
     * mesmos do rascunho — `site` como alvo, os quatro campos —, então a
     * mudança contrária cabe no rascunho sem tradução nenhuma. */
    var siteA = (antes && antes.site) || {};
    var siteD = (depois && depois.site) || {};
    var camposSite = Object.create(null);
    Object.keys(siteA).concat(Object.keys(siteD)).forEach(function (k) { camposSite[k] = true; });
    Object.keys(camposSite).forEach(function (campo) {
      if (mesmoValor(siteA[campo], siteD[campo])) return;
      saida.push({ alvo: 'site', campo: campo, antes: siteA[campo], depois: siteD[campo], permissao: permissaoDoCampo('site', campo) });
    });

    var topo = Object.create(null);
    Object.keys(antes || {}).concat(Object.keys(depois || {})).forEach(function (k) { topo[k] = true; });
    Object.keys(topo).forEach(function (campo) {
      if (TOPO_IGNORADO.indexOf(campo) >= 0) return;
      if (mesmoValor((antes || {})[campo], (depois || {})[campo])) return;
      saida.push({ alvo: 'catalogo', campo: campo, permissao: null });
    });

    return saida;
  }

  function contaPode(conta, permissao) {
    if (!conta) return false;
    if (conta.super === true) return true;
    if (!permissao) return false;
    return (conta.permissoes || []).indexOf(permissao) >= 0;
  }

  /* As diferenças que esta conta NÃO pode gravar. Diferença sem permissão
   * (`fonte`, um título removido) é só do superadmin, de propósito. */
  function proibidas(conta, diferencas) {
    if (conta && conta.super === true) return [];
    return (diferencas || []).filter(function (d) { return !contaPode(conta, d.permissao); });
  }

  /* Usuário é minúsculo, sem acento e sem ponto: ele vai dentro do token, e o
   * ponto é o separador de lá. `superadmin` é reservado. */
  function usuarioValido(usuario) {
    return typeof usuario === 'string' && /^[a-z0-9][a-z0-9_-]{2,31}$/.test(usuario) &&
      usuario !== 'superadmin' && usuario !== 'admin';
  }

  var SENHA_MINIMA = 12;

  function senhaValida(senha) {
    return typeof senha === 'string' && senha.length >= SENHA_MINIMA;
  }

  function permissoesValidas(lista) {
    return Array.isArray(lista) && lista.every(function (p) { return PERMISSOES.indexOf(p) >= 0; });
  }

  /* O limite de envio é do superadmin para outra conta (M2+): quantos vídeos
   * ela pode subir, a duração máxima de cada um (em segundos), e se cada envio
   * espera aprovação manual antes de ir ao Bunny. `null` num campo é "sem
   * limite" — o padrão de uma conta nova. */
  function limiteEnvioValido(l) {
    if (l == null) return true;
    if (typeof l !== 'object') return false;
    var inteiroOuNulo = function (v) { return v == null || (Number.isFinite(v) && v >= 0 && Math.floor(v) === v); };
    if (!inteiroOuNulo(l.maxVideos)) return false;
    if (!inteiroOuNulo(l.maxDuracaoSeg)) return false;
    if (l.autorizacaoManual != null && typeof l.autorizacaoManual !== 'boolean') return false;
    return true;
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
    tituloCurto: tituloCurto,
    formatarMinutos: formatarMinutos,
    rotuloNumero: rotuloNumero,
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
    prateleiras: prateleiras,
    prateleirasVisiveis: prateleirasVisiveis,
    titulosSoEmEscondidas: titulosSoEmEscondidas,
    prateleiraPorId: prateleiraPorId,
    destaque: destaque,
    CLASSES_SERIE: CLASSES_SERIE,
    TEXTOS_PADRAO: TEXTOS_PADRAO,
    siteSaneado: siteSaneado,
    siteVazio: siteVazio,
    classeDaSerie: classeDaSerie,
    textoDoSite: textoDoSite,
    comPrateleira: comPrateleira,
    comOrdemPrateleiras: comOrdemPrateleiras,
    comClasse: comClasse,
    comTexto: comTexto,
    SERIES_INSTITUCIONAIS: SERIES_INSTITUCIONAIS,
    SERIES_CURTAS: SERIES_CURTAS,
    SERIES_PEDAGOGICAS: SERIES_PEDAGOGICAS,
    MINIMO_PRATELEIRA: MINIMO_PRATELEIRA,
    series: series,
    gruposDeSeries: gruposDeSeries,
    seriesDoFiltro: seriesDoFiltro,
    buscar: buscar,
    filtrarPorSerie: filtrarPorSerie,
    porId: porId,
    vizinhos: vizinhos,
    slug: slug,
    idUnico: idUnico,
    precisaRevisao: precisaRevisao,
    filaSinopses: filaSinopses,
    filaSemSinopse: filaSemSinopse,
    filaPendencias: filaPendencias,
    baseIdSemVersao: baseIdSemVersao,
    outraVersaoDuplicada: outraVersaoDuplicada,
    itemNovo: itemNovo,
    CAMPOS_ITEM_MESA: CAMPOS_ITEM_MESA,
    CAMPOS_AJUSTES_MESA: CAMPOS_AJUSTES_MESA,
    CAMPOS_SITE_MESA: CAMPOS_SITE_MESA,
    registrarMudanca: registrarMudanca,
    aplicarRascunho: aplicarRascunho,
    conflitosRascunho: conflitosRascunho,
    PERMISSOES: PERMISSOES,
    ROTULO_PERMISSAO: ROTULO_PERMISSAO,
    AJUDA_PERMISSAO: AJUDA_PERMISSAO,
    CAMPOS_CONTEUDO: CAMPOS_CONTEUDO,
    SENHA_MINIMA: SENHA_MINIMA,
    permissaoDoCampo: permissaoDoCampo,
    diferencasDoCatalogo: diferencasDoCatalogo,
    chaveHistorico: chaveHistorico,
    revDaChaveHistorico: revDaChaveHistorico,
    chaveVersao: chaveVersao,
    revDaChaveVersao: revDaChaveVersao,
    contarMudancasPorAlvo: contarMudancasPorAlvo,
    resumoDeMudancas: resumoDeMudancas,
    desfazerMudanca: desfazerMudanca,
    contaPode: contaPode,
    proibidas: proibidas,
    usuarioValido: usuarioValido,
    senhaValida: senhaValida,
    permissoesValidas: permissoesValidas,
    limiteEnvioValido: limiteEnvioValido
  };

  raiz.GTM = GTM;
  if (typeof module !== 'undefined' && module.exports) module.exports = GTM;
})(typeof globalThis !== 'undefined' ? globalThis : this);
