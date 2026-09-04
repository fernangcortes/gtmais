/* scripts/sincronizar-capas.mjs — lê do Bunny o nome real do arquivo de capa
 * de cada título e grava em `capa_arquivo`.
 *
 * POR QUE ISTO EXISTE: ao receber uma capa enviada por nós, o Bunny grava com um
 * hash no nome (`thumbnail_2c504259.jpg`) e MANTÉM o `thumbnail.jpg` antigo, o
 * gerado automaticamente, no mesmo lugar. Quem monta o caminho fixo continua
 * servindo a capa velha para sempre, respondendo 200 — sem nenhum sinal de erro.
 *
 * Rode isto depois de trocar capas pelo painel do Bunny, ou uma vez para acertar
 * títulos que já tinham capa antes de o campo existir. A tela de admin já grava
 * `capa_arquivo` sozinha quando a capa é escolhida por ela.
 *
 * Uso:
 *     node scripts/sincronizar-capas.mjs --simular
 *     node scripts/sincronizar-capas.mjs
 */
import { criarCliente } from './lib/bunny.mjs';
import { argumentos, lerCatalogo, gravarCatalogo, selecionar, CATALOGO_PADRAO, erroFatal } from './lib/catalogo.mjs';

const op = argumentos();
const caminhoCatalogo = typeof op.catalogo === 'string' ? op.catalogo : CATALOGO_PADRAO;

try {
  const catalogo = await lerCatalogo(caminhoCatalogo);
  const alvos = selecionar(catalogo.itens, op).filter(i => i.fonte && i.fonte.videoId);

  if (!alvos.length) {
    console.log('nenhum título com videoId. Rode scripts/upload.mjs antes.');
    process.exit(0);
  }

  const bunny = criarCliente();
  let mudou = 0, iguais = 0, erros = 0;

  for (const item of alvos) {
    let v;
    try {
      v = await bunny.consultar(item.fonte.videoId);
    } catch (e) {
      erros++;
      console.error(`  ✖ ${item.titulo}: ${e.message}`);
      continue;
    }

    const nome = v.thumbnailFileName || 'thumbnail.jpg';
    if (item.capa_arquivo === nome) {
      iguais++;
      continue;
    }

    console.log(`  ${item.capa_arquivo ? '~' : '+'} ${item.titulo}`);
    console.log(`      ${item.capa_arquivo || '(sem registro)'}  ->  ${nome}`);
    if (!op.simular) {
      item.capa_arquivo = nome;
      item.capa_versao = String(Date.now());
    }
    mudou++;
  }

  if (op.simular) {
    console.log(`\n--simular: ${mudou} títulos mudariam, ${iguais} já corretos.`);
    process.exit(0);
  }

  if (mudou) await gravarCatalogo(catalogo, caminhoCatalogo);
  console.log(`\natualizados: ${mudou}  ·  já corretos: ${iguais}  ·  erros: ${erros}`);
  /* Este aviso já mandou rodar `semear.mjs --sobrescrever`, que leva o
   * `capa_arquivo` ao KV mas reverte junto tudo que a tela de admin editou —
   * eram 18 títulos renomeados em 02/09/2026. Qual é o caminho certo depende de
   * o título já estar no KV ou não, então o aviso pergunta em vez de mandar. */
  if (mudou) {
    console.log('\npara o `capa_arquivo` chegar ao KV:');
    console.log('  · título ainda NÃO está no KV  ->  node scripts/acrescentar-ao-kv.mjs');
    console.log('  · título JÁ está no KV         ->  pela tela de admin, ou semear.mjs');
    console.log('    --sobrescrever, que REVERTE título/série editados pela tela: leia o aviso');
    console.log('    que ele imprime antes de gravar.');
  }
} catch (e) {
  erroFatal(e);
}
