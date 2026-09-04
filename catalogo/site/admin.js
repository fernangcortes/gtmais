/* admin.js — área de administração.
 *
 * O arquivo de vídeo vai do navegador DIRETO para o Bunny (TUS). A função
 * /api/upload-token só devolve uma assinatura de uso único: a AccessKey do
 * Bunny nunca chega aqui. Se algum dia ela aparecer nesta tela, é bug grave.
 */
(function () {
  'use strict';

  var CHAVE_SESSAO = 'gtm_admin_token';
  var TAMANHO_PEDACO = 50 * 1024 * 1024;   /* 50 MB por PATCH: progresso fino e retomada barata */

  var sessao = { token: null, expira: 0 };
  var catalogo = { rev: 0, itens: [], config: {}, ajustes: {} };
  var envio = { upload: null, videoId: null, arquivo: null, titulo: '' };

  var $ = function (id) { return document.getElementById(id); };

  function texto(no, msg, classe) {
    no.textContent = msg || '';
    no.className = 'estado' + (classe ? ' ' + classe : '');
  }

  function registrar(msg) {
    var pre = $('registro-upload');
    var hora = new Date().toLocaleTimeString('pt-BR');
    pre.textContent += (pre.textContent ? '\n' : '') + hora + '  ' + msg;
    pre.scrollTop = pre.scrollHeight;
  }

  /* ---------------------------------------------------------------- sessão */

  function guardarSessao(dados) {
    sessao.token = dados.token;
    sessao.expira = dados.expira;
    try {
      sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(dados));
    } catch (e) { /* aba anônima com storage bloqueado: segue só em memória */ }
  }

  function recuperarSessao() {
    try {
      var bruto = sessionStorage.getItem(CHAVE_SESSAO);
      if (!bruto) return false;
      var dados = JSON.parse(bruto);
      if (!dados.token || dados.expira <= Math.floor(Date.now() / 1000)) return false;
      sessao = dados;
      return true;
    } catch (e) { return false; }
  }

  function encerrarSessao() {
    sessao = { token: null, expira: 0 };
    try { sessionStorage.removeItem(CHAVE_SESSAO); } catch (e) {}
    $('tela-painel').hidden = true;
    $('tela-entrar').hidden = false;
    $('sair').hidden = true;
    $('quem').textContent = '';
  }

  /* ------------------------------------------------------------------- api */

  function api(caminho, opcoes) {
    var o = opcoes || {};
    var cabecalhos = Object.assign({ Accept: 'application/json' }, o.headers || {});
    if (sessao.token) cabecalhos.Authorization = 'Bearer ' + sessao.token;
    if (o.body && typeof o.body === 'string' && !cabecalhos['content-type']) {
      cabecalhos['content-type'] = 'application/json';
    }

    return fetch(caminho, Object.assign({}, o, { headers: cabecalhos })).then(function (r) {
      if (r.status === 401 && sessao.token) {
        encerrarSessao();
        throw new Error('sessão expirada — entre de novo');
      }
      return r.json().catch(function () { return {}; }).then(function (corpo) {
        if (!r.ok) {
          var e = new Error(corpo.erro || ('erro ' + r.status));
          e.status = r.status;
          e.corpo = corpo;
          throw e;
        }
        return corpo;
      });
    });
  }

  /* Toda gravação é ler-alterar-gravar sobre uma leitura fresca, com o `rev`
   * que o servidor devolveu. Duas telas abertas não se sobrescrevem. */
  function salvarCatalogo(mutar) {
    return api('/api/catalogo?completo=1').then(function (atual) {
      var copia = JSON.parse(JSON.stringify(atual));
      delete copia.config;
      if (mutar(copia) === false) return null;
      return api('/api/catalogo', { method: 'PUT', body: JSON.stringify(copia) });
    }).then(function (resposta) {
      if (resposta) return carregarCatalogo().then(function () { return resposta; });
      return null;
    });
  }

  function carregarCatalogo() {
    return api('/api/catalogo?completo=1').then(function (dados) {
      catalogo = {
        rev: dados.rev || 0,
        itens: Array.isArray(dados.itens) ? dados.itens : [],
        config: dados.config || {},
        ajustes: dados.ajustes || {}
      };
      preencherSeries();
      preencherAjustes();
      renderLista();
      return catalogo;
    });
  }

  function preencherSeries() {
    var lista = $('lista-series');
    lista.innerHTML = '';
    GTM.series(catalogo.itens).forEach(function (s) {
      var o = document.createElement('option');
      o.value = s;
      lista.appendChild(o);
    });
  }

  /* ---------------------------------------------------------------- entrar */

  $('form-entrar').addEventListener('submit', function (ev) {
    ev.preventDefault();
    texto($('estado-entrar'), 'Verificando…');
    fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ senha: $('senha').value })
    }).then(function (r) {
      return r.json().then(function (corpo) {
        if (!r.ok) throw new Error(corpo.erro || ('erro ' + r.status));
        return corpo;
      });
    }).then(function (dados) {
      guardarSessao(dados);
      $('senha').value = '';
      texto($('estado-entrar'), '');
      abrirPainel();
    }).catch(function (e) {
      texto($('estado-entrar'), e.message, 'estado-erro');
    });
  });

  $('sair').addEventListener('click', encerrarSessao);

  function abrirPainel() {
    $('tela-entrar').hidden = true;
    $('tela-painel').hidden = false;
    $('sair').hidden = false;
    var ate = new Date(sessao.expira * 1000);
    $('quem').textContent = 'sessão até ' + ate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    texto($('estado-catalogo'), 'Carregando catálogo…');
    carregarCatalogo().then(function (c) {
      texto($('estado-catalogo'), c.itens.length + ' títulos no catálogo (rev ' + c.rev + ')');
    }).catch(function (e) {
      texto($('estado-catalogo'), e.message, 'estado-erro');
    });
  }

  /* ------------------------------------------------------------------ abas */

  var ABAS = ['enviar', 'catalogo', 'ajustes'];

  function trocarAba(qual) {
    ABAS.forEach(function (a) {
      var ativa = a === qual;
      $('aba-' + a).setAttribute('aria-selected', String(ativa));
      $('painel-' + a).hidden = !ativa;
    });
  }
  ABAS.forEach(function (a) {
    $('aba-' + a).addEventListener('click', function () { trocarAba(a); });
  });

  /* ------------------------------------------------- ajustes do player
   *
   * Um número só, por enquanto: o teto do arrasto acelerado. Ele mora no
   * PRÓPRIO catálogo (campo `ajustes`), e não em `config` — `config` vem do
   * ambiente e o PUT o descarta, então um ajuste guardado ali se apagaria na
   * gravação seguinte.
   *
   * A conta dos exemplos é a definição do número, não uma aproximação: o teto
   * É a fração da duração que um arranco de ponta a ponta atravessa. Por isso
   * ela é feita aqui com uma multiplicação, sem precisar do `player-core`
   * nesta tela. */
  function tetoEmPorcento() {
    var f = Number(catalogo.ajustes && catalogo.ajustes.arrastoTeto);
    return isFinite(f) && f > 0 ? Math.round(f * 100) : 40;
  }

  function mostrarExemplos() {
    var pct = Number($('a-teto').value);
    var alvo = $('a-exemplos');
    if (!isFinite(pct) || pct < 5 || pct > 100) {
      alvo.textContent = 'Escolha entre 5% e 100%.';
      return;
    }
    /* Os extremos do acervo de verdade, e não durações inventadas: é neles
     * que o número vai doer primeiro. */
    var duracoes = catalogo.itens
      .filter(function (i) { return i && i.publicar === true && Number(i.duracao_seg) > 0; })
      .map(function (i) { return Number(i.duracao_seg); });
    var amostras = duracoes.length
      ? [Math.min.apply(null, duracoes), Math.max.apply(null, duracoes), 3600]
      : [120, 1200, 3600];
    var vistos = {};
    alvo.textContent = 'Com ' + Math.round(pct) + '%: ' + amostras
      .filter(function (d) { if (vistos[d]) return false; vistos[d] = 1; return true; })
      .map(function (d) {
        return 'um vídeo de ' + GTM.formatarTempo(d) +
          ' pula no máximo ' + GTM.formatarTempo(Math.round(d * pct / 100));
      })
      .join(' · ') + '.';
  }

  /* `0` é uma escolha válida — "nunca some" — e por isso a checagem é por
   * `null`/vazio, e não por falsidade: `0 || 3` daria 3 e engoliria o pedido. */
  function segundosDoSumico() {
    var s = catalogo.ajustes && catalogo.ajustes.controlesEspera;
    return s === null || s === undefined || !isFinite(Number(s)) ? 3 : Number(s);
  }

  function preencherAjustes() {
    $('a-teto').value = String(tetoEmPorcento());
    $('a-sumico').value = String(segundosDoSumico());
    mostrarExemplos();
  }

  $('a-teto').addEventListener('input', mostrarExemplos);

  $('a-padrao').addEventListener('click', function () {
    $('a-teto').value = '40';
    $('a-sumico').value = '3';
    mostrarExemplos();
  });

  $('a-salvar').addEventListener('click', function () {
    var pct = Number($('a-teto').value);
    if (!isFinite(pct) || pct < 5 || pct > 100) {
      texto($('estado-ajustes'), 'Escolha entre 5% e 100%.', 'estado-erro');
      return;
    }
    var seg = Number($('a-sumico').value);
    if (!isFinite(seg) || seg < 0 || seg > 30) {
      texto($('estado-ajustes'), 'O sumiço vai de 0 a 30 segundos.', 'estado-erro');
      return;
    }
    texto($('estado-ajustes'), 'Salvando…');
    salvarCatalogo(function (c) {
      c.ajustes = Object.assign({}, c.ajustes, {
        arrastoTeto: Math.round(pct) / 100,
        controlesEspera: Math.round(seg)
      });
    }).then(function () {
      /* A ficha lê o catálogo ao carregar: quem já está com uma aberta continua
       * com o número velho até recarregar, e dizer isso evita o susto. */
      texto($('estado-ajustes'), 'Salvo. Vale nas fichas abertas a partir de agora.', 'estado-ok');
    }).catch(function (e) {
      texto($('estado-ajustes'), e.message || 'não deu para salvar', 'estado-erro');
    });
  });

  /* ---------------------------------------------------------------- upload */

  $('arquivo').addEventListener('change', function () {
    var f = $('arquivo').files[0];
    if (!f) return;
    if (!$('titulo-upload').value) {
      /* GTM_FESTAS_S01E01_CAVALHADAS_2025_MASTER.mp4 -> "Festas S01e01 Cavalhadas 2025 Master" */
      var base = f.name.replace(/\.[^.]+$/, '').replace(/^GTM_/i, '').replace(/_/g, ' ');
      $('titulo-upload').value = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
    }
    registrar('arquivo escolhido: ' + f.name + ' (' + (f.size / 1048576).toFixed(0) + ' MB)');
  });

  function mostrarProgresso(enviados, total) {
    $('progresso-caixa').hidden = false;
    var pct = total ? (enviados / total * 100) : 0;
    $('progresso-barra').style.width = pct.toFixed(1) + '%';
    $('progresso-texto').textContent =
      pct.toFixed(1) + '%  ·  ' + (enviados / 1048576).toFixed(0) + ' MB de ' +
      (total / 1048576).toFixed(0) + ' MB';
  }

  $('enviar').addEventListener('click', function () {
    var arquivo = $('arquivo').files[0];
    var titulo = $('titulo-upload').value.trim();

    if (!arquivo) return texto($('estado-upload'), 'Escolha o arquivo de vídeo.', 'estado-erro');
    if (!titulo) return texto($('estado-upload'), 'Informe o título.', 'estado-erro');
    if (typeof window.tus === 'undefined') {
      return texto($('estado-upload'),
        'A biblioteca de upload (tus-js-client) não carregou. Verifique a conexão e recarregue.', 'estado-erro');
    }

    envio.arquivo = arquivo;
    envio.titulo = titulo;
    $('enviar').disabled = true;
    texto($('estado-upload'), 'Criando o vídeo no servidor…');

    api('/api/upload-token', { method: 'POST', body: JSON.stringify({ titulo: titulo }) })
      .then(function (t) {
        envio.videoId = t.videoId;
        registrar('vídeo criado: ' + t.videoId + ' (assinatura vale até ' +
          new Date(t.expire * 1000).toLocaleTimeString('pt-BR') + ')');
        comecarTus(t, arquivo, titulo);
      })
      .catch(function (e) {
        $('enviar').disabled = false;
        texto($('estado-upload'), e.message, 'estado-erro');
      });
  });

  function comecarTus(t, arquivo, titulo) {
    var upload = new window.tus.Upload(arquivo, {
      endpoint: 'https://video.bunnycdn.com/tusupload',
      retryDelays: [0, 3000, 5000, 10000, 20000, 60000, 60000],
      chunkSize: TAMANHO_PEDACO,
      headers: {
        AuthorizationSignature: t.signature,
        AuthorizationExpire: String(t.expire),
        VideoId: String(t.videoId),
        LibraryId: String(t.libraryId)
      },
      metadata: {
        filetype: arquivo.type || 'video/mp4',
        title: titulo
      },
      onProgress: function (enviados, total) {
        mostrarProgresso(enviados, total);
      },
      onError: function (erro) {
        $('enviar').disabled = false;
        $('cancelar-envio').hidden = true;
        texto($('estado-upload'), 'Falha no envio: ' + erro.message, 'estado-erro');
        registrar('ERRO: ' + erro.message);
      },
      onSuccess: function () {
        $('cancelar-envio').hidden = true;
        texto($('estado-upload'), 'Vídeo enviado. Agora o Bunny está processando.', 'estado-ok');
        registrar('upload concluído');
        abrirMetadados();
        acompanharEncoding(envio.videoId);
      }
    });

    envio.upload = upload;
    $('cancelar-envio').hidden = false;
    texto($('estado-upload'), 'Enviando… não feche esta aba.');

    /* Se a conexão caiu num envio anterior, o TUS retoma de onde parou. */
    upload.findPreviousUploads().then(function (anteriores) {
      if (anteriores.length) {
        upload.resumeFromPreviousUpload(anteriores[0]);
        registrar('retomando envio interrompido');
      }
      upload.start();
    });
  }

  $('cancelar-envio').addEventListener('click', function () {
    if (envio.upload) envio.upload.abort();
    $('cancelar-envio').hidden = true;
    $('enviar').disabled = false;
    texto($('estado-upload'), 'Envio pausado. Clique em "Enviar vídeo" para retomar.');
    registrar('envio pausado pelo usuário');
  });

  /* Armadilha 4: vídeo em fila embeda e não toca. Só publique quando estiver pronto. */
  function acompanharEncoding(videoId) {
    var tentativas = 0;
    var checar = function () {
      tentativas++;
      api('/api/midia?videoId=' + encodeURIComponent(videoId)).then(function (s) {
        if (s.pronto) {
          registrar('encoding concluído — pode publicar');
          $('info-video').textContent = 'videoId ' + videoId + ' · encoding concluído';
          return;
        }
        if (s.falhou) {
          registrar('ENCODING FALHOU no Bunny — não publique este título');
          $('info-video').textContent = 'videoId ' + videoId + ' · encoding FALHOU';
          return;
        }
        $('info-video').textContent = 'videoId ' + videoId + ' · processando ' +
          (s.progresso != null ? s.progresso + '%' : '…');
        if (tentativas < 120) setTimeout(checar, 15000);
      }).catch(function (e) {
        registrar('não foi possível consultar o encoding: ' + e.message);
      });
    };
    checar();
  }

  /* ------------------------------------------------------------ metadados */

  function abrirMetadados() {
    $('caixa-metadados').hidden = false;
    $('m-titulo').value = envio.titulo;
    $('info-video').textContent = 'videoId ' + envio.videoId;
    $('caixa-metadados').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function lerArquivoTexto(arquivo) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('não foi possível ler ' + arquivo.name)); };
      fr.readAsText(arquivo, 'utf-8');
    });
  }

  function enviarCapaELegenda(videoId) {
    var tarefas = [];
    var capa = $('m-capa').files[0];
    var legenda = $('m-legenda').files[0];

    if (capa) {
      tarefas.push(capa.arrayBuffer().then(function (bytes) {
        return api('/api/midia?tipo=capa&videoId=' + encodeURIComponent(videoId), {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: bytes
        }).then(function () { registrar('capa enviada'); });
      }));
    }

    if (legenda) {
      tarefas.push(lerArquivoTexto(legenda).then(function (srt) {
        return api('/api/midia?tipo=legenda&videoId=' + encodeURIComponent(videoId), {
          method: 'POST',
          body: JSON.stringify({ srt: srt, srclang: 'pt', label: 'Português' })
        }).then(function () { registrar('legenda enviada'); });
      }));
    }

    return Promise.all(tarefas);
  }

  $('form-metadados').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!envio.videoId) return texto($('estado-metadados'), 'Envie o vídeo primeiro.', 'estado-erro');

    texto($('estado-metadados'), 'Salvando…');

    var campos = {
      titulo: $('m-titulo').value.trim(),
      serie: $('m-serie').value.trim() || 'A classificar',
      temporada: $('m-temporada').value ? Number($('m-temporada').value) : null,
      episodio: $('m-episodio').value ? Number($('m-episodio').value) : null,
      ano: $('m-ano').value.trim(),
      sinopse: $('m-sinopse').value.trim(),
      tema: $('m-tema').value.trim(),
      publico_alvo: $('m-publico').value.trim(),
      tags: $('m-tags').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      titularidade: $('m-titularidade').value,
      nivel_evidencia: $('m-evidencia').value,
      pendencia: $('m-pendencia').value || null,
      publicar: $('m-publicar').checked,
      arquivo: envio.arquivo ? envio.arquivo.name : '',
      tamanho_mb: envio.arquivo ? Math.round(envio.arquivo.size / 1048576) : null,
      videoId: envio.videoId,
      libraryId: catalogo.config.libraryId || null
    };

    enviarCapaELegenda(envio.videoId)
      .then(function () {
        return salvarCatalogo(function (c) {
          campos.id = GTM.idUnico(c.itens, campos.titulo);
          c.itens.push(GTM.itemNovo(campos));
        });
      })
      .then(function (r) {
        texto($('estado-metadados'),
          'Salvo (rev ' + r.rev + '). ' + (campos.publicar ? 'Já está na grade.' : 'Ainda não publicado.'),
          'estado-ok');
        $('form-metadados').reset();
        $('caixa-metadados').hidden = true;
        $('arquivo').value = '';
        $('titulo-upload').value = '';
        $('enviar').disabled = false;
        $('progresso-caixa').hidden = true;
        envio = { upload: null, videoId: null, arquivo: null, titulo: '' };
      })
      .catch(function (e) {
        var msg = e.status === 409
          ? 'O catálogo mudou em outra tela. Recarregue a página e salve de novo.'
          : e.message;
        texto($('estado-metadados'), msg, 'estado-erro');
      });
  });

  /* -------------------------------------------------------- lista/edição */

  function criar(tag, classe, conteudo) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (conteudo != null) n.textContent = conteudo;
    return n;
  }

  function alterarItem(id, mudancas, aoTerminar) {
    salvarCatalogo(function (c) {
      var alvo = c.itens.find(function (i) { return i.id === id; });
      if (!alvo) return false;
      Object.assign(alvo, mudancas);
    }).then(function (r) {
      if (aoTerminar) aoTerminar(null, r);
    }).catch(function (e) {
      if (aoTerminar) aoTerminar(e);
    });
  }

  /* ----------------------------------------------------- seletor de capa */

  /* Captura o quadro exato que está na tela do <video>.
   * Só funciona porque a pull zone do Bunny devolve Access-Control-Allow-Origin: *
   * e o vídeo é carregado com crossOrigin — sem isso o canvas fica "tainted"
   * e toBlob lança SecurityError. */
  function capturarQuadro(video) {
    return new Promise(function (resolve, reject) {
      if (!video.videoWidth) return reject(new Error('o vídeo ainda não carregou'));
      var canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      try {
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      } catch (e) {
        return reject(new Error('não foi possível ler o quadro: ' + e.message));
      }
      canvas.toBlob(function (blob) {
        blob ? resolve(blob) : reject(new Error('a captura do quadro falhou'));
      }, 'image/jpeg', 0.92);
    });
  }

  function seletorCapa(item) {
    var caixa = criar('div', 'editor');
    caixa.hidden = true;

    var fonte = GTM.resolverFonte(item, catalogo.config);
    var mp4 = GTM.urlMp4(item, catalogo.config, '720p');
    if (!mp4) {
      caixa.appendChild(criar('p', 'estado estado-erro',
        'Sem vídeo no Bunny — não há de onde tirar a capa.'));
      return caixa;
    }

    caixa.appendChild(criar('p', 'card-meta',
      'Navegue até o quadro desejado e clique em "Usar este quadro". ' +
      'Pausar não é obrigatório, mas ajuda a acertar.'));

    var video = document.createElement('video');
    video.crossOrigin = 'anonymous';   /* precisa vir ANTES do src */
    video.src = mp4;
    video.controls = true;
    video.preload = 'metadata';
    video.playsInline = true;
    video.style.width = '100%';
    video.style.maxHeight = '340px';
    video.style.background = '#000';
    video.style.borderRadius = '10px';
    caixa.appendChild(video);

    var estado = criar('p', 'estado');
    var previa = document.createElement('img');
    previa.alt = 'Prévia do quadro escolhido';
    previa.style.cssText = 'width:200px;border-radius:8px;margin-top:10px;display:none';

    var acoes = criar('div', 'acoes');

    var usar = criar('button', 'botao botao-primario', 'Usar este quadro');
    usar.type = 'button';
    usar.addEventListener('click', function () {
      video.pause();
      usar.disabled = true;
      texto(estado, 'Capturando o quadro em ' + video.currentTime.toFixed(1) + ' s…');

      capturarQuadro(video)
        .then(function (blob) {
          previa.src = URL.createObjectURL(blob);
          previa.style.display = 'block';
          texto(estado, 'Enviando a capa (' + Math.round(blob.size / 1024) + ' KB)…');
          return blob.arrayBuffer();
        })
        .then(function (bytes) {
          return api('/api/midia?tipo=capa&videoId=' + encodeURIComponent(fonte.videoId), {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream' },
            body: bytes
          });
        })
        .then(function (resposta) {
          /* `capa_arquivo` é o essencial: o Bunny renomeia a capa recebida com um
           * hash. Sem guardar esse nome, a grade segue mostrando a capa antiga. */
          return new Promise(function (resolve, reject) {
            var mudancas = { capa_versao: String(Date.now()) };
            if (resposta && resposta.capa_arquivo) mudancas.capa_arquivo = resposta.capa_arquivo;
            alterarItem(item.id, mudancas, function (erro) {
              erro ? reject(erro) : resolve();
            });
          });
        })
        .then(function () {
          texto(estado, 'Capa trocada.', 'estado-ok');
        })
        .catch(function (e) {
          usar.disabled = false;
          texto(estado, e.message, 'estado-erro');
        });
    });

    var fechar = criar('button', 'botao', 'Fechar');
    fechar.type = 'button';
    fechar.addEventListener('click', function () {
      video.pause();
      caixa.hidden = true;
    });

    acoes.appendChild(usar);
    acoes.appendChild(fechar);
    caixa.appendChild(acoes);
    caixa.appendChild(estado);
    caixa.appendChild(previa);
    return caixa;
  }

  function editor(item) {
    var caixa = criar('div', 'editor');
    caixa.hidden = true;

    var campo = function (rotulo, valor, multi) {
      var d = criar('div', 'campo');
      var l = criar('label', null, rotulo);
      var entrada = document.createElement(multi ? 'textarea' : 'input');
      if (!multi) entrada.type = 'text';
      entrada.value = valor == null ? '' : String(valor);
      var idCampo = 'e-' + Math.random().toString(36).slice(2, 9);
      entrada.id = idCampo;
      l.htmlFor = idCampo;
      d.appendChild(l);
      d.appendChild(entrada);
      caixa.appendChild(d);
      return entrada;
    };

    var eTitulo = campo('Título', item.titulo);
    var eSerie = campo('Série', item.serie);

    var linha = criar('div', 'campo-linha');
    caixa.appendChild(linha);
    var mini = function (rotulo, valor) {
      var d = criar('div', 'campo');
      var l = criar('label', null, rotulo);
      var e = document.createElement('input');
      e.type = 'text';
      e.value = valor == null ? '' : String(valor);
      var idc = 'e-' + Math.random().toString(36).slice(2, 9);
      e.id = idc; l.htmlFor = idc;
      d.appendChild(l); d.appendChild(e);
      linha.appendChild(d);
      return e;
    };
    var eTemporada = mini('Temporada', item.temporada);
    var eEpisodio = mini('Episódio', item.episodio);
    var eAno = mini('Ano', item.ano);

    var eSinopse = campo('Sinopse', item.sinopse, true);
    var eTema = campo('Tema', item.tema);
    var ePublico = campo('Público-alvo', item.publico_alvo);
    var eTags = campo('Tags (vírgula)', (item.tags || []).join(', '));

    var estado = criar('p', 'estado');
    var acoes = criar('div', 'acoes');

    var salvar = criar('button', 'botao botao-primario', 'Salvar');
    salvar.type = 'button';
    salvar.addEventListener('click', function () {
      texto(estado, 'Salvando…');
      var num = function (v) { return v.trim() === '' ? null : Number(v); };
      alterarItem(item.id, {
        titulo: eTitulo.value.trim(),
        serie: eSerie.value.trim() || 'A classificar',
        temporada: num(eTemporada.value),
        episodio: num(eEpisodio.value),
        ano: eAno.value.trim(),
        sinopse: eSinopse.value.trim(),
        tema: eTema.value.trim(),
        publico_alvo: ePublico.value.trim(),
        tags: eTags.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        /* Editar a sinopse à mão é, por definição, revisá-la. */
        sinopse_origem: eSinopse.value.trim() !== (item.sinopse || '')
          ? 'revisada'
          : (item.sinopse_origem || '')
      }, function (erro) {
        if (erro) texto(estado, erro.message, 'estado-erro');
      });
    });

    var fechar = criar('button', 'botao', 'Cancelar');
    fechar.type = 'button';
    fechar.addEventListener('click', function () { caixa.hidden = true; });

    acoes.appendChild(salvar);
    acoes.appendChild(fechar);
    caixa.appendChild(acoes);
    caixa.appendChild(estado);
    return caixa;
  }

  /* Miniatura da capa na listagem: sem ela, distinguir 55 títulos parecidos
   * (mesma série, nomes de arquivo herdados do bruto) vira adivinhação. */
  function miniatura(item, aoClicar) {
    var caixa = criar('div', 'linha-admin-capa');
    var url = GTM.urlCapa(item, catalogo.config);

    if (url) {
      var img = criar('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      /* Capa ainda não gerada na pull zone devolve 404: troca pelo vazio em vez
       * de deixar o ícone quebrado. */
      img.addEventListener('error', function () {
        caixa.replaceChild(criar('div', 'card-capa-vazia', 'sem capa'), img);
      });
      caixa.appendChild(img);
    } else {
      caixa.appendChild(criar('div', 'card-capa-vazia',
        item.fonte && item.fonte.videoId ? 'sem capa' : 'sem vídeo'));
    }

    var dur = GTM.formatarDuracao(item);
    if (dur) caixa.appendChild(criar('span', 'card-duracao', dur));

    if (aoClicar) {
      caixa.classList.add('linha-admin-capa-clicavel');
      caixa.title = 'Escolher capa';
      caixa.addEventListener('click', aoClicar);
    }
    return caixa;
  }

  function linha(item) {
    var caixa = criar('div', 'linha-admin');
    var cabeca = criar('div', 'linha-admin-cabeca');
    var conteudo = criar('div', 'linha-admin-conteudo');

    var painelEditor = editor(item);
    var painelCapa = seletorCapa(item);
    var temVideo = !!(item.fonte && item.fonte.videoId);

    cabeca.appendChild(miniatura(item, temVideo ? function () {
      painelCapa.hidden = !painelCapa.hidden;
    } : null));

    var topo = criar('div', 'linha-admin-topo');

    topo.appendChild(criar('span', 'linha-admin-titulo', item.titulo || '(sem título)'));

    var meta = [
      item.serie,
      GTM.rotuloEpisodio(item),
      GTM.formatarDuracao(item),
      item.publicar ? 'publicado' : 'não publicado',
      item.fonte && item.fonte.videoId ? 'com vídeo' : 'SEM VÍDEO'
    ].filter(Boolean).join(' · ');
    topo.appendChild(criar('span', 'linha-admin-meta', meta));
    conteudo.appendChild(topo);

    /* A nota de curadoria aparece mesmo sem pendência: há achados que não
     * impedem a publicação mas explicam algo que ninguém deve redescobrir
     * do zero — como "este áudio não tem fala, não adianta transcrever". */
    if (item.pendencia || item.nota_curadoria) {
      var partes = [GTM.rotuloPendencia(item.pendencia), item.nota_curadoria]
        .filter(Boolean).join(' — ');
      var pend = criar('div', 'aviso', partes);
      pend.style.margin = '10px 0 0';
      if (item.pendencia === 'material_bruto' || item.pendencia === 'nao_e_conteudo') {
        pend.className = 'aviso aviso-erro';
      }
      conteudo.appendChild(pend);
    }

    if (GTM.precisaRevisao(item)) {
      var av = criar('div', 'aviso', 'Sinopse gerada automaticamente — ainda não revisada.');
      av.style.margin = '10px 0 0';
      conteudo.appendChild(av);
    }

    if (item.sinopse) {
      var s = criar('p', 'card-meta', item.sinopse);
      s.style.marginTop = '8px';
      conteudo.appendChild(s);
    }

    var acoes = criar('div', 'acoes');
    var estado = criar('p', 'estado');

    var bEditar = criar('button', 'botao', 'Editar');
    bEditar.type = 'button';
    bEditar.addEventListener('click', function () { painelEditor.hidden = !painelEditor.hidden; });
    acoes.appendChild(bEditar);

    if (temVideo) {
      var bCapa = criar('button', 'botao', 'Escolher capa');
      bCapa.type = 'button';
      bCapa.addEventListener('click', function () { painelCapa.hidden = !painelCapa.hidden; });
      acoes.appendChild(bCapa);
    }

    var bPublicar = criar('button', 'botao', item.publicar ? 'Despublicar' : 'Publicar');
    bPublicar.type = 'button';
    bPublicar.addEventListener('click', function () {
      if (!item.publicar && !temVideo) {
        return texto(estado, 'Este título não tem vídeo no Bunny — publicar deixaria um player vazio.', 'estado-erro');
      }
      /* Marcado como bruto de câmera na curadoria: dá para publicar assim mesmo,
       * mas não por descuido. */
      if (!item.publicar && item.pendencia === 'material_bruto' &&
          !window.confirm('Este título foi identificado como MATERIAL BRUTO (não editado).\n\n' +
            (item.nota_curadoria || '') + '\n\nPublicar mesmo assim?')) {
        return;
      }
      bPublicar.disabled = true;
      texto(estado, 'Salvando…');
      alterarItem(item.id, { publicar: !item.publicar }, function (erro) {
        if (erro) { bPublicar.disabled = false; texto(estado, erro.message, 'estado-erro'); }
      });
    });
    acoes.appendChild(bPublicar);

    if (GTM.precisaRevisao(item)) {
      var bConfirmar = criar('button', 'botao', 'Confirmar sinopse');
      bConfirmar.type = 'button';
      bConfirmar.addEventListener('click', function () {
        bConfirmar.disabled = true;
        texto(estado, 'Salvando…');
        alterarItem(item.id, { sinopse_origem: 'revisada' }, function (erro) {
          if (erro) { bConfirmar.disabled = false; texto(estado, erro.message, 'estado-erro'); }
        });
      });
      acoes.appendChild(bConfirmar);
    }

    if (item.publicar && temVideo) {
      var ver = criar('a', 'botao', 'Ver na grade');
      ver.href = 'index.html#/ep/' + encodeURIComponent(item.id);
      ver.target = '_blank';
      ver.rel = 'noopener';
      acoes.appendChild(ver);
    }

    conteudo.appendChild(acoes);
    conteudo.appendChild(estado);

    cabeca.appendChild(conteudo);
    caixa.appendChild(cabeca);
    caixa.appendChild(painelEditor);
    caixa.appendChild(painelCapa);
    return caixa;
  }

  function renderLista() {
    var alvo = $('lista');
    alvo.innerHTML = '';

    var itens = GTM.buscar(catalogo.itens, $('filtro').value);
    if ($('so-revisar').checked) itens = itens.filter(GTM.precisaRevisao);
    if ($('so-publicados').checked) itens = itens.filter(function (i) { return i.publicar; });
    itens = GTM.ordenar(itens);

    texto($('estado-catalogo'),
      itens.length + ' de ' + catalogo.itens.length + ' títulos · rev ' + catalogo.rev);

    if (!itens.length) {
      alvo.appendChild(criar('p', 'card-meta', 'Nenhum título com esses filtros.'));
      return;
    }
    itens.forEach(function (i) { alvo.appendChild(linha(i)); });
  }

  $('filtro').addEventListener('input', renderLista);
  $('so-revisar').addEventListener('change', renderLista);
  $('so-publicados').addEventListener('change', renderLista);

  /* ---------------------------------------------------------------- início */

  if (recuperarSessao()) abrirPainel();
})();
