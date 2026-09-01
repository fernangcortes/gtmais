/* app.js — catálogo público interno: grade, busca, ficha do título.
 *
 * Regras de produto que este arquivo tem obrigação de respeitar:
 *   1. nada toca sozinho     -> urlEmbed() força autoplay=false
 *   2. nada repete           -> urlEmbed() força loop=false
 *   3. nada avança sozinho   -> não há NENHUM listener de fim de vídeo aqui,
 *                               e a navegação entre episódios é só por clique.
 */
(function () {
  'use strict';

  var estado = {
    itens: [],
    config: {},
    termo: '',
    serie: '',
    carregado: false
  };

  var el = {
    busca: document.getElementById('busca'),
    chips: document.getElementById('chips'),
    avisos: document.getElementById('avisos'),
    grade: document.getElementById('conteudo-grade'),
    ficha: document.getElementById('conteudo-ficha')
  };

  var TITULO_BASE = 'Goiás Tec + — catálogo';

  /* -------------------------------------------------------------- utilidades */

  function criar(tag, classe, texto) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto != null) n.textContent = texto;
    return n;
  }

  function limpar(no) {
    while (no.firstChild) no.removeChild(no.firstChild);
  }

  function aviso(texto, tipoErro) {
    var d = criar('div', 'aviso' + (tipoErro ? ' aviso-erro' : ''), texto);
    return d;
  }

  /* ----------------------------------------------------------------- dados */

  function carregar() {
    return fetch('/api/catalogo', { headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('resposta ' + r.status);
        return r.json();
      })
      .then(function (dados) {
        estado.itens = Array.isArray(dados.itens) ? dados.itens : [];
        estado.config = dados.config || {};
        estado.carregado = true;
      });
  }

  /* ---------------------------------------------------------------- filtros */

  function visiveis() {
    var base = GTM.publicaveis(estado.itens);
    base = GTM.filtrarPorSerie(base, estado.serie);
    return GTM.buscar(base, estado.termo);
  }

  function renderChips() {
    limpar(el.chips);
    var todas = GTM.series(GTM.publicaveis(estado.itens));
    if (!todas.length) return;

    var faz = function (rotulo, valor) {
      var b = criar('button', 'chip', rotulo);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(estado.serie === valor));
      b.addEventListener('click', function () {
        estado.serie = estado.serie === valor ? '' : valor;
        renderChips();
        renderGrade();
      });
      el.chips.appendChild(b);
    };

    faz('Todas', '');
    todas.forEach(function (s) { faz(s, s); });
  }

  /* ------------------------------------------------------------------ grade */

  /* Consultado a cada hover, não uma vez no início: um tablet ganha mouse, um
   * notebook vira tela de toque e a preferência por menos movimento muda no
   * sistema com a página aberta. */
  function podePreview() {
    if (!window.matchMedia) return false;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* Trecho animado por cima da capa enquanto o ponteiro está sobre o cartão.
   *
   * As duas regras que este trecho existe para cumprir:
   *   1. o preview.webp tem ~450 KB — ele só pode ser PEDIDO no mouseenter e
   *      tem que ser DESCARTADO no mouseleave. Nada disso pode ir junto com a
   *      grade: 33 títulos de uma vez são ~15 MB na tela inicial.
   *   2. em toque não existe hover, e quem pediu menos movimento não quer isto:
   *      nesses casos o cartão fica só com a capa.
   */
  function ligarPreview(cartaoEl, capa, item) {
    var url = GTM.urlPreview(item, estado.config);
    if (!url) return;

    var img = null;
    var espera = 0;
    var indisponivel = false;

    function descartar() {
      if (espera) { clearTimeout(espera); espera = 0; }
      if (!img) return;
      /* Tirar o src antes de remover o nó aborta o download em andamento:
       * passar reto por um cartão não pode continuar puxando 450 KB. */
      img.removeAttribute('src');
      if (img.parentNode) img.parentNode.removeChild(img);
      img = null;
      capa.classList.remove('card-capa-com-previa');
    }

    cartaoEl.addEventListener('mouseenter', function () {
      if (indisponivel || img || espera || !podePreview()) return;
      /* Atravessar a grade com o mouse passa por dezenas de cartões. Sem esta
       * espera, cada um deles dispararia os seus 450 KB de passagem. */
      espera = setTimeout(function () {
        espera = 0;
        img = criar('img', 'card-previa');
        img.alt = '';
        img.decoding = 'async';
        /* Sem `referrerpolicy` aqui: a pull zone é protegida por Allowed
         * Referrers e responde 403 sem o cabeçalho Referer. Quem manda é a
         * política declarada no <meta> do index.html. */
        img.addEventListener('load', function () {
          capa.classList.add('card-capa-com-previa');
        });
        /* Título sem preview gerado no Bunny: desiste de vez e fica na capa. */
        img.addEventListener('error', function () {
          indisponivel = true;
          descartar();
        });
        img.src = url;
        capa.appendChild(img);
      }, 220);
    });

    cartaoEl.addEventListener('mouseleave', descartar);
  }

  function cartao(item) {
    var a = criar('a', 'card');
    a.href = '#/ep/' + encodeURIComponent(item.id);

    var capa = criar('div', 'card-capa');
    var url = GTM.urlCapa(item, estado.config);
    if (url) {
      var img = criar('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      /* Capa ausente na pull zone não pode deixar um ícone quebrado na grade. */
      img.addEventListener('error', function () {
        capa.replaceChild(criar('div', 'card-capa-vazia', 'sem capa'), img);
      });
      capa.appendChild(img);
    } else {
      capa.appendChild(criar('div', 'card-capa-vazia', 'sem capa'));
    }

    var dur = GTM.formatarDuracao(item);
    if (dur) capa.appendChild(criar('span', 'card-duracao', dur));
    a.appendChild(capa);
    ligarPreview(a, capa, item);

    var corpo = criar('div', 'card-corpo');
    corpo.appendChild(criar('h2', 'card-titulo', item.titulo || '(sem título)'));

    var meta = [item.serie, GTM.rotuloEpisodio(item), item.ano]
      .filter(Boolean).join(' · ');
    if (meta) corpo.appendChild(criar('p', 'card-meta', meta));

    /* Sinopse vazia não vira parágrafo vazio: há título publicado sem ela. */
    var resumo = GTM.resumoSinopse(item);
    if (resumo) corpo.appendChild(criar('p', 'card-sinopse', resumo));

    if (!GTM.resolverFonte(item, estado.config)) {
      corpo.appendChild(criar('span', 'selo selo-erro', 'vídeo indisponível'));
    } else if (item.pendencia) {
      corpo.appendChild(criar('span', 'selo', GTM.rotuloPendencia(item.pendencia)));
    }

    a.appendChild(corpo);
    return a;
  }

  function renderGrade() {
    limpar(el.grade);
    limpar(el.avisos);
    /* Esvaziar a ficha é o que PARA o vídeo. Apenas esconder o contêiner com
     * `hidden` deixa o iframe vivo no DOM, tocando — inclusive o áudio — quando
     * o usuário volta para a grade pelo botão do navegador. */
    limpar(el.ficha);
    el.ficha.hidden = true;
    el.grade.hidden = false;
    document.title = TITULO_BASE;

    if (!estado.carregado) return;

    var publicados = GTM.publicaveis(estado.itens);
    if (!publicados.length) {
      var v = criar('div', 'vazio');
      v.appendChild(criar('h2', null, 'Nenhum título publicado ainda'));
      v.appendChild(criar('p', null,
        'Os títulos aparecem aqui assim que forem marcados como publicados na área de administração.'));
      el.grade.appendChild(v);
      return;
    }

    var lista = visiveis();
    el.grade.appendChild(criar('p', 'contagem',
      lista.length + (lista.length === 1 ? ' título' : ' títulos') +
      (lista.length !== publicados.length ? ' de ' + publicados.length : '')));

    if (!lista.length) {
      var nada = criar('div', 'vazio');
      nada.appendChild(criar('h2', null, 'Nada encontrado'));
      nada.appendChild(criar('p', null, 'Tente outro termo ou remova o filtro de série.'));
      el.grade.appendChild(nada);
      return;
    }

    /* Uma grade só, sem cabeçalho de série: os blocos por série deixavam um
     * cartão sozinho por faixa e a tela inteira vazia à direita. A ordem
     * continua vindo de `ordenar()`, então cada série segue junta na grade —
     * quem quiser ver uma série isolada usa os chips do topo. */
    var grade = criar('div', 'grade');
    GTM.ordenar(lista).forEach(function (item) { grade.appendChild(cartao(item)); });
    el.grade.appendChild(grade);
  }

  /* -------------------------------------------------------------- capítulos */

  /* O player é um iframe de OUTRO domínio (player.mediadelivery.net). A página
   * não alcança o DOM dele: não recebe hover sobre a linha do tempo, não
   * desenha nada por cima e não troca a barra de controles. Os capítulos que
   * segmentam a linha do tempo e mostram o título no hover são os capítulos
   * NATIVOS do Bunny, gravados no vídeo por scripts/capitulos.mjs — não têm
   * nada a ver com este arquivo.
   *
   * O que este trecho faz é a outra metade: a lista clicável ao lado do
   * player. Ela atravessa a fronteira do iframe pelo único caminho que existe,
   * o Player.js do Bunny, que dá ao pai controle de reprodução por postMessage.
   *
   * REGRA DE PRODUTO: só chamamos `setCurrentTime`. NUNCA `play()`. Pular para
   * um capítulo posiciona o vídeo; quem decide tocar é quem aperta o play. */
  var PLAYERJS_URL = 'https://assets.mediadelivery.net/playerjs/playerjs-latest.min.js';
  var playerjsPromessa = null;

  /* Carregado sob demanda, e só na ficha de quem tem capítulos: a tela inicial
   * não paga por um script que ela não usa. */
  function carregarPlayerjs() {
    if (playerjsPromessa) return playerjsPromessa;
    playerjsPromessa = new Promise(function (resolve, reject) {
      if (window.playerjs) { resolve(window.playerjs); return; }
      var tag = document.createElement('script');
      tag.src = PLAYERJS_URL;
      tag.async = true;
      tag.addEventListener('load', function () {
        if (window.playerjs) resolve(window.playerjs);
        else reject(new Error('playerjs carregou sem expor window.playerjs'));
      });
      tag.addEventListener('error', function () {
        reject(new Error('não foi possível carregar o Player.js'));
      });
      document.head.appendChild(tag);
    });
    return playerjsPromessa;
  }

  /* Lista clicável dos capítulos. Devolve null quando o título não tem
   * nenhum — 22 dos 33 no ar não têm, e a ficha deles não pode ganhar uma
   * caixa vazia. */
  function listaCapitulos(item, iframe) {
    var caps = GTM.capitulos(item);
    if (!caps.length) return null;

    var secao = criar('section', 'capitulos');
    secao.setAttribute('aria-label', 'Capítulos do vídeo');
    secao.appendChild(criar('h2', 'capitulos-titulo', 'Capítulos'));

    var lista = criar('ol', 'capitulos-lista');
    var botoes = [];
    caps.forEach(function (c) {
      var li = criar('li');
      var b = criar('button', 'capitulo');
      b.type = 'button';
      b.appendChild(criar('span', 'capitulo-tempo', GTM.formatarTempo(c.inicio)));
      b.appendChild(criar('span', 'capitulo-nome', c.titulo));
      li.appendChild(b);
      lista.appendChild(li);
      botoes.push(b);
    });
    secao.appendChild(lista);

    var player = null;
    var pendente = null;   /* clique que chegou antes de o player responder */
    var atual = -1;

    function procurar(segundos) {
      if (player) player.setCurrentTime(segundos);
      else pendente = segundos;
    }

    function destacar(indice) {
      if (indice === atual) return;      /* timeupdate dispara muitas vezes por segundo */
      if (atual >= 0 && botoes[atual]) botoes[atual].removeAttribute('aria-current');
      if (indice >= 0 && botoes[indice]) botoes[indice].setAttribute('aria-current', 'true');
      atual = indice;
    }

    /* O clique é ligado JÁ, não depois do `ready`: entre desenhar a lista e o
     * iframe responder passam centenas de milissegundos, e um botão que ignora
     * o primeiro clique parece quebrado. O que chegar antes fica em `pendente`. */
    botoes.forEach(function (b, i) {
      b.addEventListener('click', function () { procurar(caps[i].inicio); });
    });

    carregarPlayerjs().then(function (playerjs) {
      /* Voltar para a grade destrói a ficha inteira. Se isso aconteceu enquanto
       * o script carregava, não há mais iframe para conversar — e instanciar o
       * Player em cima de um nó solto deixaria um listener de postMessage vivo. */
      if (!iframe.isConnected) return;

      var p = new playerjs.Player(iframe);
      p.on('ready', function () {
        if (!iframe.isConnected) return;
        player = p;
        secao.classList.add('capitulos-ativos');
        if (pendente != null) { p.setCurrentTime(pendente); pendente = null; }
        /* Só posição: nada aqui reage ao FIM do vídeo, e nada avança sozinho. */
        p.on('timeupdate', function (d) {
          destacar(GTM.capituloEm(caps, d && d.seconds));
        });
      });
    }).catch(function () {
      /* Sem Player.js a lista continua valendo como índice do vídeo, com os
       * horários. O que ela perde é o clique — e a classe `capitulos-ativos`,
       * que é quem dá o visual de coisa clicável, nunca entra. */
    });

    return secao;
  }

  /* ------------------------------------------------------------------ ficha */

  function linhaDados(dl, rotulo, valor) {
    if (!valor) return;
    dl.appendChild(criar('dt', null, rotulo));
    dl.appendChild(criar('dd', null, valor));
  }

  function renderFicha(id) {
    limpar(el.ficha);
    limpar(el.avisos);
    el.grade.hidden = true;
    el.ficha.hidden = false;

    var item = GTM.porId(GTM.publicaveis(estado.itens), id);
    if (!item) {
      el.ficha.appendChild(aviso('Título não encontrado ou ainda não publicado.', true));
      var volta = criar('a', 'botao', 'Voltar ao catálogo');
      volta.href = '#/';
      el.ficha.appendChild(volta);
      document.title = 'Não encontrado — ' + TITULO_BASE;
      return;
    }

    document.title = (item.titulo || 'Título') + ' — ' + TITULO_BASE;

    var voltar = criar('a', 'voltar', '← Voltar ao catálogo');
    voltar.href = '#/';
    el.ficha.appendChild(voltar);

    var grade = criar('div', 'ficha');

    /* ---- coluna do player ---- */
    var coluna = criar('div');
    var caixa = criar('div', 'player');
    var fonte = GTM.resolverFonte(item, estado.config);

    if (fonte) {
      var iframe = document.createElement('iframe');
      iframe.src = GTM.urlEmbed(fonte);
      iframe.title = 'Player — ' + (item.titulo || '');
      iframe.loading = 'lazy';
      /* `autoplay` fica DE FORA da permission policy de propósito: é a segunda
       * tranca contra o vídeo tocar sozinho, caso o parâmetro do player falhe. */
      iframe.setAttribute('allow', 'fullscreen; picture-in-picture; encrypted-media');
      iframe.setAttribute('allowfullscreen', '');
      caixa.appendChild(iframe);
    } else {
      caixa.appendChild(criar('div', 'player-ausente',
        'Vídeo ainda não disponível. O arquivo pode estar em processamento no servidor de vídeo.'));
    }
    coluna.appendChild(caixa);

    /* Capítulos: a linha do tempo segmentada e o título no hover vêm do próprio
     * Bunny; esta lista é o atalho clicável, e só existe quando há player. */
    if (fonte) {
      var caps = listaCapitulos(item, caixa.querySelector('iframe'));
      if (caps) coluna.appendChild(caps);
    }

    /* Navegação explícita: só muda de episódio quando alguém clica. */
    var viz = GTM.vizinhos(estado.itens, item.id);
    if (viz.anterior || viz.proximo) {
      var nav = criar('nav', 'navegacao');
      nav.setAttribute('aria-label', 'Episódios da série');
      if (viz.anterior) {
        var ant = criar('a', 'botao', '← ' + viz.anterior.titulo);
        ant.href = '#/ep/' + encodeURIComponent(viz.anterior.id);
        nav.appendChild(ant);
      }
      if (viz.proximo) {
        var prox = criar('a', 'botao', viz.proximo.titulo + ' →');
        prox.href = '#/ep/' + encodeURIComponent(viz.proximo.id);
        nav.appendChild(prox);
      }
      coluna.appendChild(nav);
    }
    grade.appendChild(coluna);

    /* ---- coluna dos metadados ---- */
    var lado = criar('div');
    lado.appendChild(criar('h1', null, item.titulo || '(sem título)'));

    var meta = [item.serie, GTM.rotuloEpisodio(item), GTM.formatarDuracao(item), item.ano]
      .filter(Boolean).join(' · ');
    lado.appendChild(criar('p', 'ficha-meta', meta));

    if (item.pendencia) {
      lado.appendChild(aviso(GTM.rotuloPendencia(item.pendencia)));
    }

    if (item.sinopse) {
      lado.appendChild(criar('p', 'sinopse', item.sinopse));
    } else {
      lado.appendChild(criar('p', 'sinopse sinopse-vazia', 'Sinopse ainda não disponível.'));
    }

    var dl = criar('dl', 'dados');
    linhaDados(dl, 'Tema', item.tema);
    linhaDados(dl, 'Público-alvo', item.publico_alvo);
    linhaDados(dl, 'Tags', (item.tags || []).join(', '));
    linhaDados(dl, 'Titularidade', item.titularidade);
    linhaDados(dl, 'Evidência', item.nivel_evidencia);
    if (dl.childNodes.length) lado.appendChild(dl);

    grade.appendChild(lado);
    el.ficha.appendChild(grade);

    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------------ rotas */

  function rotear() {
    var hash = window.location.hash || '#/';
    var m = hash.match(/^#\/ep\/(.+)$/);
    if (m) renderFicha(decodeURIComponent(m[1]));
    else renderGrade();
  }

  /* ----------------------------------------------------------------- início */

  function iniciar() {
    el.busca.addEventListener('input', function () {
      estado.termo = el.busca.value;
      /* A busca só faz sentido na grade; digitar volta para ela. */
      if (window.location.hash && window.location.hash !== '#/') window.location.hash = '#/';
      else renderGrade();
    });

    window.addEventListener('hashchange', rotear);

    carregar().then(function () {
      renderChips();
      rotear();
    }).catch(function (erro) {
      estado.carregado = false;
      limpar(el.grade);
      el.ficha.hidden = true;
      el.grade.hidden = false;
      var v = criar('div', 'vazio');
      v.appendChild(criar('h2', null, 'Não foi possível carregar o catálogo'));
      v.appendChild(criar('p', null,
        'A página está no ar, mas o catálogo não respondeu (' + erro.message + '). ' +
        'Recarregue em alguns instantes; se persistir, avise a equipe técnica.'));
      el.grade.appendChild(v);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
