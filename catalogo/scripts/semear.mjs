/* scripts/semear.mjs — Task 5.1b: levar o catálogo local para o KV, e trazer
 * de volta uma cópia de segurança.
 *
 *   $env:GTM_SITE  = "https://goiastec-mais.pages.dev"
 *   $env:GTM_SENHA = "<a senha de admin>"
 *
 *   node scripts/semear.mjs                       envia o catálogo local ao KV
 *   node scripts/semear.mjs --sobrescrever        aceita substituir um KV já populado
 *   node scripts/semear.mjs --baixar backup.json  salva o que está no KV
 *
 * A senha vem do ambiente, não da linha de comando: argumento de linha de
 * comando fica no histórico do shell.
 */
import { writeFile } from 'node:fs/promises';
import { argumentos, lerCatalogo, CATALOGO_PADRAO, erroFatal } from './lib/catalogo.mjs';

const op = argumentos();
const site = (typeof op.site === 'string' ? op.site : process.env.GTM_SITE || '').replace(/\/+$/, '');
const senha = process.env.GTM_SENHA || process.env.ADMIN_PASSWORD || '';
const caminhoCatalogo = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;

try {
  if (!site) throw new Error('defina GTM_SITE (ex.: https://goiastec-mais.pages.dev)');
  if (!senha) throw new Error('defina GTM_SENHA com a senha da área de administração');

  const entrada = await fetch(site + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ senha })
  });
  if (!entrada.ok) {
    throw new Error(`login recusado (${entrada.status}): ${(await entrada.text()).slice(0, 200)}`);
  }
  const { token } = await entrada.json();
  const auth = { Authorization: 'Bearer ' + token, accept: 'application/json' };

  const leitura = await fetch(site + '/api/catalogo?completo=1', { headers: auth });
  if (!leitura.ok) throw new Error(`leitura do KV falhou (${leitura.status})`);
  const noKv = await leitura.json();

  if (op.baixar) {
    const destino = typeof op.baixar === 'string' ? op.baixar : 'catalogo.kv.json';
    delete noKv.config;
    await writeFile(destino, JSON.stringify(noKv, null, 1) + '\n', 'utf8');
    console.log(`salvo em ${destino}: ${(noKv.itens || []).length} títulos, rev ${noKv.rev || 0}`);
    process.exit(0);
  }

  const quantosNoKv = (noKv.itens || []).length;
  if (quantosNoKv && !op.sobrescrever) {
    console.error(
      `o KV já tem ${quantosNoKv} títulos (rev ${noKv.rev}).\n` +
      'Semear de novo apagaria o que foi editado pela tela de administração.\n' +
      'Se é isso mesmo que você quer:\n' +
      '  1. node scripts/semear.mjs --baixar backup.json\n' +
      '  2. node scripts/semear.mjs --sobrescrever'
    );
    process.exit(1);
  }

  const local = await lerCatalogo(caminhoCatalogo);

  /* MERGE, não substituição.
   *
   * O arquivo local é a fonte dos metadados em lote; o KV é a fonte do estado
   * editorial — o que foi publicado, a capa escolhida pela tela, a sinopse
   * revisada. Um `--sobrescrever` ingênuo joga fora esse estado sem avisar:
   * foi assim que uma capa recém-escolhida pela tela se perdeu em 20/08/2026.
   *
   * Regra: campo que existe no KV e não existe no arquivo local é preservado,
   * e `publicar` é sempre do KV — publicar é decisão de quem opera a tela. */
  const noKvPorId = new Map((noKv.itens || []).map(i => [i.id, i]));
  let preservados = 0;

  const itens = local.itens.map(item => {
    const antigo = noKvPorId.get(item.id);
    if (!antigo) return item;

    const juntado = { ...item };
    for (const [campo, valor] of Object.entries(antigo)) {
      if (!(campo in item) && valor != null) {
        juntado[campo] = valor;
        preservados++;
      }
    }
    if (typeof antigo.publicar === 'boolean') juntado.publicar = antigo.publicar;
    return juntado;
  });

  if (preservados) {
    console.log(`preservados do KV: ${preservados} campos que não existem no arquivo local`);
  }

  const corpo = { ...local, itens, rev: noKv.rev || 0 };
  delete corpo.config;

  const escrita = await fetch(site + '/api/catalogo', {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(corpo)
  });
  const resposta = await escrita.json().catch(() => ({}));
  if (!escrita.ok) {
    throw new Error(`gravação recusada (${escrita.status}): ${resposta.erro || ''}`);
  }

  console.log(`✔ ${resposta.total} títulos no KV (rev ${resposta.rev}, ${resposta.atualizado_em})`);
  const publicados = local.itens.filter(i => i.publicar).length;
  console.log(`  ${publicados} marcados como publicados — só esses aparecem na grade.`);
} catch (e) {
  erroFatal(e);
}
