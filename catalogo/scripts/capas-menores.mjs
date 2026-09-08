/* scripts/capas-menores.mjs — troca as capas da pull zone por versões menores,
 * SEM trocar o quadro: a imagem que já está lá é baixada, reduzida e devolvida.
 *
 *   node scripts/capas-menores.mjs --medir             só mede o que está no ar
 *   node scripts/capas-menores.mjs --simular           mostra o plano e o que pouparia
 *   node scripts/capas-menores.mjs --item <id>[,<id>]  um título só (o piloto)
 *   node scripts/capas-menores.mjs                     todos
 *   node scripts/capas-menores.mjs --largura 640       muda o alvo
 *
 * POR QUE EXISTE (a §5.5 do PROXIMA-SESSAO.md, medida em 08/09): as capas da
 * tela inicial somavam 7,71 MB em 66 arquivos de 1280 px de largura, entrando
 * num cartão de 180 px no celular e ~327 px no computador. É o único peso que
 * todo mundo paga em toda visita, e a tela inicial lenta em conexão ruim foi
 * relatada por quem usa o site.
 *
 * POR QUE NÃO É O `gerar-capas.mjs`: aquele extrai um quadro NOVO do master, e
 * regerar por cima desfaria a curadoria de quem escolheu a capa pela tela de
 * admin. Aqui a origem é a própria capa que está no ar — o quadro é o mesmo até
 * o último pixel, só que com menos deles.
 *
 * POR QUE NÃO É UM PARÂMETRO NA URL: o Bunny Optimizer resolveria isto com
 * `?width=400`, mas ele não está ligado nesta pull zone — medido em 08/09, e a
 * resposta volta byte a byte idêntica com o parâmetro e sem ele.
 *
 * A LARGURA, e de onde ela sai. O cartão da grade é o consumidor principal, e
 * ele mede no MÁXIMO 321 px — MEDIDO no site no ar, numa janela de 1400 px,
 * onde o `.grade` (`minmax(min(280px,100%), 1fr)`, `gap: 20px`, dentro de um
 * `.limite` de 1400) resolve em 4 colunas de 323,25 px. Janela mais larga não
 * aumenta: o `.limite` para em 1400. No celular o teto é 180 px, escrito no
 * `.card-capa`. A 2× de densidade, 321 px pedem 642 — daí os 640.
 *
 * MAS O CARTÃO NÃO É O ÚNICO FREGUÊS: a mesma URL é o `poster` do player
 * (`player.js`), num quadro de 881 px na ficha — também medido no ar, na mesma
 * janela de 1400 — e do tamanho da tela em tela cheia. Foi por isso que a
 * largura não desceu aos 400 que a §5.5 calculou olhando só para a grade: a
 * 400 px o poster de 881 subiria 2,2×, e ele é a primeira coisa que se vê
 * antes do play. A 640 a subida é 1,4×.
 *
 * O DESFAZER: o Bunny guarda a capa antiga no nome com hash que ela já tinha e
 * grava a nova com um hash NOVO — a mesma armadilha da §6 vista pelo lado bom.
 * Voltar atrás é devolver o `capa_arquivo` anterior ao KV; este script imprime
 * os dois nomes de cada título, e é para isso que eles servem.
 *
 * O `preview.webp` NÃO é tocado: ele é pedido só no `mouseenter`, nunca na
 * carga da tela, e é outro problema.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, unlink, mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarCliente } from './lib/bunny.mjs';
import { argumentos, lerCatalogo, gravarCatalogo, CATALOGO_PADRAO, agora, erroFatal } from './lib/catalogo.mjs';

const op = argumentos();
const site = (typeof op.site === 'string' ? op.site : process.env.GTM_SITE || '').replace(/\/+$/, '');
const senha = process.env.GTM_SENHA || process.env.ADMIN_PASSWORD || '';
const caminhoCatalogo = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;
const LARGURA = Number(op.largura) > 0 ? Number(op.largura) : 640;
const QUALIDADE = Number(op.qualidade) > 0 ? Number(op.qualidade) : 4;
const ensaio = Boolean(op.simular || op.medir);

/* Largura e altura lidas do próprio JPEG (marcador SOFn). Sem dependência: o
 * projeto tem uma dependência de terceiros só, e ela é a hls.js. */
