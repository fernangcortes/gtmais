/* scripts/lib/legenda.mjs — leitura das legendas WebVTT servidas pela pull zone.
 *
 * Existe para uma coisa só: transformar o `.vtt` do Bunny em blocos de texto
 * com tempo, que é o material bruto de onde saem os capítulos.
 *
 * ARMADILHA 1 — o arquivo do Bunny começa com BOM. Os bytes são
 * `EF BB BF 57 45 42 56 54 54` (conferido em 31/08/2026 no vídeo de 27 min):
 * `U+FEFF` e só depois `WEBVTT`. Um `texto.startsWith('WEBVTT')` devolve
 * `false` e o parser morre na primeira linha. Por isso `analisarVtt` corta o
 * BOM antes de qualquer outra coisa.
 *
 * ARMADILHA 2 — o caminho é `captions/pt.vtt`, e só ele: `pt-br.vtt` e
 * `por.vtt` respondem 404. E ele vem com `content-type:
 * application/octet-stream`, não `text/vtt` — dá para `fetch()` e parsear,
 * mas um `<track>` do navegador pode recusar.
 *
 * ARMADILHA 3 — a legenda é ASR cru. As falas vêm quebradas no meio
 * ("Vai" / "logo! Vai logo!") e a pontuação não é confiável. Nada aqui tenta
 * adivinhar assunto: quem corta os capítulos é gente lendo `condensar()`.
 *
 * Sem top-level await de propósito: assim `require()` do teste em CommonJS
 * consegue carregar este módulo ESM (Node 22.12+).
 */

/* '00:01:02.930' -> 62.93   ·  '01:02.930' também vale (VTT permite sem hora) */
export function paraSegundos(carimbo) {
  const m = String(carimbo).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const s = Number(m[3]);
  const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  return h * 3600 + min * 60 + s + ms / 1000;
}

/* 62.93 -> '1:02'  ·  3723 -> '1:02:03'  — mesmo formato do resto do site. */
export function paraCarimbo(segundos) {
  const t = Math.max(0, Math.floor(Number(segundos) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const dois = (n) => (n < 10 ? '0' + n : String(n));
  return h > 0 ? h + ':' + dois(m) + ':' + dois(s) : m + ':' + dois(s);
}

const BOM = '\uFEFF';

/* Devolve [{ inicio, fim, texto }] em segundos. Cue sem `-->` legível é
 * ignorada em silêncio: uma linha torta no meio de 385 não pode derrubar a
 * leitura do arquivo inteiro. */
export function analisarVtt(bruto) {
  let texto = String(bruto == null ? '' : bruto);
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
  texto = texto.replace(/\r\n?/g, '\n');

  const cues = [];
  for (const bloco of texto.split(/\n{2,}/)) {
    const linhas = bloco.split('\n').filter((l) => l.trim() !== '');
    if (!linhas.length) continue;
    if (/^WEBVTT/.test(linhas[0]) || /^(NOTE|STYLE|REGION)\b/.test(linhas[0])) continue;

    const iTempo = linhas.findIndex((l) => l.indexOf('-->') >= 0);
    if (iTempo < 0) continue;

    const [de, para] = linhas[iTempo].split('-->');
    const inicio = paraSegundos((de || '').trim());
    /* o lado direito pode trazer ajustes de posição depois do tempo */
    const fim = paraSegundos((para || '').trim().split(/\s+/)[0]);
    if (inicio == null || fim == null) continue;

    const corpo = linhas
      .slice(iTempo + 1)
      .join(' ')
      .replace(/<[^>]*>/g, '')     /* <v Fulano>, <i>, <00:00:01.000> */
      .replace(/\s+/g, ' ')
      .trim();
    if (!corpo) continue;

    cues.push({ inicio, fim, texto: corpo });
  }
  return cues.sort((a, b) => a.inicio - b.inicio);
}

/* ARMADILHA 4, achada em 31/08/2026 e que NÃO estava no plano: metade das
 * legendas é ROLANTE. O AssemblyAI devolveu dois formatos diferentes conforme
 * o vídeo, e nas legendas rolantes cada cue repete o fim da anterior:
 *
 *     cue 12  "Esse aí sou eu e dá para notar que eu me"
 *     cue 13  "Esse aí sou eu e dá para notar que eu me envolvi numa aventura"
 *     cue 14  "envolvi numa aventura das grandes. Mas como vim parar"
 *
 * Concatenar isso na marra triplica o texto e o transcrito fica ilegível — foi
 * exatamente o que aconteceu na primeira leitura do Paraquedismo (836 cues) e
 * do Bombeiro (856 cues). Dá para reconhecê-las pela contagem de cues: as
 * normais têm ~8 cues por minuto, as rolantes têm ~40.
 *
 * Junta dois trechos descontando a maior sobreposição entre o fim de um e o
 * começo do outro. Compara por palavra, não por caractere: por caractere,
 * qualquer 'a' final casaria com um 'a' inicial e comeria texto bom. */
export function juntarSemRepetir(acumulado, novo) {
  const a = String(acumulado || '').trim();
  const b = String(novo || '').trim();
  if (!a) return b;
  if (!b) return a;

  const pa = a.split(' ');
  const pb = b.split(' ');
  const chave = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

  /* Da maior para a menor: a sobreposição correta é sempre a mais longa.
   * O teto de 60 palavras é folga sobre a maior janela rolante observada. */
  const teto = Math.min(60, pa.length, pb.length);
  for (let k = teto; k > 0; k--) {
    let bate = true;
    for (let i = 0; i < k; i++) {
      if (chave(pa[pa.length - k + i]) !== chave(pb[i])) { bate = false; break; }
    }
    if (bate) return pb.length === k ? a : a + ' ' + pb.slice(k).join(' ');
  }
  return a + ' ' + b;
}

/* Junta cues vizinhas em blocos de ~`janela` segundos.
 *
 * É isto que torna a legenda legível: centenas de cues de duas palavras viram
 * algumas dezenas de blocos de frase inteira, cada um com o tempo em que
 * começa. Sem isto não dá para enxergar onde o assunto muda. Não corta
 * capítulo nenhum — só agrupa. */
export function condensar(cues, janela = 30) {
  const blocos = [];
  let atual = null;
  for (const cue of cues || []) {
    if (!atual || cue.inicio - atual.inicio >= janela) {
      atual = { inicio: cue.inicio, fim: cue.fim, texto: cue.texto };
      blocos.push(atual);
    } else {
      atual.fim = Math.max(atual.fim, cue.fim);
      atual.texto = juntarSemRepetir(atual.texto, cue.texto);
    }
  }
  return blocos;
}

export async function baixarLegenda(pullzone, videoId, referer) {
  const host = String(pullzone).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const url = `https://${host}/${videoId}/captions/pt.vtt`;
  /* A pull zone é protegida por Allowed Referrers: sem este cabeçalho ela
   * responde 403. Não é opcional. */
  const r = await fetch(url, referer ? { headers: { Referer: referer } } : undefined);
  if (r.status === 404) return null;          /* título sem legenda — é caso previsto */
  if (!r.ok) throw new Error(`legenda ${r.status} em ${url}`);
  return analisarVtt(await r.text());
}

export { BOM };
