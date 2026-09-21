/* scripts/mesa-local.mjs — a mesa inteira no computador, sem nuvem e sem KV.
 *
 *   node scripts/mesa-local.mjs              http://127.0.0.1:8790/admin.html
 *   node scripts/mesa-local.mjs --porta 9000
 *
 * A SENHA É `local`, e qualquer usuário entra. Isto não é o servidor de
 * verdade: é o `site/` servido como arquivo, com um `/api` de mentira por
 * cima, alimentado pelo `catalogo.seed.json`. Serve para ver e clicar a mesa —
 * ordenar a tabela, filtrar, buscar, editar no painel, montar rascunho.
 *
 * POR QUE ELE EXISTE: um servidor de arquivos puro (`python -m http.server`)
 * abre o `admin.html` mas nenhuma senha funciona ali, porque não há `/api/login`
 * nenhum para responder — o formulário fala com um 404. E `wrangler pages dev`,
 * que roda as funções de verdade, sobe com o KV local VAZIO: entra-se na mesa
 * para encontrar um catálogo de zero título, que é justamente o que não dá para
 * testar. Este script fica no meio: front-end real, dados reais, back-end falso.
 *
 * O QUE ELE NÃO É:
 *   - não confere senha, não expira token, não olha permissão. Toda sessão é
 *     superadmin. Quem guarda essas regras é o `functions/api/`, e quem as
 *     testa é o `tests/catalogo.test.js`;
 *   - o GET público devolve os títulos publicados INTEIROS, e não o recorte de
 *     `paraPublico()`. Não use esta porta para conferir o que vaza para o
 *     público — esse recorte é do servidor de verdade, e tem teste próprio;
 *   - o PUT só grava na MEMÓRIA. Publicar funciona, a rev sobe, o histórico da
 *     sessão anda; fechar o processo devolve tudo ao que o seed diz. O
 *     `catalogo.seed.json` não é tocado, de propósito.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argumentos, lerCatalogo } from './lib/catalogo.mjs';
import { carregarEnv } from './lib/env.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(AQUI, '..', 'site');

const op = argumentos();
const porta = Number(op.porta) || 8790;

await carregarEnv().catch(() => {});

/* O documento vive aqui dentro enquanto o processo estiver de pé. `rev` começa
 * em 1 porque a barra da mesa mostra o número, e `undefined` na tela assusta
 * à toa — o seed não tem esse campo, que nasce no KV. */
const catalogo = await lerCatalogo();
catalogo.rev = catalogo.rev || 1;
catalogo.ajustes = catalogo.ajustes || {};

const TIPOS = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.vtt': 'text/vtt', '.txt': 'text/plain',
  '.woff2': 'font/woff2', '.map': 'application/json'
};

function responder(res, status, corpo) {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(texto);
}

function corpoDoPedido(req) {
  return new Promise((resolve) => {
    let bruto = '';
    req.on('data', (p) => { bruto += p; });
    req.on('end', () => {
      try { resolve(JSON.parse(bruto || '{}')); } catch (e) { resolve(null); }
    });
  });
}

/* As permissões saem do próprio core: acrescentar uma permissão nova lá não
 * pode deixar a mesa local capenga sem ninguém notar. */
const { default: GTM } = await import('../site/catalogo-core.js');