function dimensoes(buf) {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    if (m === 0xD8 || (m >= 0xD0 && m <= 0xD9)) { i += 2; continue; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { w: 0, h: 0 };
}

/* `min(LARGURA, iw)` e não `LARGURA`: uma capa que já seja menor que o alvo não
 * pode ser AMPLIADA por este script — sairia maior e mais borrada. */
function reduzir(entrada, saida) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-v', 'error', '-i', entrada,
      '-vf', "scale='min(" + LARGURA + ",iw)':-2",
      '-q:v', String(QUALIDADE),
      saida
    ]);
    let erro = '';
    ff.stderr.on('data', d => { erro += d; });
    ff.on('error', e => reject(new Error('ffmpeg não rodou: ' + e.message)));
    ff.on('close', c => c === 0 ? resolve() : reject(new Error('ffmpeg ' + c + ': ' + erro.slice(0, 300))));
  });
}

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

function urlCapa(item, config) {
  return 'https://' + config.pullzone + '/' + item.fonte.videoId + '/' +
    (item.capa_arquivo || 'thumbnail.jpg');
}

/* A pull zone é protegida por Allowed Referrers e responde 403 sem o cabeçalho.
 * É a mesma razão pela qual `no-referrer` quebrou as capas uma vez. */
async function baixar(url) {
  const r = await fetch(url, { headers: { Referer: site + '/' } });
  if (!r.ok) throw new Error('a pull zone respondeu ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

try {
  if (!site) throw new Error('defina GTM_SITE');
  if (!senha) throw new Error('defina GTM_SENHA ou ADMIN_PASSWORD');

  /* A fonte da verdade é o KV, não o `catalogo.seed.json` — ele está com
   * `publicar: false` em tudo desde 20/08. */
  const entrada = await fetch(site + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ senha })
  });
  if (!entrada.ok) throw new Error('login recusado (' + entrada.status + ')');
  const { token } = await entrada.json();
  const auth = { Authorization: 'Bearer ' + token, accept: 'application/json' };

  const leitura = await fetch(site + '/api/catalogo?completo=1', { headers: auth });
  if (!leitura.ok) throw new Error('leitura do KV falhou (' + leitura.status + ')');
  const kv = await leitura.json();
  const config = kv.config;
  delete kv.config;

  const pedidos = typeof op.item === 'string' ? new Set(op.item.split(',').map(s => s.trim())) : null;

  /* Só o que a grade mostra: capa de título não publicado não pesa na tela
   * inicial, e mexer nela seria trabalho sem ninguém do outro lado. */
  const alvos = (kv.itens || []).filter(i =>
    i && i.publicar === true && i.fonte && i.fonte.videoId &&
    (!pedidos || pedidos.has(i.id)));

  if (!alvos.length) throw new Error('nenhum título publicado bate com o pedido.');

  console.log('KV rev ' + kv.rev + '  ·  ' + alvos.length + ' capa(s) publicada(s)  ·  alvo: ' +
    LARGURA + ' px de largura, q=' + QUALIDADE + '\n');

  const pasta = await mkdtemp(join(tmpdir(), 'gtm-capas-'));
  const feitos = [];
  let somaAntes = 0, somaDepois = 0, erros = 0, jaPequenas = 0;
  const bunny = ensaio ? null : criarCliente();

  try {
    for (const item of alvos) {
      const antes = await baixar(urlCapa(item, config));
      const d = dimensoes(antes);
      somaAntes += antes.length;

      if (d.w && d.w <= LARGURA) {
        jaPequenas++;
        somaDepois += antes.length;
        console.log(agora() + '  =  ' + item.titulo + '  (já tem ' + d.w + ' px)');
        continue;
      }

      const cru = join(pasta, item.id + '.orig.jpg');
      const novo = join(pasta, item.id + '.jpg');
      await writeFile(cru, antes);
      await reduzir(cru, novo);
      const depois = await readFile(novo);
      const dd = dimensoes(depois);
      somaDepois += depois.length;

      if (ensaio) {
        console.log(agora() + '  ·  ' + item.titulo);
        console.log('        ' + d.w + '×' + d.h + ' ' + kb(antes.length) +
          '  ->  ' + dd.w + '×' + dd.h + ' ' + kb(depois.length));
      } else {
        try {
          await bunny.enviarCapa(item.fonte.videoId, novo);
          const v = await bunny.consultar(item.fonte.videoId);
          const nome = v.thumbnailFileName || 'thumbnail.jpg';
          feitos.push({ item, de: item.capa_arquivo || '(sem registro)', para: nome });
          item.capa_arquivo = nome;
          item.capa_versao = String(Date.now());
          console.log(agora() + '  ✔  ' + item.titulo);
          console.log('        ' + d.w + '×' + d.h + ' ' + kb(antes.length) +
            '  ->  ' + dd.w + '×' + dd.h + ' ' + kb(depois.length) + '   ' + nome);
        } catch (e) {
          erros++;
          somaDepois += antes.length - depois.length;   /* não mudou: desfaz a conta */
          console.error(agora() + '  ✖  ' + item.titulo + ': ' + e.message);
        }
      }

      await unlink(cru).catch(() => {});
      await unlink(novo).catch(() => {});
    }
  } finally {
    await rmdir(pasta).catch(() => {});
  }

  console.log('\nantes:  ' + mb(somaAntes) + '   ·   depois: ' + mb(somaDepois) +
    '   ·   poupa ' + mb(somaAntes - somaDepois) +
    ' (' + (100 - somaDepois / somaAntes * 100).toFixed(0) + '%)');
  if (jaPequenas) console.log('já estavam no tamanho: ' + jaPequenas);
  if (erros) console.log('erros: ' + erros);

  if (ensaio) {
    console.log('\nensaio: nada foi enviado ao Bunny nem gravado no KV.');
    process.exit(0);
  }
  if (!feitos.length) { console.log('\nnada mudou.'); process.exit(0); }

  /* O KV inteiro volta como veio, com dois campos trocados nos títulos
   * tocados. Nada de `semear.mjs --sobrescrever`: ele reverteria os títulos e
   * séries editados pela tela de admin. O `rev` é o do GET, e o PUT recusa se
   * alguém tiver gravado no meio do caminho. */
  const escrita = await fetch(site + '/api/catalogo', {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(kv)
  });
  const resposta = await escrita.json().catch(() => ({}));
  if (!escrita.ok) {
    console.error('\n⚠ AS CAPAS NOVAS ESTÃO NO BUNNY, MAS O KV NÃO FOI GRAVADO.');
    console.error('  A grade continua servindo as antigas, que seguem no ar — nada quebrou.');
    console.error('  Os nomes novos estão listados acima; rode de novo para regravar.');
    throw new Error('gravação recusada (' + escrita.status + '): ' + (resposta.erro || JSON.stringify(resposta)));
  }
  console.log('\n✔ KV gravado  ·  rev ' + resposta.rev + '  ·  ' + feitos.length + ' capa(s) trocada(s)');

  /* O seed local leva os mesmos dois campos. Ele não serve a grade, mas
   * `acrescentar-ao-kv.mjs` lê dele — e um `capa_arquivo` velho ali é um nome
   * de arquivo antigo esperando para voltar ao KV em silêncio. */
  try {
    const local = await lerCatalogo(caminhoCatalogo);
    const porId = new Map(local.itens.map(i => [i.id, i]));
    let noSeed = 0;
    for (const { item } of feitos) {
      const alvo = porId.get(item.id);
      if (!alvo) continue;
      alvo.capa_arquivo = item.capa_arquivo;
      alvo.capa_versao = item.capa_versao;
      noSeed++;
    }
    if (noSeed) {
      await gravarCatalogo(local, caminhoCatalogo);
      console.log('   e ' + noSeed + ' no ' + caminhoCatalogo.split(/[\\/]/).pop());
    }
  } catch (e) {
    console.error('   (o seed local não foi atualizado: ' + e.message + ')');
  }

  console.log('\npara conferir o que ficou no ar:');
  console.log('   node scripts/capas-menores.mjs --medir');
} catch (e) {
  erroFatal(e);
}
