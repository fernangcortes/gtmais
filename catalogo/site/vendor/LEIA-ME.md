# vendor/ — a única dependência de terceiros do projeto

Este projeto não tem build, não tem `package.json` e não tem `node_modules`. O
que estiver aqui foi baixado à mão, com versão fixa, e é servido pela própria
Pages — nunca por CDN de terceiro. O site é interno e roda em rede de escola:
um domínio a mais é um ponto de falha a mais.

## `hls.light.min.js` — hls.js 1.6.14

| | |
|---|---|
| Origem | `https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.6.14/hls.light.min.js` |
| Baixado em | 01/09/2026 |
| Tamanho | 353 199 bytes (~110 KB no fio, com gzip da Pages) |
| Expõe | `globalThis.Hls` (UMD) |
| Licença | Apache-2.0 |

**Por que a build `light` e não a completa.** A completa tem 541 KB — 188 KB a
mais — e o que ela traz a mais o acervo não usa:

- **áudio alternativo**: os HLS do Bunny têm uma faixa só;
- **legenda embutida no stream**: os playlists vêm com `CLOSED-CAPTIONS=NONE`;
  a nossa legenda é o `captions/pt.vtt` da pull zone, buscado à parte, porque a
  pull zone o serve como `application/octet-stream` e o `<track>` recusa;
- **DRM/EME**: a proteção aqui é Allowed Referrers, não chave.

Se algum dia entrar dublagem, legenda queimada no stream ou DRM, é trocar por
`hls.min.js` da mesma versão — a API é idêntica.

**O `//# sourceMappingURL` foi removido** de propósito: o `.map` não é servido, e
a linha faz o navegador pedir um arquivo que dá 404 sempre que alguém abre o
DevTools.

## Como atualizar

```bash
curl -sS -o catalogo/site/vendor/hls.light.min.js \
  https://cdnjs.cloudflare.com/ajax/libs/hls.js/<VERSAO>/hls.light.min.js
node --check catalogo/site/vendor/hls.light.min.js
```

Depois apague a última linha (`//# sourceMappingURL=…`) e atualize a tabela
acima. Há teste exigindo que a versão escrita aqui seja a que está no arquivo.
