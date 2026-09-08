/* scripts/espelho-publico.mjs — publica o CÓDIGO no repositório aberto.
 *
 *   node scripts/espelho-publico.mjs                       mostra o que iria, não envia
 *   node scripts/espelho-publico.mjs --publicar --mensagem "..."   envia mesmo
 *   node scripts/espelho-publico.mjs --remoto publico      se o remoto tiver outro nome
 *
 * POR QUE ISTO EXISTE, e por que não é um `git push`.
 *
 * São DOIS repositórios com propósitos diferentes, e eles não têm um commit em
 * comum. O privado (`gtmais-intra`) guarda o trabalho inteiro: o acervo, o
 * `inventario/`, a apresentação e os diários de bordo. O aberto (`gtmais`)
 * guarda só o CÓDIGO — a linha entre os dois foi desenhada em 01/09, e está
 * escrita no `.gitignore` de lá.
 *
 * Um `git push` do seu branch para o aberto NÃO dá erro: ele cria um branch
 * paralelo e publica os 56 arquivos internos de uma vez. Publicado é
 * publicado, e não há volta. Por isso publicar ali é montar um SNAPSHOT
 * curado e commitá-lo em cima do topo público — seis passos, um deles é
 * "copiar só os arquivos certos", e é exatamente o tipo de tarefa que não se
 * faz de memória duas vezes seguidas sem errar.
 *
 * COMO A CURADORIA É DECIDIDA — duas travas independentes, e elas precisam
 * CONCORDAR:
 *
 *   1. o `.gitignore` DO REPOSITÓRIO ABERTO. O snapshot é montado dentro de
 *      uma cópia dele, então é o git de lá que filtra, com as regras de lá.
 *      Acrescentar uma exclusão nova é editar aquele arquivo — a ausência
 *      fica escrita no lugar onde a próxima publicação vai olhar.
 *   2. a lista PROIBIDOS abaixo, que não depende do item 1. Se um arquivo
 *      interno passar pelo `.gitignore` — porque alguém apagou uma linha, ou
 *      porque um caminho novo não foi previsto —, esta lista barra e o script
 *      se recusa a continuar.
 *
 * Uma trava sozinha é um esquecimento a distância de acontecer. Duas exigem
 * que o esquecimento seja o mesmo nos dois lugares.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { argumentos, erroFatal } from './lib/catalogo.mjs';

/* A segunda trava. São CAMINHOS, não padrões de gitignore, e a comparação é
 * por prefixo: `inventario/` barra tudo que estiver debaixo dele. */
const PROIBIDOS = [
  'inventario/',
  'apresentacao/',
  'catalogo.seed.json',
  'catalogo.kv.json',
  'assemblyai-jobs.json',
  'backup.json',
  'catalogo/ESTADO.md',
  'catalogo/PROXIMA-SESSAO.md',
  'catalogo/PLANO-PLAYER.md',
  'docs/COMO-EXPORTAR-COOKIES.md',
  'docs/LEIA-ME_ESTRUTURA.md',
  'docs/relatorio-acervo-e-plano.md',
  '.env'
];

/* Estes NÃO são excluídos — são PRESERVADOS, que é outra coisa.
 *
 * Existem dos dois lados com conteúdo diferente: a versão de cá aponta para
 * `ESTADO.md`, `inventario/` e `apresentacao/`, que do lado de lá não existem.
 * Empurrar a versão de cá encheria o repositório aberto de links quebrados e
 * revelaria justamente o que a curadoria esconde. Então eles vêm do commit
 * público, intactos, e só mudam quando alguém os editar LÁ de propósito. */
const PRESERVADOS = ['README.md', 'catalogo/README.md', '.gitignore'];

/* `core.quotePath=false` não é enfeite: sem ele o git devolve
 * `"inventario/planilhas/Produ\303\247\303\265es..."` — com aspas e em octal —
 * para todo caminho com acento, e o relatório da curadoria fica ilegível
 * justamente nos arquivos que mais importa reconhecer. */
const git = (args, opcoes = {}) =>
  execFileSync('git', ['-c', 'core.quotePath=false', ...args], { encoding: 'utf8', ...opcoes }).trim();

const linhas = (texto) => texto.split('\n').map(l => l.trim()).filter(Boolean);

const ehProibido = (caminho) =>
  PROIBIDOS.some(p => p.endsWith('/') ? caminho.startsWith(p) : caminho === p);

/* Qual remoto é o aberto? Descoberto pela URL, e não pelo nome.
 *
 * O nome é a parte frágil: hoje o aberto se chama `origin`, que é o nome que
 * todo tutorial manda digitar; amanhã pode se chamar `publico`. A URL não
 * muda de significado. E o teste é pela NEGATIVA — `gtmais-intra` é o
 * privado —, para que um remoto novo nunca seja confundido com o aberto. */
