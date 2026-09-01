/* GET  /api/midia?videoId=...                 -> status do encoding no Bunny
 * POST /api/midia?tipo=capa&videoId=...       -> corpo binário JPG
 * POST /api/midia?tipo=legenda&videoId=...    -> { srt, srclang?, label? }
 *
 * Capa e legenda são arquivos pequenos: podem passar pela função sem esbarrar
 * no limite de tamanho de requisição. Vídeo, não — esse vai por TUS direto
 * do navegador (ver upload-token.js).
 *
 * Rota inteira exige admin: o middleware barra antes de chegar aqui.
 */
import { json } from './_middleware.js';

const LIMITE_CAPA = 8 * 1024 * 1024;
const LIMITE_LEGENDA = 4 * 1024 * 1024;

function base64Utf8(texto) {
  const bytes = new TextEncoder().encode(texto);
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

function exigeVideoId(request) {
  const id = new URL(request.url).searchParams.get('videoId');
  return id && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
}

/* Task 2.4 / armadilha 4: um vídeo ainda em fila embeda e não toca — parece
 * bug do site. A tela de admin usa isto para não publicar cedo demais. */
export async function onRequestGet({ request, data }) {
  const videoId = exigeVideoId(request);
  if (!videoId) return json(400, { erro: 'informe um `videoId` válido' });

  const r = await data.bunny.chamar('/videos/' + videoId);
  if (!r.ok) {
    return json(502, { erro: 'Bunny recusou a consulta', status: r.status, detalhe: await r.text() });
  }

  const v = await r.json();
  /* status 4 = Finished, 5 = Failed (tabela de status do Bunny Stream) */
  return json(200, {
    videoId,
    status: v.status,
    pronto: v.status === 4,
    falhou: v.status === 5,
    progresso: v.encodeProgress ?? null,
    duracao_seg: v.length ?? null,
    titulo: v.title ?? null
  });
}

export async function onRequestPost({ request, data }) {
  const url = new URL(request.url);
  const videoId = exigeVideoId(request);
  const tipo = url.searchParams.get('tipo');
  if (!videoId) return json(400, { erro: 'informe um `videoId` válido' });

  if (tipo === 'capa') {
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return json(400, { erro: 'corpo vazio' });
    if (bytes.byteLength > LIMITE_CAPA) return json(413, { erro: 'capa acima de 8 MB' });

    const r = await data.bunny.chamar('/videos/' + videoId + '/thumbnail', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes
    });
    if (!r.ok) {
      return json(502, { erro: 'Bunny recusou a capa', status: r.status, detalhe: await r.text() });
    }

    /* O Bunny grava a capa recebida com um hash no nome e mantém o thumbnail.jpg
     * antigo no lugar. Sem devolver o nome real, a grade continua mostrando a
     * capa velha — respondendo 200, sem nenhum sinal de erro. */
    let capaArquivo = null;
    const consulta = await data.bunny.chamar('/videos/' + videoId);
    if (consulta.ok) {
      const v = await consulta.json();
      capaArquivo = v.thumbnailFileName || null;
    }

    return json(200, { ok: true, videoId, capa_arquivo: capaArquivo });
  }

  if (tipo === 'legenda') {
    let corpo;
    try {
      corpo = await request.json();
    } catch (e) {
      return json(400, { erro: 'corpo inválido: esperado JSON com `srt`' });
    }

    const srt = corpo && typeof corpo.srt === 'string' ? corpo.srt : '';
    if (!srt.trim()) return json(400, { erro: 'legenda vazia' });
    if (srt.length > LIMITE_LEGENDA) return json(413, { erro: 'legenda acima de 4 MB' });

    const srclang = (corpo.srclang || 'pt').toLowerCase().replace(/[^a-z-]/g, '') || 'pt';
    const label = corpo.label || 'Português';

    const r = await data.bunny.chamar('/videos/' + videoId + '/captions/' + srclang, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ srclang, label, captionsFile: base64Utf8(srt) })
    });
    if (!r.ok) {
      return json(502, { erro: 'Bunny recusou a legenda', status: r.status, detalhe: await r.text() });
    }
    return json(200, { ok: true, videoId, srclang });
  }

  return json(400, { erro: 'parâmetro `tipo` deve ser `capa` ou `legenda`' });
}
