/* functions/api/_middleware.js — roda antes de toda função em /api/*.
 *
 * Faz três coisas:
 *   1. decide se a requisição é do admin (Bearer token emitido por /api/login);
 *   2. barra o que não for público — o padrão é "exige admin", então uma função
 *      nova nasce protegida em vez de nascer aberta;
 *   3. entrega em `data.bunny` o acesso à API do Bunny, único lugar do projeto
 *      onde a AccessKey existe. Ela nunca é devolvida ao navegador.
 *
 * `_middleware.js` é o único nome de arquivo que o Pages trata como middleware
 * e não como rota — por isso os utilitários compartilhados moram aqui.
 */

const ROTULO_TOKEN = 'gtm-admin:';
const VALIDADE_TOKEN_S = 8 * 60 * 60;   /* 8 h: uma jornada de trabalho */

export function json(status, corpo, extras) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: Object.assign({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }, extras || {})
  });
}

const enc = new TextEncoder();

function hex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Comparação sem vazar o ponto da divergência pelo tempo de execução. */
export function iguaisEmTempoConstante(a, b) {
  const A = enc.encode(String(a));
  const B = enc.encode(String(b));
  let diferenca = A.length ^ B.length;
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) diferenca |= (A[i] || 0) ^ (B[i] || 0);
  return diferenca === 0;
}

async function assinarHmac(segredo, mensagem) {
  const chave = await crypto.subtle.importKey(
    'raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return hex(await crypto.subtle.sign('HMAC', chave, enc.encode(mensagem)));
}

export async function emitirToken(senha) {
  const expira = Math.floor(Date.now() / 1000) + VALIDADE_TOKEN_S;
  const assinatura = await assinarHmac(senha, ROTULO_TOKEN + expira);
  return { token: expira + '.' + assinatura, expira };
}

async function tokenValido(token, senha) {
  if (!token || typeof token !== 'string') return false;
  const partes = token.split('.');
  if (partes.length !== 2) return false;
  const expira = Number(partes[0]);
  if (!Number.isFinite(expira) || expira < Math.floor(Date.now() / 1000)) return false;
  const esperado = await assinarHmac(senha, ROTULO_TOKEN + expira);
  return iguaisEmTempoConstante(partes[1], esperado);
}

async function sha256hex(texto) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(texto)));
}

function criarClienteBunny(env) {
  const libraryId = String(env.BUNNY_LIBRARY_ID || '');
  const apiKey = String(env.BUNNY_API_KEY || '');
  const base = 'https://video.bunnycdn.com/library/' + libraryId;

  return {
    libraryId,
    configurado: Boolean(libraryId && apiKey),

    /* A AccessKey entra aqui e não sai daqui. */
    async chamar(caminho, init = {}) {
      return fetch(base + caminho, Object.assign({}, init, {
        headers: Object.assign({ AccessKey: apiKey, accept: 'application/json' }, init.headers || {})
      }));
    },

    /* Assinatura de uso único do upload TUS.
     * expire é UNIX em SEGUNDOS — milissegundos invalidam a assinatura. */
    async assinarUpload(videoId, expira) {
      return sha256hex(libraryId + apiKey + expira + videoId);
    }
  };
}

export async function onRequest(context) {
  const { request, env, data, next } = context;
  const rota = new URL(request.url).pathname.replace(/\/+$/, '') || '/api';

  if (!env.ADMIN_PASSWORD) {
    return json(500, { erro: 'ADMIN_PASSWORD não configurada no ambiente do Pages' });
  }

  const cabecalho = request.headers.get('authorization') || '';
  const token = cabecalho.toLowerCase().startsWith('bearer ') ? cabecalho.slice(7).trim() : '';
  data.admin = await tokenValido(token, env.ADMIN_PASSWORD);
  data.bunny = criarClienteBunny(env);

  /* Aberto ao público interno: o login e a leitura do catálogo. Todo o resto
   * exige admin — inclusive rotas que ainda nem existem. */
  const publico = rota === '/api/login' ||
    (rota === '/api/catalogo' && request.method === 'GET');

  if (!publico && !data.admin) {
    return json(401, { erro: 'não autorizado' });
  }

  const resposta = await next();
  const saida = new Response(resposta.body, resposta);
  saida.headers.set('cache-control', 'no-store');
  saida.headers.set('x-content-type-options', 'nosniff');
  saida.headers.set('referrer-policy', 'no-referrer');
  return saida;
}