function acharRemotoAberto(escolhido) {
  const todos = linhas(git(['remote'])).map(nome => ({
    nome, url: git(['remote', 'get-url', nome])
  }));
  if (escolhido) {
    const achado = todos.find(r => r.nome === escolhido);
    if (!achado) throw new Error(`remoto "${escolhido}" não existe. Há: ${todos.map(r => r.nome).join(', ')}`);
    return achado;
  }
  const abertos = todos.filter(r => /gtmais(\.git)?$/.test(r.url.replace(/\/$/, '')));
  if (abertos.length !== 1) {
    throw new Error(
      'não consegui decidir qual remoto é o aberto (achei ' + abertos.length + ').\n' +
      '  Diga com --remoto <nome>. Remotos: ' + todos.map(r => `${r.nome} -> ${r.url}`).join(' · ')
    );
  }
  return abertos[0];
}

const op = argumentos();
const raiz = git(['rev-parse', '--show-toplevel']);
const ramo = typeof op.ramo === 'string' ? op.ramo : 'main';
/* Curto de propósito: o worktree do git no Windows recusa caminhos longos
 * com "'$GIT_DIR' too big", e o caminho do temporário do sistema já é longo. */
const oficina = join(homedir(), '.gtmais-espelho');

/* O erro é GUARDADO em vez de encerrar o processo na hora, e isso não é
 * estilo: `erroFatal` chama `process.exit()`, e `process.exit()` mata o
 * processo ANTES do `finally` — a oficina ficava pendurada exatamente no
 * caminho em que ela mais precisa sumir, o da trava barrando. Limpa-se
 * primeiro, reclama-se depois. */
let falha = null;

