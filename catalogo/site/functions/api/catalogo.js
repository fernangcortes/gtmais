/* GET  /api/catalogo            público interno — só o que está publicado
 * GET  /api/catalogo?completo=1 admin — o catálogo inteiro, como está no KV
 * PUT  /api/catalogo            admin — grava o catálogo inteiro
 *
 * O catálogo mora numa chave só do KV (`catalogo`). Para 50 títulos isso é
 * trivial e cabe folgado no plano gratuito.
 */
import { json } from './_middleware.js';

const CHAVE = 'catalogo';
const CHAVE_BACKUP = 'catalogo_anterior';

/* Campos que NÃO saem para o público: caminhos em F:\, links de origem no
 * Drive, nome de arquivo e o próprio `publicar`. Filtrar no servidor é o que
 * impede alguém de baixar o catálogo inteiro — inclusive o não publicado. */
function paraPublico(item) {
  return {
    id: item.id,
    titulo: item.titulo,
    serie: item.serie,
    temporada: item.temporada ?? null,
    episodio: item.episodio ?? null,
    duracao: item.duracao || '',
    duracao_seg: item.duracao_seg ?? null,
    ano: item.ano || '',
    data_publicacao_original: item.data_publicacao_original || '',
    sinopse: item.sinopse || '',
    sinopse_origem: item.sinopse_origem || '',
    tema: item.tema || '',
    publico_alvo: item.publico_alvo || '',
    tags: Array.isArray(item.tags) ? item.tags : [],
    titularidade: item.titularidade || '',
    nivel_evidencia: item.nivel_evidencia || '',
    pendencia: item.pendencia || null,
    publicar: true,
    /* Sem estes dois a grade nunca vê a capa nova: o Bunny renomeia o arquivo
     * com um hash ao receber uma capa enviada, e mantém o thumbnail.jpg antigo. */
    capa_arquivo: item.capa_arquivo || null,
    capa_versao: item.capa_versao || null,
    /* Capítulos: o player do Bunny já os traz do lado dele (segmentam a linha
     * do tempo e mostram o título no hover), mas a LISTA clicável ao lado do
     * player é desenhada aqui pela grade. Campo que não sai por `paraPublico`
     * não existe para o navegador — sem esta linha a lista some. */
    capitulos: Array.isArray(item.capitulos) ? item.capitulos : [],
    fonte: {
      tipo: (item.fonte && item.fonte.tipo) || 'bunny',
      libraryId: (item.fonte && item.fonte.libraryId) || null,
      videoId: (item.fonte && item.fonte.videoId) || null
    }
  };
}

function config(env) {
  return {
    libraryId: env.BUNNY_LIBRARY_ID ? String(env.BUNNY_LIBRARY_ID) : null,
    pullzone: env.BUNNY_PULLZONE ? String(env.BUNNY_PULLZONE) : null
  };
}

async function lerCatalogo(env) {
  if (!env.CATALOGO) return null;
  return await env.CATALOGO.get(CHAVE, 'json');
}

export async function onRequestGet({ env, request, data }) {
  if (!env.CATALOGO) {
    return json(500, { erro: 'namespace KV CATALOGO não vinculado ao projeto' });
  }

  const guardado = await lerCatalogo(env);

  if (!guardado) {
    return json(200, {
      versao: 1, rev: 0, itens: [], vazio: true, config: config(env),
      observacao: 'catálogo ainda não importado — rode scripts/semear.mjs'
    });
  }

  const completo = new URL(request.url).searchParams.get('completo') === '1';
  if (completo) {
    if (!data.admin) return json(401, { erro: 'não autorizado' });
    return json(200, Object.assign({}, guardado, { config: config(env) }));
  }

  const itens = (guardado.itens || [])
    .filter(i => i && i.publicar === true)
    .map(paraPublico);

  return json(200, {
    versao: guardado.versao || 1,
    rev: guardado.rev || 0,
    atualizado_em: guardado.atualizado_em || null,
    total: itens.length,
    config: config(env),
    itens
  });
}

export async function onRequestPut({ request, env, data }) {
  if (!data.admin) return json(401, { erro: 'não autorizado' });
  if (!env.CATALOGO) {
    return json(500, { erro: 'namespace KV CATALOGO não vinculado ao projeto' });
  }

  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return json(400, { erro: 'corpo inválido: esperado JSON' });
  }

  if (!corpo || typeof corpo !== 'object' || !Array.isArray(corpo.itens)) {
    return json(400, { erro: 'esperado um objeto com a lista `itens`' });
  }

  const ids = new Set();
  for (const item of corpo.itens) {
    if (!item || typeof item.id !== 'string' || !item.id) {
      return json(400, { erro: 'todo item precisa de um `id` string não vazio' });
    }
    if (ids.has(item.id)) {
      return json(400, { erro: 'id repetido no catálogo: ' + item.id });
    }
    ids.add(item.id);
  }

  const atual = await lerCatalogo(env);
  const revAtual = (atual && atual.rev) || 0;

  /* Concorrência otimista: a tela lê o catálogo inteiro, edita e devolve.
   * Sem esta checagem, dois admins abertos ao mesmo tempo se sobrescrevem. */
  if (atual && corpo.rev !== revAtual) {
    return json(409, {
      erro: 'o catálogo mudou desde que esta tela o carregou',
      rev_servidor: revAtual,
      rev_enviada: corpo.rev ?? null
    });
  }

  const novo = Object.assign({}, corpo, {
    versao: corpo.versao || 1,
    rev: revAtual + 1,
    total: corpo.itens.length,
    atualizado_em: new Date().toISOString()
  });
  delete novo.config;   /* config vem do ambiente, não é dado do catálogo */

  /* Uma cópia do estado anterior: recuperar de um PUT errado sem backup
   * custaria os 50 títulos de metadados. */
  if (atual) {
    await env.CATALOGO.put(CHAVE_BACKUP, JSON.stringify(atual));
  }
  await env.CATALOGO.put(CHAVE, JSON.stringify(novo));

  return json(200, { ok: true, rev: novo.rev, total: novo.total, atualizado_em: novo.atualizado_em });
}