async function api(req, res, url) {
  const caminho = url.pathname;

  if (caminho === '/api/login' && req.method === 'POST') {
    const corpo = await corpoDoPedido(req);
    const usuario = String((corpo && corpo.usuario) || '').trim().toLowerCase() || 'superadmin';
    if (!corpo || corpo.senha !== 'local') {
      return responder(res, 401, { erro: 'nesta porta a senha é `local` — é uma mesa de teste, e ela não confere mais nada' });
    }
    return responder(res, 200, {
      token: 'mesa-local',
      expira: Math.floor(Date.now() / 1000) + 12 * 3600,
      usuario, nome: usuario === 'superadmin' ? 'Superadmin (local)' : usuario,
      super: true, permissoes: GTM.PERMISSOES.slice()
    });
  }

  if (caminho === '/api/catalogo' && req.method === 'GET') {
    const config = {
      libraryId: process.env.BUNNY_LIBRARY_ID || null,
      pullzone: process.env.BUNNY_PULLZONE || null
    };
    if (url.searchParams.get('completo') === '1') {
      return responder(res, 200, Object.assign({}, catalogo, { config }));
    }
    return responder(res, 200, {
      itens: GTM.publicaveis(catalogo.itens),
      ajustes: catalogo.ajustes,
      site: GTM.siteSaneado(catalogo.site),
      config, rev: catalogo.rev
    });
  }

  if (caminho === '/api/catalogo' && req.method === 'PUT') {
    const corpo = await corpoDoPedido(req);
    if (!corpo || !Array.isArray(corpo.itens)) return responder(res, 400, { erro: 'corpo inválido' });
    catalogo.itens = corpo.itens;
    if (corpo.ajustes) catalogo.ajustes = corpo.ajustes;
    if (corpo.site) catalogo.site = corpo.site;
    catalogo.rev = (catalogo.rev || 1) + 1;
    console.log('  PUT /api/catalogo — rev ' + catalogo.rev + ', ' + catalogo.itens.length + ' títulos (só na memória)');
    return responder(res, 200, { ok: true, rev: catalogo.rev });
  }

  /* A mesa relê a conta ao abrir, antes do catálogo: as permissões podem ter
   * mudado desde o login. Sem esta rota a mesa nem chega à tabela. */
  if (caminho === '/api/conta' && req.method === 'GET') {
    return responder(res, 200, { usuario: 'superadmin', nome: 'Superadmin (local)', super: true, permissoes: GTM.PERMISSOES.slice() });
  }

  if (caminho === '/api/contas' && req.method === 'GET') return responder(res, 200, { contas: [] });
  if (caminho === '/api/autorizacoes' && req.method === 'GET') return responder(res, 200, { pedidos: [] });
  if (caminho === '/api/historico' && req.method === 'GET') return responder(res, 200, { linha: [], fim: true });

  /* Um 501 com recado é melhor do que um 404 mudo: a tela mostra a frase, e
   * quem está testando entende na hora que faltou a rota, e não o dado. */
  return responder(res, 501, { erro: 'a mesa local não finge ' + req.method + ' ' + caminho + ' — suba o wrangler para esta parte' });
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || '127.0.0.1'));
  if (url.pathname.startsWith('/api/')) {
    try { return await api(req, res, url); }
    catch (e) { return responder(res, 500, { erro: String(e && e.message || e) }); }
  }

  const nome = url.pathname === '/' ? '/admin.html' : url.pathname;
  const arquivo = path.join(SITE, path.normalize(nome).replace(/^[\\/]+/, ''));
  /* Um `..` no caminho sairia de `site/` e serviria o `.env` da raiz. */
  if (!arquivo.startsWith(SITE)) { res.writeHead(403); return res.end('fora do site/'); }
  try {
    const dados = await readFile(arquivo);
    res.writeHead(200, {
      'content-type': (TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream') + '; charset=utf-8',
      'cache-control': 'no-store'
    });
    res.end(dados);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('não achei ' + nome);
  }
});

servidor.listen(porta, '127.0.0.1', () => {
  console.log('');
  console.log('  Mesa local  ·  http://127.0.0.1:' + porta + '/admin.html');
  console.log('  Senha: local   (usuário em branco)');
  console.log('  ' + catalogo.itens.length + ' títulos do catalogo.seed.json · o PUT não sai da memória');
  if (!process.env.BUNNY_PULLZONE) console.log('  Sem BUNNY_PULLZONE no .env: as capas ficam cinzas, e o resto funciona.');
  console.log('');
});