try {
  const remoto = acharRemotoAberto(typeof op.remoto === 'string' ? op.remoto : null);

  /* Publica-se o que está COMMITADO, nunca a cópia de trabalho: o que vai para
   * a internet tem que ser algo que se possa apontar num commit depois. */
  const sujos = linhas(git(['status', '--porcelain', '--untracked-files=no'], { cwd: raiz }));
  if (sujos.length) {
    console.log(`⚠ ${sujos.length} arquivo(s) com mudança não commitada — o snapshot sai do HEAD e não os inclui:`);
    sujos.slice(0, 5).forEach(l => console.log('   ' + l));
  }

  console.log(`\nremoto aberto: ${remoto.nome} -> ${remoto.url}`);
  console.log(`ramo de lá:    ${ramo}`);
  console.log(`daqui:         ${git(['rev-parse', '--short', 'HEAD'], { cwd: raiz })} (${git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: raiz })})`);

  git(['fetch', remoto.nome, ramo], { cwd: raiz, stdio: 'pipe' });

  /* --- a oficina: uma cópia de trabalho parada no topo público ------------
   * O repositório de verdade não é tocado em momento nenhum. */
  if (existsSync(oficina)) { git(['worktree', 'remove', oficina, '--force'], { cwd: raiz, stdio: 'pipe' }); }
  git(['worktree', 'prune'], { cwd: raiz });
  mkdirSync(oficina, { recursive: true });
  rmSync(oficina, { recursive: true, force: true });
  git(['worktree', 'add', '--detach', oficina, `${remoto.nome}/${ramo}`], { cwd: raiz, stdio: 'pipe' });

  const naOficina = (args, o = {}) => git(args, { cwd: oficina, ...o });

  /* Apaga o conteúdo antigo e escreve o do HEAD por cima. Copia-se TUDO: quem
   * filtra é o `.gitignore` de lá, no `git add` logo abaixo. Fazer o filtro
   * aqui, à mão, seria uma terceira lista para manter em dia — e a que
   * erraria calada. */
  linhas(naOficina(['ls-files'])).forEach(f => rmSync(join(oficina, f), { force: true }));

  /* A escrita usa um ÍNDICE TEMPORÁRIO, e a razão é a trava toda.
   *
   * O caminho óbvio — `read-tree` no índice da oficina — poria os arquivos
   * internos DENTRO do índice, e aí eles seriam commitados: o `.gitignore` só
   * manda em arquivo não rastreado, e um arquivo no índice já está rastreado.
   * Com um índice descartável, os arquivos caem no disco e nenhum deles entra
   * no índice de verdade; quem os põe lá é o `git add` de baixo, que é
   * justamente onde o `.gitignore` de lá filtra.
   *
   * E é git puro: nada de `tar` nem de shell, que no PowerShell podem não
   * existir. */
  const indiceTemp = join(oficina, '.git-indice-temporario');
  git(['read-tree', 'HEAD'], { cwd: raiz, env: { ...process.env, GIT_INDEX_FILE: indiceTemp } });
  const prefixo = oficina.split(sep).join('/') + '/';
  git(['checkout-index', '-a', '-f', '--prefix=' + prefixo],
    { cwd: raiz, env: { ...process.env, GIT_INDEX_FILE: indiceTemp } });
  rmSync(indiceTemp, { force: true });

  /* Os preservados voltam do commit público, por cima do que acabou de ser
   * copiado. É esta linha que impede o README interno de virar o README
   * público. */
  naOficina(['checkout', `${remoto.nome}/${ramo}`, '--', ...PRESERVADOS]);

  naOficina(['add', '-A']);

  /* --- as duas travas, conferidas --------------------------------------- */
  const encenados = linhas(naOficina(['diff', '--cached', '--name-only', 'HEAD']))
    .concat(linhas(naOficina(['ls-files'])));
  const vazaram = [...new Set(encenados)].filter(ehProibido);
  if (vazaram.length) {
    throw new Error(
      'ARQUIVO INTERNO NO SNAPSHOT — nada foi publicado.\n\n' +
      vazaram.map(f => '   ' + f).join('\n') +
      '\n\nAs duas travas discordaram: a lista PROIBIDOS barrou o que o\n' +
      '.gitignore do repositório aberto deixou passar. Conserte o .gitignore\n' +
      'de lá (é ele quem documenta a ausência) antes de tentar de novo.'
    );
  }

  const deixadosDeFora = linhas(naOficina(['ls-files', '--others', '--ignored', '--exclude-standard']));
  const mudancas = naOficina(['diff', '--cached', '--stat', 'HEAD']);

  console.log('\n─── o que MUDA no repositório aberto ───');
  console.log(mudancas || '   (nada — o aberto já está igual ao HEAD)');
  console.log(`\n─── deixados de fora, pela curadoria: ${deixadosDeFora.length} arquivo(s) ───`);
  /* Pastas grandes viram uma linha; o resto sai com o CAMINHO INTEIRO. Quem
   * lê isto está conferindo a curadoria, e "catalogo/ (3 arquivos)" não deixa
   * conferir nada — os três precisam ser lidos pelo nome. */
  const porPasta = {};
  deixadosDeFora.forEach(f => {
    const chave = f.includes('/') ? f.slice(0, f.indexOf('/') + 1) : f;
    (porPasta[chave] = porPasta[chave] || []).push(f);
  });
  Object.entries(porPasta).sort((a, b) => b[1].length - a[1].length).forEach(([pasta, arquivos]) => {
    if (arquivos.length > 3) console.log(`   ${pasta}  (${arquivos.length} arquivos)`);
    else arquivos.forEach(f => console.log('   ' + f));
  });

  if (!mudancas) {
    console.log('\nNada a publicar.');
  } else if (!op.publicar) {
    console.log('\nEnsaio: NADA foi enviado.');
    console.log('Para publicar de verdade:');
    console.log(`   node scripts/espelho-publico.mjs --publicar --mensagem "a mensagem do commit"`);
  } else {
    /* `--mensagem` é a forma canônica. O `-m` também é aceito, e isso custa
     * três linhas: o `argumentos()` deste projeto só reconhece opções com
     * `--`, então um `-m` cai em `_` como posicional, com o texto logo atrás.
     * Aceitar as duas evita que o dedo treinado em `git commit -m` esbarre
     * numa recusa no meio de uma publicação. */
    const posicional = op._.indexOf('-m');
    const mensagem = typeof op.mensagem === 'string' ? op.mensagem
      : (posicional >= 0 ? op._[posicional + 1] : null);
    if (!mensagem) {
      throw new Error('--publicar exige a mensagem do commit:\n' +
        '   node scripts/espelho-publico.mjs --publicar --mensagem "o que esta publicação leva, e por quê"');
    }
    naOficina(['commit', '-q', '-m', mensagem]);
    const novo = naOficina(['rev-parse', '--short', 'HEAD']);
    console.log(`\nenviando ${novo} para ${remoto.nome}/${ramo}…`);
    /* `HEAD:<ramo>` e não `--force`: o commit novo é FILHO do topo público, e
     * um fast-forward nunca apaga o que já estava lá. Se isto for recusado, é
     * porque alguém publicou no meio do caminho — e aí a resposta é rodar de
     * novo, não forçar. */
    /* `stdio: inherit` para o git falar direto com quem está olhando: numa
     * publicação, ver a saída de verdade vale mais do que uma mensagem nossa
     * resumindo o que achamos que aconteceu. */
    const envio = spawnSync('git', ['push', remoto.nome, `HEAD:${ramo}`], { cwd: oficina, stdio: 'inherit' });
    if (envio.status !== 0) throw new Error('o push foi recusado — nada mudou no repositório aberto.');
    console.log(`\n✔ publicado. Confira em ${remoto.url.replace(/\.git$/, '')}`);
  }
} catch (e) {
  falha = e;
} finally {
  try { git(['worktree', 'remove', oficina, '--force'], { cwd: raiz, stdio: 'pipe' }); } catch { /* já saiu */ }
  try { git(['worktree', 'prune'], { cwd: raiz }); } catch { /* nada a podar */ }
}

if (falha) erroFatal(falha);
