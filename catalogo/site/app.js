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
    /* A estrutura escolhida na mesa (M4): nome, ordem e escondida das
     * prateleiras, classe de cada série, o destaque e os textos fixos. Vem
     * SANEADA do servidor, e `{}` significa "ninguém escolheu nada" — aí vale
     * o padrão do `catalogo-core.js`, que é a chegada de sempre. */
    site: {},
    termo: '',
    /* O chip ligado no filtro da grade — '' quando nenhum. Refina a resposta
     * de UMA tela, e trocar de tela o desfaz. */
    serie: '',
    /* O id da prateleira aberta pelo "Ver tudo" — '' na chegada. É o que
     * distingue a tela inicial (prateleiras) de uma resposta (grade). */
    prateleira: '',
    /* A série da rota `#/serie/<nome>` — a grade dela, até a D6 fazer dessa
     * rota a página da série. */
    serieRota: '',
    /* `#/series`: a página Séries, para onde os chips da chegada foram. */
    indiceSeries: false,
    /* O hash da última tela desenhada, para saber quando se TROCOU de tela. */
    rota: null,
    carregado: false
  };

  var el = {
    topo: document.getElementById('topo'),
    sentinela: document.getElementById('topo-sentinela'),
    pular: document.getElementById('pular'),
    conteudo: document.getElementById('conteudo'),
    busca: document.getElementById('busca'),
    abrirBusca: document.getElementById('busca-abrir'),
    fecharBusca: document.getElementById('busca-fechar'),
    linkInicio: document.querySelector('.topo-link[data-inicio]'),
    linkSeries: document.querySelector('.topo-link[href="#/series"]'),
    avisos: document.getElementById('avisos'),
    grade: document.getElementById('conteudo-grade'),
    ficha: document.getElementById('conteudo-ficha')
  };

  var TITULO_BASE = 'Goiás Tec + — catálogo';

  /* ------------------------------------------------------------- modo mesa
   *
   * O /admin mostra o site dentro de um <iframe> com `?mesa=1` (PLANO-MESA
   * §3.1). Nesse modo a página não busca a API: recebe da mesa o catálogo com
   * o rascunho aplicado, marca o que é editável com `data-mesa` e avisa a mesa
   * de cada clique. Quem desenha continua sendo este arquivo — nada é
   * desenhado duas vezes.
   *
   * As duas travas: fora de um quadro, `?mesa=1` não liga nada; e mensagem só
   * vale se vier da própria origem E da janela de cima. */
  var mesa = {
    ligada: window.parent !== window && /[?&]mesa=1(&|$)/.test(window.location.search),
    selecao: '',
    /* Quem não tem a permissão de conteúdo vê a ficha, mas não digita nela.
     * Quem recusa de verdade é o servidor; isto é para o texto não mudar na
     * tela e depois voltar atrás. */
    editavel: true
  };

  function avisarMesa(msg) {
    if (!mesa.ligada) return;
    msg.gtm = 'mesa';
    window.parent.postMessage(msg, window.location.origin);
  }

  function marcarMesa(no, alvo) {
    if (!mesa.ligada || !no) return no;
    no.setAttribute('data-mesa', alvo);
    if (mesa.selecao === alvo) no.classList.add('mesa-sel');
    return no;
  }

  function pintarSelecao() {
    var velhos = document.querySelectorAll('.mesa-sel');
    for (var i = 0; i < velhos.length; i++) velhos[i].classList.remove('mesa-sel');
    if (!mesa.selecao) return;
    var novos = document.querySelectorAll('[data-mesa="' + CSS.escape(mesa.selecao) + '"]');
    for (var j = 0; j < novos.length; j++) novos[j].classList.add('mesa-sel');
  }

  /* Rola até o alvo SEM scrollIntoView: dentro de um quadro, ele rola também a
   * página de fora, e a mesa inteira sairia do lugar. */
  function rolarAteMesa(alvo) {
    var no = document.querySelector('[data-mesa="' + CSS.escape(alvo) + '"]');
    if (!no) return;
    var pista = no.closest('.prateleira-pista');
    if (pista) pista.scrollLeft += no.getBoundingClientRect().left - pista.getBoundingClientRect().left - 16;
    window.scrollTo(0, window.scrollY + no.getBoundingClientRect().top - 120);
  }

  /* O player nosso — padrão desde 03/09, com `?player=embed` como saída de
   * emergência. Fica aqui fora porque ele tem que ser DESTRUÍDO ao sair
   * da ficha, e não só removido do DOM: tirar o <video> da página para o
   * elemento, mas a instância do hls.js continua viva, com os carregadores
   * dela, puxando segmentos da pull zone para um vídeo que ninguém está vendo.
   * Com o iframe do Bunny isso não existia — remover o nó bastava. */
  var playerAtivo = null;

  function destruirPlayer() {
    if (!playerAtivo) return;
    playerAtivo.destruir();
    playerAtivo = null;
  }

  function playerNovoLigado() {
    return typeof GTMPlayer !== 'undefined' && GTMPlayer.pedido();
  }

  /* -------------------------------------------------------------- utilidades */

  function criar(tag, classe, texto) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto != null) n.textContent = texto;
    return n;
  }

  /* Os textos fixos do site: o rodapé e os cinco estados do B8. O padrão mora
   * no `catalogo-core.js`; `estado.site.textos` só troca o que alguém escreveu
   * na mesa (M4). Chamada na hora de desenhar, e não guardada numa constante,
   * porque dentro da mesa o texto muda a cada tecla do rascunho. */
  function frase(chave) {
    return GTM.textoDoSite(estado.site, chave);
  }

  function limpar(no) {
    while (no.firstChild) no.removeChild(no.firstChild);
  }

  function aviso(texto, tipoErro) {
    var d = criar('div', 'aviso' + (tipoErro ? ' aviso-erro' : ''), texto);
    return d;
  }

  /* ----------------------------------------------------------------- dados */

  function receberDados(dados) {
    estado.itens = Array.isArray(dados.itens) ? dados.itens : [];
    /* Os ajustes do player (o teto do arranco, hoje) viajam DENTRO do
     * config: é o objeto que já chega ao player e à capa, e criar um
     * segundo canal para um número seria um caminho a mais para manter.
     * Eles vêm do catálogo, não do ambiente — por isso são um campo à
     * parte na resposta da API. */
    estado.config = Object.assign({}, dados.config || {},
      { ajustes: dados.ajustes || {} });
    estado.site = dados.site || {};
    estado.carregado = true;
    pintarRodape();
  }

  /* O rodapé mora no HTML, e continua morando: ele é desenhado com a página,
   * antes de o catálogo responder, e tirá-lo de lá o faria chegar depois. O
   * texto escolhido na mesa entra POR CIMA, e só quando é diferente do que já
   * está escrito — escrever igual seria mexer no DOM à toa, e o rodapé é
   * justamente quem já foi o dono do CLS desta página (PLANO-DESIGN §7).
   *
   * Há teste cobrando que o texto do `index.html` e o padrão do
   * `catalogo-core.js` são o MESMO: se separarem, o rodapé pisca a cada carga
   * em todas as visitas, e ninguém ligaria uma coisa à outra. */
  function pintarRodape() {
    var caixa = document.querySelector('.rodape .limite');
    if (!caixa) return;
    var no = caixa.firstChild;
    if (!no || no.nodeType !== 3) return;   /* 3 = nó de texto */
    var novo = frase('rodape') + ' · ';
    if (no.nodeValue.trim() === novo.trim()) return;
    no.nodeValue = novo;
  }

  function carregar() {
    /* Na mesa o catálogo vem dela, com o rascunho por cima — e com os títulos
     * fora do ar, que a API pública não devolve. A página avisa que está
     * pronta, e a mesa responde com o catálogo. */
    if (mesa.ligada) {
      return new Promise(function (resolve) {
        mesa.aoPrimeiroCatalogo = resolve;
        avisarMesa({ tipo: 'pronto' });
      });
    }
    return fetch('/api/catalogo', { headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('resposta ' + r.status);
        return r.json();
      })
      .then(receberDados);
  }

  /* ---------------------------------------------------------------- filtros */

  /* A lista de onde a GRADE parte, antes da busca e do chip: a prateleira do
   * "Ver tudo", a série da rota `#/serie/<nome>`, ou o catálogo inteiro. */
  function baseDaGrade() {
    /* O "Ver tudo" parte da MESMA prateleira que a chegada desenhou, achada
     * pelo id — a regra dela não é reescrita aqui. O chip filtra por cima.
     * Digitar na busca SAI do "Ver tudo" e procura no catálogo inteiro — ver
     * `aoDigitar`. */
    if (estado.prateleira) {
      var p = GTM.prateleiraPorId(estado.itens, estado.prateleira, estado.site);
      return p ? p.itens : [];
    }
    var base = GTM.publicaveis(estado.itens);
    if (estado.serieRota) return GTM.filtrarPorSerie(base, estado.serieRota);
    return base;
  }

  /* O FILTRO POR SÉRIE — os chips que moravam no cabeçalho e saíram dele na D5
   * (decisão D8). Agora eles nascem DENTRO da grade, no mesmo quadro que os
   * cartões, e só com as séries que estão na resposta (`seriesDoFiltro`).
   *
   * Nascer junto com a grade é o que dispensa a reserva de altura de antes: a
   * linha não existe vazia em momento nenhum, e não empurra nada ao chegar. */
  function filtroSeries(opcoes) {
    var caixa = criar('div', 'chips');
    caixa.setAttribute('role', 'group');
    caixa.setAttribute('aria-label', 'Filtrar por série');

    var faz = function (rotulo, valor) {
      var b = criar('button', 'chip', rotulo);
      b.type = 'button';
      b.setAttribute('data-serie', valor);
      b.setAttribute('aria-pressed', String(estado.serie === valor));
      b.addEventListener('click', function () {
        var rolagem = caixa.scrollLeft;
        estado.serie = estado.serie === valor ? '' : valor;
        renderGrade();

        /* O botão apertado acabou de ser RECRIADO junto com a grade, e a linha
         * inteira com ele. Duas coisas se perdiam, as duas medidas em 15/09:
         *   - o FOCO caía no <body>, e quem usa teclado voltava ao começo da
         *     página a cada filtro (ainda com a linha no cabeçalho);
         *   - a ROLAGEM DE LADO voltava a zero: o chip apertado, se estava no
         *     fim da linha, ficava fora da tela com o foco nele — em 375 px,
         *     15 dos 78 px dele à mostra.
         * A rolagem é devolvida primeiro, e o chip é trazido inteiro para a
         * vista só se ainda faltar um pedaço dele. */
        var nova = el.grade.querySelector('.chips');
        if (!nova) return;
        nova.scrollLeft = rolagem;
        var novos = nova.querySelectorAll('.chip');
        for (var i = 0; i < novos.length; i++) {
          if (novos[i].getAttribute('data-serie') !== valor) continue;
          novos[i].focus({ preventScroll: true });
          novos[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
          break;
        }
      });
      caixa.appendChild(b);
    };

    faz('Todas', '');
    opcoes.forEach(function (s) { faz(s, s); });
    return caixa;
  }

  /* -------------------------------------------------------------- cabeçalho */

  /* O CABEÇALHO FLUTUANTE (D5): sem fundo com a página no alto, sólido assim
   * que alguma coisa passa por baixo dele — "ao rolar, sólido", como a §5.2
   * pede.
   *
   * NENHUM OUVINTE DE `scroll`, e há teste. Um ouvinte de rolagem roda dezenas
   * de vezes por segundo, na mesma linha de execução que desenha a página;
   * aqui quem avisa é o navegador, uma vez em cada travessia.
   *
   * O ALVO É UMA SENTINELA de 1 px no alto do documento, e não o destaque, como
   * a §5.2 sugeria. As razões apareceram ao desenhar:
   *   - no celular deitado, 812×375, o destaque tem 602 px de altura para 302
   *     livres abaixo deste cabeçalho, e 251 abaixo do de antes (medido em
   *     15/09): um limiar de 100% nele nunca dispara. Com 0%, o cabeçalho
   *     ficaria sem fundo enquanto o título do destaque passa por baixo do
   *     logo — texto sobre texto, sem contraste que se possa medir;
   *   - o destaque é recriado a cada `renderGrade`, e não existe na ficha, na
   *     grade nem na página Séries: o observador teria que ser religado a cada
   *     tela. A sentinela dá a mesma regra em todas, ligada uma vez.
   *
   * Sem IntersectionObserver o cabeçalho fica SÓLIDO de vez: é o estado que
   * nunca deixa conteúdo passar por baixo de um cabeçalho sem fundo. */
  function ligarTopo() {
    if (typeof IntersectionObserver === 'undefined') {
      el.topo.classList.add('topo-solido');
      return;
    }
    new IntersectionObserver(function (entradas) {
      /* Numa rolagem rápida duas travessias podem chegar juntas: vale a
       * última, que é o estado de agora. */
      el.topo.classList.toggle('topo-solido', !entradas[entradas.length - 1].isIntersecting);
    }).observe(el.sentinela);
  }

  /* O link da seção em que a pessoa está, dito ao leitor de tela por
   * `aria-current` — e é o mesmo atributo que pinta o sublinhado no CSS, então
   * o que se vê e o que se ouve não discordam. '' desmarca os dois. */
  function marcarNav(secao) {
    [[el.linkInicio, 'inicio'], [el.linkSeries, 'series']].forEach(function (par) {
      if (par[1] === secao) par[0].setAttribute('aria-current', 'page');
      else par[0].removeAttribute('aria-current');
    });
  }

  /* A BUSCA NO CELULAR mora atrás de um botão. Com o campo sempre à mostra, o
   * cabeçalho de 375 px tinha 137 px de altura, preso no alto da tela — 17%
   * dela, o tempo todo (medido em 15/09). Aberto, o campo toma o lugar do logo
   * e dos links, na mesma linha e com a mesma altura. Quem esconde e mostra é
   * o CSS; no computador a classe não muda nada, e o campo está sempre lá.
   *
   * `aria-expanded` é o que diz a quem ouve a página que a busca abriu. */
  function marcarBusca(aberta) {
    el.topo.classList.toggle('topo-buscando', aberta);
    el.abrirBusca.setAttribute('aria-expanded', String(aberta));
  }

  function abrirBusca() {
    marcarBusca(true);
    el.busca.focus();
  }

  /* Esquece a busca inteira: o termo, o campo e o chip que a refinava. */
  function esquecerBusca() {
    estado.termo = '';
    estado.serie = '';
    el.busca.value = '';
    marcarBusca(false);
  }

  /* Fechar é desistir da busca. Só a RESPOSTA, que mora em #/, é redesenhada:
   * na ficha o termo não está desenhado em lugar nenhum, e apagá-lo não pode
   * tirar ninguém do vídeo. O foco volta ao botão que abriu — quando ele está à
   * mostra, que é só no celular. */
  function fecharBusca() {
    var tinha = !!el.busca.value;
    esquecerBusca();
    if (tinha && (!window.location.hash || window.location.hash === '#/')) renderGrade();
    if (el.abrirBusca.offsetParent !== null) el.abrirBusca.focus();
  }

  function aoDigitar() {
    estado.termo = el.busca.value;
    /* O chip refina UMA resposta. Apagar a busca desfaz a resposta, e o chip
     * vai junto — senão a chegada não voltaria mais: `renderGrade` só a
     * desenha sem termo E sem série. */
    if (!estado.termo) estado.serie = '';
    /* Termo escrito é busca aberta. Sem isto, quem digita no computador e
     * estreita a janela ficaria com a resposta na tela e o campo escondido. */
    else marcarBusca(true);
    /* A busca só faz sentido na grade; digitar volta para ela. */
    if (window.location.hash && window.location.hash !== '#/') window.location.hash = '#/';
    else renderGrade();
  }

  /* "Início" — o link do cabeçalho e o logo — é um link para #/. Com uma busca
   * digitada o endereço JÁ É #/, então o clique não dispara `hashchange` e nada
   * acontecia (conferido no logo em 15/09). Aqui ele esquece a busca e, na
   * chegada, desenha a chegada ele mesmo; de qualquer outra tela, a navegação
   * comum leva ao roteador, que sobe ao alto por conta própria.
   *
   * "Na chegada" é #/ E o endereço sem hash nenhum, que é como o site abre: o
   * roteador trata os dois como a mesma tela, e deixar a navegação trocar um
   * pelo outro não subiria ao alto.
   *
   * Só clique primário sem tecla: Ctrl+clique abre OUTRA aba, e apagar a busca
   * desta seria mexer numa tela que a pessoa deixou para trás. */
  function irAoInicio(ev) {
    if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
    esquecerBusca();
    if (window.location.hash && window.location.hash !== '#/') return;
    ev.preventDefault();
    rotear();
    window.scrollTo(0, 0);
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
   * Vale para os DOIS cartões — o da grade e o da prateleira —, e é a mesma
   * função ligada nos dois lugares.
   *
   * As duas regras que este trecho existe para cumprir:
   *   1. o preview.webp tem 1,13 MB NA MEDIANA — medido na pull zone em
   *      14/09, nos 66 títulos: de 454 KB a 3,1 MB, 82,2 MB somados. Ele só
   *      pode ser PEDIDO no mouseenter e tem que ser DESCARTADO no
   *      mouseleave. Nada disso pode ir junto com a chegada.
   *      (O "~450 KB" que estava escrito aqui era o MENOR arquivo tomado pelo
   *      tamanho típico, de quando o catálogo tinha 33 títulos.)
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
       * passar reto por um cartão não pode continuar puxando 1,13 MB. */
      img.removeAttribute('src');
      if (img.parentNode) img.parentNode.removeChild(img);
      img = null;
      capa.classList.remove('card-capa-com-previa');
    }

    cartaoEl.addEventListener('mouseenter', function () {
      if (indisponivel || img || espera || !podePreview()) return;
      /* Atravessar a grade com o mouse passa por dezenas de cartões. Sem esta
       * espera, cada um deles dispararia o seu megabyte de passagem. */
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
    marcarMesa(a, 'item:' + item.id);

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
        capa.replaceChild(criar('div', 'card-capa-vazia', frase('semCapa')), img);
      });
      capa.appendChild(img);
    } else {
      capa.appendChild(criar('div', 'card-capa-vazia', frase('semCapa')));
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
      corpo.appendChild(criar('span', 'selo selo-erro', frase('videoIndisponivel')));
    } else if (item.pendencia) {
      corpo.appendChild(criar('span', 'selo', GTM.rotuloPendencia(item.pendencia)));
    }

    a.appendChild(corpo);
    return a;
  }

  /* --------------------------------------------------------------- destaque */

  /* O DESTAQUE da chegada: um título, com a capa, e nada tocando.
   *
   * "Assistir" ABRE A FICHA, e ainda não dá o play. A D5 decidiu que deve dar
   * — o clique é o pedido —, e a D4 tentou ligar isso daqui. Não dá, por uma
   * trava do player que é boa e tem teste ("REGRA 1"): existe UMA chamada de
   * `play()` no projeto, dentro de `alternarPlay`, e é ela também que libera
   * o download (`hls.startLoad()`). Um `video.play()` chamado deste arquivo
   * abriria um segundo lugar de onde o vídeo começa, e nem tocaria: com
   * `preload: none` e o hls.js parado, não há mídia nenhuma para tocar.
   *
   * O caminho certo é o player oferecer uma entrada que passe por
   * `alternarPlay`, e isso é mexer no player — trabalho da D6, que redesenha a
   * ficha. Duas coisas já sabidas para quando chegar lá:
   *
   *   - o pedido NÃO pode viajar na URL. Um `#/ver/<id>` que tocasse sozinho
   *     tocaria para quem recebeu o link e só abriu, e isso é "tocar
   *     sozinho". Ele mora numa variável do módulo, ligada só pelo clique;
   *   - só clique primário sem tecla. Ctrl+clique abre OUTRA aba e não passa
   *     por esta página: a variável ficaria ligada, e a próxima ficha aberta
   *     aqui tocaria sem ninguém ter pedido. */
  function destaqueHtml(item) {
    var caixa = criar('section', 'destaque');
    caixa.setAttribute('aria-labelledby', 'destaque-titulo');
    /* Na mesa, escolher o destaque é escolher o título dele — é no inspetor do
     * título que se tira do destaque ou se passa para outro. */
    marcarMesa(caixa, 'item:' + item.id);

    /* ---- a capa ----
     * Duas colunas, e a capa não passa de 640 px de CSS (D2). A original tem
     * 640×360: num destaque de largura inteira, numa janela de 1400, ela
     * subiria 2,2x e ficaria mole. As originais em alta não existem na pull
     * zone — conferido em 10/09 —, e o Bunny Optimizer está desligado, então
     * `?width=` não redimensiona nada. Fica nítida em tela 1x, e custa zero
     * arquivo novo. */
    var molduraCapa = criar('div', 'destaque-capa');
    var url = GTM.urlCapa(item, estado.config);
    if (url) {
      var img = criar('img');
      img.src = url;
      img.alt = '';
      img.width = 640;
      img.height = 360;
      img.decoding = 'async';
      /* Esta imagem é o LCP da chegada: ela é a maior coisa pintada na
       * primeira tela. `fetchpriority="high"` a põe na frente das capas das
       * prateleiras, que são `loading="lazy"`. */
      img.setAttribute('fetchpriority', 'high');
      img.addEventListener('error', function () {
        molduraCapa.replaceChild(criar('div', 'card-capa-vazia', frase('semCapa')), img);
      });
      molduraCapa.appendChild(img);
    } else {
      molduraCapa.appendChild(criar('div', 'card-capa-vazia', frase('semCapa')));
    }
    /* NENHUMA prévia aqui, e é de propósito: um preview.webp é 1,13 MB na
     * mediana, então o destaque sozinho custaria mais do que as 66 capas
     * juntas (1,83 MB). E "nada toca sozinho" vale para o trecho animado
     * também. `ligarPreview` NÃO é chamada nesta função. */

    /* ---- o texto ---- */
    var texto = criar('div', 'destaque-texto');

    var acima = [item.serie, GTM.rotuloEpisodio(item)].filter(Boolean).join(' · ');
    if (acima) texto.appendChild(criar('p', 'destaque-serie', acima));

    var h1 = criar('h1', 'destaque-titulo', GTM.tituloCurto(item) || item.titulo || '(sem título)');
    h1.id = 'destaque-titulo';
    texto.appendChild(h1);

    var caps = GTM.capitulos(item);
    var meta = [
      GTM.formatarDuracao(item),
      item.ano,
      caps.length ? caps.length + ' capítulos' : ''
    ].filter(Boolean).join(' · ');
    if (meta) texto.appendChild(criar('p', 'destaque-meta', meta));

    if (item.sinopse) texto.appendChild(criar('p', 'destaque-sinopse', item.sinopse));

    var botoes = criar('div', 'destaque-botoes');

    /* O triângulo é <path> em currentColor, como todo ícone do site: um "▶"
     * de texto vira emoji colorido em parte dos Android, e sai de outra fonte
     * em cada aparelho. */
    var assistir = criar('a', 'botao botao-primario destaque-assistir');
    assistir.href = '#/ep/' + encodeURIComponent(item.id);
    var play = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    play.setAttribute('viewBox', '0 0 24 24');
    play.setAttribute('aria-hidden', 'true');
    var tri = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tri.setAttribute('d', 'M8 5 L19 12 L8 19 Z');
    tri.setAttribute('fill', 'currentColor');
    play.appendChild(tri);
    assistir.appendChild(play);
    assistir.appendChild(document.createTextNode('Assistir'));
    botoes.appendChild(assistir);

    /* "Ver a série" cai na grade da prateleira dela enquanto a página da série
     * (§5.6, fase D6) não existe. Só aparece quando a série TEM prateleira —
     * senão o botão levaria a uma lista vazia. */
    var daSerie = GTM.prateleiraPorId(estado.itens, 'serie:' + (item.serie || ''), estado.site);
    if (daSerie) {
      var verSerie = criar('a', 'botao', 'Ver a série');
      verSerie.href = '#/tudo/' + encodeURIComponent(daSerie.id);
      botoes.appendChild(verSerie);
    }

    texto.appendChild(botoes);

    caixa.appendChild(texto);
    caixa.appendChild(molduraCapa);
    return caixa;
  }

  /* ------------------------------------------------------------ prateleiras */

  /* O cartão da PRATELEIRA. O da grade (`cartao`) continua como está, e os dois
   * existem de propósito: numa linha que rola de lado o cartão é estreito e a
   * capa é quem fala, então a sinopse sai. Na grade da busca ela fica — é lá
   * que alguém está decidindo entre resultados parecidos, e o cartão deitado
   * foi medido para isso. */
  function cartaoPrateleira(item, mostrarSerie) {
    var a = criar('a', 'pcard');
    a.href = '#/ep/' + encodeURIComponent(item.id);
    marcarMesa(a, 'item:' + item.id);

    var capa = criar('div', 'pcard-capa');
    var url = GTM.urlCapa(item, estado.config);
    if (url) {
      var img = criar('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      /* A capa tem 640×360 — 16:9. Declarar o tamanho no <img> reserva a caixa
       * mesmo antes de a folha de estilo aplicar o `aspect-ratio`, e é a mesma
       * proporção dos dois lados.
       *
       * NÃO foi isto que tirou o CLS da chegada, e este comentário chegou a
       * dizer que foi (D2). O dono do 0,0985 era o RODAPÉ, empurrado para fora
       * da tela quando o catálogo chega — o conserto está em `#conteudo`, no
       * style.css, com a medida. A caixa da capa sempre teve `aspect-ratio`. */
      img.width = 640;
      img.height = 360;
      img.addEventListener('error', function () {
        capa.replaceChild(criar('div', 'card-capa-vazia', frase('semCapa')), img);
      });
      capa.appendChild(img);
    } else {
      capa.appendChild(criar('div', 'card-capa-vazia', frase('semCapa')));
    }

    var dur = GTM.formatarDuracao(item);
    if (dur) capa.appendChild(criar('span', 'card-duracao', dur));
    a.appendChild(capa);
    /* Mesma prévia da grade, com as mesmas regras: só no mouseenter, só com
     * ponteiro fino, nunca com movimento reduzido, e descartada ao sair. */
    ligarPreview(a, capa, item);

    var corpo = criar('div', 'pcard-corpo');
    corpo.appendChild(criar('h3', 'pcard-titulo', GTM.tituloCurto(item) || '(sem título)'));

    /* A linha que desfaz a colisão do título curto: cinco "Literatura e
     * cidadania" só se distinguem por "Parte 3".
     *
     * A SÉRIE só entra quando a prateleira mistura séries — "Até 5 minutos",
     * "Mais séries", "Curtas", "Do Goiás Tec" —, porque aí ela é o que falta
     * saber. Dentro da linha *De Olho no Futuro* ela seria a repetição que o
     * `tituloCurto` acabou de tirar do título, uma linha abaixo. */
    var partes = [];
    if (mostrarSerie && item.serie) partes.push(item.serie);
    var numero = GTM.rotuloNumero(item);
    if (numero) partes.push(numero);
    if (partes.length) corpo.appendChild(criar('p', 'pcard-meta', partes.join(' · ')));

    if (!GTM.resolverFonte(item, estado.config)) {
      corpo.appendChild(criar('span', 'selo selo-erro', frase('videoIndisponivel')));
    }

    a.appendChild(corpo);
    return a;
  }

  /* Uma linha que rola de lado.
   *
   * Leitor de tela: <section aria-labelledby> com o título da prateleira, e os
   * cartões numa <ul> — assim ele anuncia "lista, 11 itens" em vez de despejar
   * onze links soltos no meio da página.
   *
   * Teclado: cada cartão é um link, então o Tab já anda sozinho e o navegador
   * rola a prateleira até o cartão com foco. Não há nada de teclado para
   * escrever aqui — o que existe é a obrigação de NÃO atrapalhar: as setas são
   * `tabindex="-1"` e `aria-hidden`, porque elas repetem um caminho que o Tab
   * já oferece e só atravancariam a travessia. */
  var seqPrateleira = 0;

  function prateleira(p) {
    var id = 'prat-' + (++seqPrateleira);
    var secao = criar('section', 'prateleira');
    secao.setAttribute('aria-labelledby', id);

    var cabeca = criar('div', 'prateleira-cabeca');
    var h2 = criar('h2', 'prateleira-titulo', p.titulo);
    h2.id = id;
    cabeca.appendChild(h2);

    var tudo = criar('a', 'prateleira-tudo', 'Ver tudo');
    tudo.href = '#/tudo/' + encodeURIComponent(p.id);
    /* O rótulo "Ver tudo" repetido dez vezes não diz nada a quem ouve a
     * página fora de contexto. */
    tudo.setAttribute('aria-label', 'Ver tudo de ' + p.titulo);
    cabeca.appendChild(tudo);
    marcarMesa(cabeca, 'prateleira:' + p.id);
    secao.appendChild(cabeca);

    var pista = criar('div', 'prateleira-pista');
    var lista = criar('ul', 'prateleira-lista');
    /* Numa prateleira de série o nome dela já está no título da linha. */
    var misturaSeries = p.id.indexOf('serie:') !== 0;
    p.itens.forEach(function (item) {
      var li = criar('li');
      li.appendChild(cartaoPrateleira(item, misturaSeries));
      lista.appendChild(li);
    });
    pista.appendChild(lista);

    /* As setas só existem onde há ponteiro fino — quem tem dedo arrasta, e o
     * pedaço do próximo cartão é o convite. Quem decide isso é o CSS, pela
     * mesma pergunta que `podePreview()` faz: `(hover: hover) and (pointer:
     * fine)`. Os botões são criados sempre e escondidos lá; criá-los só com
     * matchMedia deixaria um notebook que virou tela de toque sem setas até
     * recarregar a página. */
    var faz = function (dir, rotulo) {
      var b = criar('button', 'prateleira-seta prateleira-seta-' + dir);
      b.type = 'button';
      b.tabIndex = -1;
      b.setAttribute('aria-hidden', 'true');
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      var caminho = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      /* Ícone é <path> em currentColor: sem fonte de ícone, sem CDN. */
      caminho.setAttribute('d', dir === 'esq' ? 'M15 4 L7 12 L15 20' : 'M9 4 L17 12 L9 20');
      caminho.setAttribute('fill', 'none');
      caminho.setAttribute('stroke', 'currentColor');
      caminho.setAttribute('stroke-width', '2');
      caminho.setAttribute('stroke-linecap', 'round');
      caminho.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(caminho);
      b.appendChild(svg);
      b.addEventListener('click', function () {
        /* 0,9 da largura e não 1: o cartão que estava na beira continua
         * visível depois do salto, e é ele que diz onde a pessoa estava. */
        var passo = Math.round(pista.clientWidth * 0.9) * (dir === 'esq' ? -1 : 1);
        pista.scrollLeft += passo;
      });
      return b;
    };
    pista.appendChild(faz('esq', 'anterior'));
    pista.appendChild(faz('dir', 'próxima'));

    secao.appendChild(pista);
    return secao;
  }

  /* A CHEGADA: prateleiras. A grade não morreu — ela é a resposta da busca, do
   * "Ver tudo" e do filtro por série, que é o que ela faz bem. */
  function renderChegada() {
    var ps = GTM.prateleirasVisiveis(estado.itens, estado.site);
    if (!ps.length) {
      var v = criar('div', 'vazio');
      v.appendChild(criar('h2', null, 'Nada para mostrar ainda'));
      v.appendChild(criar('p', null,
        'Os títulos aparecem aqui assim que forem marcados como publicados na área de administração.'));
      el.grade.appendChild(v);
      return;
    }
    var emDestaque = GTM.destaque(estado.itens, estado.site);
    if (emDestaque) el.grade.appendChild(destaqueHtml(emDestaque));

    seqPrateleira = 0;
    ps.forEach(function (p) { el.grade.appendChild(prateleira(p)); });
  }

  /* ------------------------------------------------------------ as séries */

  /* O cartão de uma SÉRIE: a capa do primeiro título, o nome, e o tamanho
   * dela. Veste as classes do cartão da prateleira — a mesma capa, o mesmo
   * corte em duas linhas, o mesmo crescimento pequeno — e NÃO tem prévia no
   * hover: o `preview.webp` é de um título, e a série não tem trecho que seja
   * dela. */
  function cartaoSerie(s) {
    var a = criar('a', 'pcard');
    a.href = '#/serie/' + encodeURIComponent(s.nome);

    var capa = criar('div', 'pcard-capa');
    var url = GTM.urlCapa(s.itens[0], estado.config);
    if (url) {
      var img = criar('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 640;
      img.height = 360;
      img.addEventListener('error', function () {
        capa.replaceChild(criar('div', 'card-capa-vazia', frase('semCapa')), img);
      });
      capa.appendChild(img);
    } else {
      capa.appendChild(criar('div', 'card-capa-vazia', frase('semCapa')));
    }
    a.appendChild(capa);

    var corpo = criar('div', 'pcard-corpo');
    corpo.appendChild(criar('h3', 'pcard-titulo', s.nome));
    var n = s.itens.length;
    var meta = [n + (n === 1 ? ' título' : ' títulos'), GTM.formatarMinutos(s.segundos)]
      .filter(Boolean).join(' · ');
    corpo.appendChild(criar('p', 'pcard-meta', meta));
    a.appendChild(corpo);
    return a;
  }

  /* A PÁGINA SÉRIES (D5), para onde os chips da chegada foram (decisão D8): as
   * séries em cartões, em dois grupos — o que é para a aula e o que é do Goiás
   * Tec —, pelas mesmas listas das prateleiras.
   *
   * Cada cartão leva a `#/serie/<nome>`, que por enquanto é a grade da série.
   * A D6 transforma essa MESMA rota na página da série (§5.6), e o link que
   * alguém guardar hoje continua valendo depois. */
  function renderIndiceSeries() {
    document.title = 'Séries — ' + TITULO_BASE;
    var grupos = GTM.gruposDeSeries(estado.itens, estado.site);
    var total = grupos.reduce(function (n, g) { return n + g.series.length; }, 0);

    el.grade.appendChild(criar('h1', 'grade-titulo', 'Séries'));
    el.grade.appendChild(criar('p', 'contagem', total + (total === 1 ? ' série' : ' séries')));

    grupos.forEach(function (g) {
      var secao = criar('section', 'indice-grupo');
      secao.setAttribute('aria-labelledby', 'indice-' + g.id);
      var h2 = criar('h2', 'prateleira-titulo indice-grupo-titulo', g.titulo);
      h2.id = 'indice-' + g.id;
      secao.appendChild(h2);

      /* Uma <ul>, como na prateleira: o leitor anuncia "lista, 17 itens". */
      var lista = criar('ul', 'indice-lista');
      g.series.forEach(function (s) {
        var li = criar('li');
        li.appendChild(cartaoSerie(s));
        lista.appendChild(li);
      });
      secao.appendChild(lista);
      el.grade.appendChild(secao);
    });
  }

  function renderGrade() {
    limpar(el.grade);
    limpar(el.avisos);
    /* Esvaziar a ficha é o que PARA o vídeo. Apenas esconder o contêiner com
     * `hidden` deixa o iframe vivo no DOM, tocando — inclusive o áudio — quando
     * o usuário volta para a grade pelo botão do navegador.
     *
     * Para o player nosso esvaziar NÃO basta, e por isso `destruirPlayer()` vem
     * antes: o <video> some junto com a ficha, mas o hls.js sobreviveria. */
    destruirPlayer();
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

    /* A página Séries é um ramo DAQUI, e não uma tela à parte: ela precisa da
     * mesma limpeza lá de cima — quem chega nela vindo da ficha tem o player
     * destruído no caminho. */
    if (estado.indiceSeries) {
      marcarNav('series');
      renderIndiceSeries();
      return;
    }

    /* A CHEGADA é a prateleira; a GRADE é a resposta — da busca, do filtro por
     * série, do "Ver tudo" e da rota de uma série. Sem pergunta não há o que
     * responder, e é por isso que a grade sai da tela inicial sem sair do
     * site. */
    if (!estado.termo && !estado.serie && !estado.prateleira && !estado.serieRota) {
      marcarNav('inicio');
      renderChegada();
      return;
    }
    marcarNav(estado.serieRota ? 'series' : '');
    /* Uma resposta na tela é busca aberta — é o caso de quem volta da ficha
     * pelo botão do navegador: no celular o campo reaparece com o termo. */
    if (estado.termo) marcarBusca(true);

    /* De onde a resposta veio, dito em uma linha. O "Ver tudo" abre uma grade
     * que não tem termo digitado nem chip aceso: sem este título ela pareceria
     * o catálogo inteiro. */
    var prat = estado.prateleira ? GTM.prateleiraPorId(estado.itens, estado.prateleira, estado.site) : null;
    if (estado.prateleira && !prat) {
      el.grade.appendChild(aviso('Essa lista não existe mais.', true));
      var volta = criar('a', 'botao', 'Voltar ao início');
      volta.href = '#/';
      el.grade.appendChild(volta);
      return;
    }
    if (prat) {
      el.grade.appendChild(criar('h1', 'grade-titulo', prat.titulo));
      document.title = prat.titulo + ' — ' + TITULO_BASE;
    }

    if (estado.serieRota) {
      if (!GTM.filtrarPorSerie(publicados, estado.serieRota).length) {
        el.grade.appendChild(aviso('Essa série não existe mais.', true));
        var todas = criar('a', 'botao', 'Ver todas as séries');
        todas.href = '#/series';
        el.grade.appendChild(todas);
        return;
      }
      el.grade.appendChild(criar('h1', 'grade-titulo', estado.serieRota));
      document.title = estado.serieRota + ' — ' + TITULO_BASE;
    }

    /* O chip filtra a resposta da busca, e é por isso que as séries dele saem
     * dela ANTES do chip: ligado um, os outros continuam à mão. */
    var resposta = GTM.buscar(baseDaGrade(), estado.termo);
    var opcoes = GTM.seriesDoFiltro(resposta, estado.serie);
    if (opcoes.length) el.grade.appendChild(filtroSeries(opcoes));

    var lista = GTM.filtrarPorSerie(resposta, estado.serie);
    el.grade.appendChild(criar('p', 'contagem',
      lista.length + (lista.length === 1 ? ' título' : ' títulos') +
      (lista.length !== publicados.length ? ' de ' + publicados.length : '')));

    if (!lista.length) {
      var nada = criar('div', 'vazio');
      nada.appendChild(criar('h2', null, frase('buscaVazia')));
      nada.appendChild(criar('p', null, frase('buscaVaziaAjuda')));
      el.grade.appendChild(nada);
      return;
    }

    /* Uma grade só, sem cabeçalho de série: os blocos por série deixavam um
     * cartão sozinho por faixa e a tela inteira vazia à direita. A ordem
     * continua vindo de `ordenar()`, então cada série segue junta na grade —
     * quem quiser ver uma série isolada vai pela página Séries, ou pelo chip
     * da resposta. */
    var grade = criar('div', 'grade');
    GTM.ordenar(lista).forEach(function (item) { grade.appendChild(cartao(item)); });
    el.grade.appendChild(grade);
  }

  /* -------------------------------------------------------------- capítulos */

  /* Os capítulos aparecem em DOIS lugares, e quem desenha o primeiro depende
   * de qual player está no ar:
   *
   *   - na LINHA DO TEMPO. Com o embed, são os capítulos nativos do Bunny,
   *     gravados no vídeo por scripts/capitulos.mjs: o iframe é de outro
   *     domínio (player.mediadelivery.net), a página não alcança o DOM dele e
   *     não desenha nada por cima. Com o player nosso, desde a fase 3, quem
   *     segmenta a barra e mostra o título sob o ponteiro é player.js.
   *   - na LISTA clicável abaixo do player, que é o que este trecho monta, e
   *     que funciona igual nos dois casos.
   *
   * Com o embed, a lista atravessa a fronteira do iframe pelo único caminho
   * que existe: o Player.js do Bunny, que dá ao pai controle de reprodução por
   * postMessage.
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
  function listaCapitulos(item, alvo) {
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

    var posicionar = null;   /* como levar o vídeo a um segundo — depende do alvo */
    var pendente = null;     /* clique que chegou antes de o player responder */
    var atual = -1;

    function procurar(segundos) {
      if (posicionar) posicionar(segundos);
      else pendente = segundos;
    }

    /* Um alvo ficou pronto. Daqui para a frente o clique posiciona de verdade,
     * e o que chegou antes é atendido agora. */
    function ativar(comoPosicionar) {
      posicionar = comoPosicionar;
      secao.classList.add('capitulos-ativos');
      if (pendente != null) { comoPosicionar(pendente); pendente = null; }
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

    /* Dois alvos possíveis, um comportamento só. O que muda é a distância:
     * o player nosso está do lado, o embed está do outro lado de uma fronteira
     * de domínio e só responde por postMessage. */

    if (alvo && alvo.irPara) {
      /* PLAYER NOSSO (fase 0). Já está pronto neste instante — sem script
       * externo, sem postMessage, sem `ready` para esperar. */
      ativar(function (s) {
        alvo.irPara(s);
        /* Destaca na hora, sem esperar o `timeupdate`. Com `preload: none`,
         * clicar num capítulo ANTES do primeiro play não dispara timeupdate
         * nenhum — não há mídia carregada — e a lista ficava sem destaque
         * como se o clique não tivesse funcionado. */
        destacar(GTM.capituloEm(caps, s));
      });
      /* `aoTempo` e não um `timeupdate` no <video>: o player avisa TAMBÉM nos
       * pulos que ele mesmo faz — o Ctrl+seta da fase 3 — que sem mídia
       * carregada não disparam evento nenhum. Ouvir só o <video> deixaria a
       * lista destacando o capítulo anterior depois de um pulo por tecla. */
      alvo.aoTempo(function (segundos) {
        destacar(GTM.capituloEm(caps, segundos));
      });
      return secao;
    }

    /* EMBED DO BUNNY. O iframe é de outro domínio; o Player.js é o único
     * caminho que atravessa. */
    var iframe = alvo;
    carregarPlayerjs().then(function (playerjs) {
      /* Voltar para a grade destrói a ficha inteira. Se isso aconteceu enquanto
       * o script carregava, não há mais iframe para conversar — e instanciar o
       * Player em cima de um nó solto deixaria um listener de postMessage vivo. */
      if (!iframe.isConnected) return;

      var p = new playerjs.Player(iframe);
      p.on('ready', function () {
        if (!iframe.isConnected) return;
        ativar(function (s) { p.setCurrentTime(s); });
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

  function metaDaFicha(item) {
    return [item.serie, GTM.rotuloEpisodio(item), GTM.formatarDuracao(item), item.ano]
      .filter(Boolean).join(' · ');
  }

  /* Na mesa, o título e a sinopse da ficha são editáveis ali mesmo: o que se vê
   * é o que se grava (PLANO-MESA, O1). O CARTÃO não — ele mostra o título
   * curto, que não existe no catálogo. Os outros campos marcados servem só
   * para a mesa achar o nó e atualizá-lo no lugar. Fora da mesa, nada muda. */
  function campoDaFicha(no, item, campo) {
    if (!mesa.ligada) return no;
    marcarMesa(no, 'item:' + item.id);
    no.setAttribute('data-mesa-campo', campo);
    if (mesa.editavel && (campo === 'titulo' || campo === 'sinopse')) {
      try { no.contentEditable = 'plaintext-only'; } catch (e) { no.contentEditable = 'true'; }
    }
    if (campo === 'sinopse') no.setAttribute('data-vazio', 'Sinopse ainda não disponível.');
    return no;
  }

  /* Uma mudança do rascunho com a ficha aberta. Redesenhar a ficha passaria por
   * `destruirPlayer()`, e o vídeo pararia a cada tecla digitada na mesa. Então
   * os textos são trocados no lugar — e o campo onde alguém está digitando não
   * é tocado, senão o cursor pularia para o começo. */
  function atualizarFichaNoLugar(id) {
    var item = GTM.porId(estado.itens, id);
    var titulo = el.ficha.querySelector('[data-mesa-campo="titulo"]');
    var sinopse = el.ficha.querySelector('[data-mesa-campo="sinopse"]');
    if (!item || !titulo || !sinopse) { renderFicha(id); return; }
    var foco = document.activeElement;

    if (titulo !== foco) titulo.textContent = item.titulo || '(sem título)';
    el.ficha.querySelector('[data-mesa-campo="meta"]').textContent = metaDaFicha(item);
    if (sinopse !== foco) sinopse.textContent = item.sinopse || '';
    sinopse.classList.toggle('sinopse-vazia', !item.sinopse);

    var pend = el.ficha.querySelector('[data-mesa-campo="pendencia"]');
    if (item.pendencia && pend) {
      pend.textContent = GTM.rotuloPendencia(item.pendencia);
    } else if (item.pendencia) {
      sinopse.parentNode.insertBefore(
        campoDaFicha(aviso(GTM.rotuloPendencia(item.pendencia)), item, 'pendencia'), sinopse);
    } else if (pend) {
      pend.parentNode.removeChild(pend);
    }

    document.title = (item.titulo || 'Título') + ' — ' + TITULO_BASE;
    pintarSelecao();
  }

  function renderFicha(id) {
    /* Trocar de episódio pelos botões da série chama renderFicha direto, sem
     * passar pela grade: sem isto, o hls.js do título anterior continuaria
     * puxando segmentos enquanto o novo começa. */
    destruirPlayer();
    limpar(el.ficha);
    limpar(el.avisos);
    el.grade.hidden = true;
    el.ficha.hidden = false;
    marcarNav('');

    /* Na mesa a ficha abre também título fora do ar: é nela que se revisa a
     * sinopse de quem ainda não foi publicado. */
    var item = GTM.porId(mesa.ligada ? estado.itens : GTM.publicaveis(estado.itens), id);
    if (!item) {
      el.ficha.appendChild(aviso(frase('fichaAusente'), true));
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

    /* A quem a lista de capítulos vai falar: o player nosso ou o iframe. */
    var alvoCapitulos = null;

    /* Calculado antes do player porque ele precisa dos vizinhos para o
     * Shift+N / Shift+P do teclado. Os mesmos vizinhos alimentam os botões de
     * navegação no fim desta função. */
    var viz = GTM.vizinhos(estado.itens, item.id);

    /* O player nosso é o PADRÃO desde 03/09. As duas redes de segurança
     * continuam armadas, e é o que torna a virada barata de desfazer:
     *
     *   - `?player=embed` na URL devolve o iframe do Bunny, na hora;
     *   - se `criar()` devolver null por QUALQUER motivo — ou se o `player.js`
     *     nem tiver carregado, e aí `GTMPlayer` é `undefined` —, o bloco
     *     seguinte assume e ninguém fica sem vídeo. */
    if (fonte && playerNovoLigado()) {
      playerAtivo = GTMPlayer.criar(item, estado.config, {
        anterior: viz.anterior, proximo: viz.proximo,
        /* O deslize ↓ da fase 7, em tela cheia deitada: o player pede para ser
         * fechado, e quem sabe fazer isso é daqui.
         *
         * `renderFicha` do MESMO id é o caminho certo, e não um `location.hash`:
         * já estamos nessa rota, então trocar o hash para ele não dispara
         * `hashchange` e nada aconteceria. Ela começa por `destruirPlayer()`,
         * que mata a instância do hls.js — numa conexão de escola, parar de
         * puxar segmentos é metade do valor do gesto — e remonta a ficha com a
         * capa no lugar do vídeo, que é onde quem deslizou esperava parar. */
        aoFechar: function () { renderFicha(item.id); }
      });
      if (playerAtivo) {
        caixa.appendChild(playerAtivo.no);
        caixa.classList.add('player-nosso');
        alvoCapitulos = playerAtivo;
      }
    }

    if (fonte && !alvoCapitulos) {
      var iframe = document.createElement('iframe');
      iframe.src = GTM.urlEmbed(fonte);
      iframe.title = 'Player — ' + (item.titulo || '');
      iframe.loading = 'lazy';
      /* `autoplay` fica DE FORA da permission policy de propósito: é a segunda
       * tranca contra o vídeo tocar sozinho, caso o parâmetro do player falhe. */
      iframe.setAttribute('allow', 'fullscreen; picture-in-picture; encrypted-media');
      iframe.setAttribute('allowfullscreen', '');
      caixa.appendChild(iframe);
      alvoCapitulos = iframe;
    }

    if (!fonte) {
      caixa.appendChild(criar('div', 'player-ausente',
        'Vídeo ainda não disponível. O arquivo pode estar em processamento no servidor de vídeo.'));
    }
    coluna.appendChild(caixa);

    /* Capítulos: a linha do tempo segmentada e o título sob o ponteiro vêm do
     * Bunny quando o player é o embed, e do nosso player.js desde a fase 3.
     * Esta lista é a outra metade, e funciona igual nos dois casos. */
    if (alvoCapitulos) {
      var caps = listaCapitulos(item, alvoCapitulos);
      if (caps) coluna.appendChild(caps);
    }

    /* Navegação explícita: só muda de episódio quando alguém clica — ou aperta
     * Shift+N / Shift+P, que é o mesmo gesto deliberado, pelo teclado. */
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
    lado.appendChild(campoDaFicha(criar('h1', null, item.titulo || '(sem título)'), item, 'titulo'));

    lado.appendChild(campoDaFicha(criar('p', 'ficha-meta', metaDaFicha(item)), item, 'meta'));

    if (item.pendencia) {
      lado.appendChild(campoDaFicha(aviso(GTM.rotuloPendencia(item.pendencia)), item, 'pendencia'));
    }

    if (item.sinopse) {
      lado.appendChild(campoDaFicha(criar('p', 'sinopse', item.sinopse), item, 'sinopse'));
    } else {
      /* Na mesa o parágrafo vazio vira campo: o texto de "não disponível" mora
       * no atributo, e o CSS o mostra só enquanto ninguém digitou. */
      var vazia = criar('p', 'sinopse sinopse-vazia', mesa.ligada ? '' : 'Sinopse ainda não disponível.');
      vazia.setAttribute('data-vazio', 'Sinopse ainda não disponível.');
      lado.appendChild(campoDaFicha(vazia, item, 'sinopse'));
    }

    /* Titularidade e nível de evidência SAÍRAM da ficha (04/09). São
     * classificação interna — quem responde pela obra e o quanto a origem foi
     * conferida —, e servem a quem cataloga, não a quem vai assistir. O lugar
     * delas é o /admin, onde continuam inteiras. Saíram também da projeção
     * pública da API: campo que o site não desenha não precisa viajar. */
    var dl = criar('dl', 'dados');
    linhaDados(dl, 'Tema', item.tema);
    linhaDados(dl, 'Público-alvo', item.publico_alvo);
    linhaDados(dl, 'Tags', (item.tags || []).join(', '));
    if (dl.childNodes.length) lado.appendChild(dl);

    grade.appendChild(lado);
    el.ficha.appendChild(grade);

    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------------ rotas */

  /* A rota traz o id ou o nome CODIFICADO. Um endereço torto — um `%` solto,
   * colado de um aplicativo de mensagem — faz `decodeURIComponent` lançar, e o
   * roteador inteiro parava junto: tela vazia, sem aviso. Torto, o texto segue
   * como veio e cai no "não encontrado" de cada tela. */
  function decodificar(texto) {
    try {
      return decodeURIComponent(texto);
    } catch (e) {
      return texto;
    }
  }

  function rotear() {
    var hash = window.location.hash || '#/';
    avisarMesa({ tipo: 'rota', hash: hash });

    /* Trocar de TELA começa do alto. O cabeçalho é sticky e o "Séries" está
     * sempre à mão: sem isto, quem estava na oitava prateleira caía no fim da
     * página nova, com a rolagem da antiga. Redesenhar a MESMA tela — o Início
     * no mesmo endereço, um chip, uma letra na busca — não passa por aqui, ou
     * passa com o mesmo hash, e não mexe na rolagem. A ficha já sobe sozinha. */
    var trocouDeTela = hash !== estado.rota;
    estado.rota = hash;

    var ep = hash.match(/^#\/ep\/(.+)$/);
    if (ep) {
      /* A busca fica guardada — o botão de voltar do navegador devolve a
       * resposta —, mas o campo recolhe: a ficha é do vídeo. */
      marcarBusca(false);
      renderFicha(decodificar(ep[1]));
      return;
    }

    var indice = hash === '#/series';
    /* `#/serie/<nome>` — a grade de uma série, até a D6 fazer dela a página. */
    var serie = hash.match(/^#\/serie\/(.+)$/);
    /* `#/tudo/<id da prateleira>` — a mesma lista da linha, em grade. */
    var tudo = hash.match(/^#\/tudo\/(.+)$/);

    /* Séries e "Ver tudo" são telas que não mostram a busca: chegar nelas é
     * deixar a busca para trás. Sem isto um termo esquecido filtraria a grade
     * de uma série em silêncio — no celular, com o campo recolhido e nada na
     * tela dizendo por quê. */
    if (indice || serie || tudo) esquecerBusca();

    var prateleira = tudo ? decodificar(tudo[1]) : '';
    var serieRota = serie ? decodificar(serie[1]) : '';
    /* O chip refina a resposta de UMA tela: trocar de lista o desfaz. */
    if (prateleira !== estado.prateleira || serieRota !== estado.serieRota ||
        indice !== estado.indiceSeries) {
      estado.serie = '';
    }
    estado.prateleira = prateleira;
    estado.serieRota = serieRota;
    estado.indiceSeries = indice;

    if (trocouDeTela) window.scrollTo(0, 0);
    renderGrade();
  }

  /* ----------------------------------------------------------------- início */

  /* Uma mudança do rascunho com a chegada ou a grade na tela: redesenha, e
   * devolve cada prateleira à rolagem de lado em que estava. */
  function redesenharPelaMesa() {
    var ep = (window.location.hash || '').match(/^#\/ep\/(.+)$/);
    if (ep && !el.ficha.hidden) { atualizarFichaNoLugar(decodificar(ep[1])); return; }
    var laterais = {};
    var pistas = document.querySelectorAll('[data-mesa^="prateleira:"]');
    for (var i = 0; i < pistas.length; i++) {
      var p = pistas[i].parentNode.querySelector('.prateleira-pista');
      if (p) laterais[pistas[i].getAttribute('data-mesa')] = p.scrollLeft;
    }
    var topo = window.scrollY;
    /* A mesma porta do roteador: `renderGrade` desenha toda tela que não é a
     * ficha — a chegada, Séries, a série, o "Ver tudo" — a partir do estado. */
    renderGrade();
    pistas = document.querySelectorAll('[data-mesa^="prateleira:"]');
    for (var j = 0; j < pistas.length; j++) {
      var q = pistas[j].parentNode.querySelector('.prateleira-pista');
      var v = laterais[pistas[j].getAttribute('data-mesa')];
      if (q && v) q.scrollLeft = v;
    }
    window.scrollTo(0, topo);
  }

  /* Tudo o que só existe dentro da mesa, ligado uma vez. */
  function ligarMesa() {
    document.documentElement.classList.add('modo-mesa');
    marcarMesa(document.querySelector('.marca'), 'marca');
    marcarMesa(document.querySelector('.rodape'), 'rodape');

    window.addEventListener('message', function (ev) {
      if (ev.origin !== window.location.origin || ev.source !== window.parent) return;
      var m = ev.data;
      if (!m || m.gtm !== 'mesa') return;

      if (m.tipo === 'catalogo' && m.dados) {
        mesa.editavel = m.editavel !== false;
        receberDados(m.dados);
        if (mesa.aoPrimeiroCatalogo) {
          var primeiro = mesa.aoPrimeiroCatalogo;
          mesa.aoPrimeiroCatalogo = null;
          primeiro();
          return;
        }
        redesenharPelaMesa();
      } else if (m.tipo === 'selecao') {
        mesa.selecao = m.alvo || '';
        pintarSelecao();
      } else if (m.tipo === 'ir' && typeof m.hash === 'string' && m.hash.indexOf('#/') === 0) {
        window.location.hash = m.hash;
      } else if (m.tipo === 'rolar' && m.alvo) {
        rolarAteMesa(m.alvo);
      }
    });

    /* Um clique num marcado ESCOLHE, não navega. Link dentro de um marcado —
     * o "Ver tudo" no cabeçalho da prateleira — continua navegando, e o player
     * nunca é interceptado: na mesa ele toca, pausa e pula como no site. */
    document.addEventListener('click', function (ev) {
      if (ev.target.closest('.player')) return;
      var alvo = ev.target.closest('[data-mesa]');
      var link = ev.target.closest('a');
      if (!alvo || (link && link !== alvo)) return;
      if (!alvo.isContentEditable) ev.preventDefault();
      avisarMesa({ tipo: 'selecionar', alvo: alvo.getAttribute('data-mesa') });
    }, true);

    /* O duplo clique num cartão abre a ficha, como o clique abre no site. */
    document.addEventListener('dblclick', function (ev) {
      var alvoCartao = ev.target.closest('a.card, a.pcard');
      if (alvoCartao) window.location.hash = alvoCartao.getAttribute('href');
    });

    document.addEventListener('input', function (ev) {
      var no = ev.target;
      if (!no.isContentEditable || !no.hasAttribute('data-mesa-campo')) return;
      avisarMesa({
        tipo: 'editar',
        alvo: no.getAttribute('data-mesa'),
        campo: no.getAttribute('data-mesa-campo'),
        valor: no.textContent
      });
    });

    /* Título e sinopse são uma linha de texto para o catálogo: Enter termina a
     * edição em vez de quebrar o parágrafo. */
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target.isContentEditable && ev.target.hasAttribute('data-mesa-campo')) {
        ev.preventDefault();
        ev.target.blur();
      }
    });
  }

  function iniciar() {
    if (mesa.ligada) ligarMesa();
    ligarTopo();

    el.busca.addEventListener('input', aoDigitar);
    el.busca.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') fecharBusca();
    });
    el.abrirBusca.addEventListener('click', abrirBusca);
    el.fecharBusca.addEventListener('click', fecharBusca);

    var inicios = document.querySelectorAll('[data-inicio]');
    for (var i = 0; i < inicios.length; i++) inicios[i].addEventListener('click', irAoInicio);

    /* O ATALHO DE PULAR não pode passar pelo roteador. Ele é um link para
     * #conteudo — um hash —, e numa ficha o roteador lia a troca como a
     * chegada: o player era destruído e o foco ia para o <body> (conferido em
     * 15/09). Aqui ele só leva o foco ao <main>, que tem `tabindex="-1"` para
     * isso, e o próximo Tab entra no conteúdo. */
    el.pular.addEventListener('click', function (ev) {
      ev.preventDefault();
      el.conteudo.focus();
    });

    window.addEventListener('hashchange', rotear);

    carregar().then(function () {
      rotear();
    }).catch(function (erro) {
      estado.carregado = false;
      limpar(el.grade);
      el.ficha.hidden = true;
      el.grade.hidden = false;
      var v = criar('div', 'vazio');
      v.appendChild(criar('h2', null, frase('erroCatalogo')));
      /* A mensagem técnica vai no FIM, e não no meio da frase: o texto é
       * editável na mesa, e um buraco no meio some na primeira reescrita. */
      v.appendChild(criar('p', null, frase('erroCatalogoAjuda') + ' (' + erro.message + ')'));
      el.grade.appendChild(v);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
