/* POST /api/upload-token   { titulo }            -> cria o vídeo e assina
 * POST /api/upload-token   { videoId }           -> só reassina (retomada)
 *
 * O arquivo de vídeo NÃO passa por aqui. Esta função só devolve uma assinatura
 * de uso único; o navegador envia os bytes direto para o Bunny via TUS. É o que
 * torna viável subir um arquivo de 3,9 GB sem esbarrar no limite de tamanho de
 * requisição das serverless.
 *
 * A criação do vídeo precisa acontecer aqui, e não no navegador: só o endpoint
 * TUS tem CORS documentado para uso client-side.
 */
import { json } from './_middleware.js';

const VALIDADE_S = 3600;   /* UNIX em SEGUNDOS. Milissegundos invalidam a assinatura. */

export async function onRequestPost({ request, data }) {
  const bunny = data.bunny;
  if (!bunny.configurado) {
    return json(500, { erro: 'BUNNY_LIBRARY_ID e/ou BUNNY_API_KEY ausentes no ambiente' });
  }

  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return json(400, { erro: 'corpo inválido: esperado JSON' });
  }

  let videoId = corpo && corpo.videoId ? String(corpo.videoId) : '';

  if (!videoId) {
    const titulo = corpo && typeof corpo.titulo === 'string' ? corpo.titulo.trim() : '';
    if (!titulo) return json(400, { erro: 'informe `titulo` (novo vídeo) ou `videoId` (retomada)' });

    const criacao = await bunny.chamar('/videos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: titulo })
    });

    if (!criacao.ok) {
      const detalhe = await criacao.text();
      return json(502, { erro: 'Bunny recusou a criação do vídeo', status: criacao.status, detalhe });
    }

    const criado = await criacao.json();
    videoId = criado.guid;
    if (!videoId) return json(502, { erro: 'Bunny não devolveu o guid do vídeo' });
  }

  const expira = Math.floor(Date.now() / 1000) + VALIDADE_S;
  const assinatura = await bunny.assinarUpload(videoId, expira);

  return json(200, {
    libraryId: bunny.libraryId,
    videoId,
    signature: assinatura,
    expire: expira
  });
}
