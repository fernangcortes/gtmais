/* POST /api/login  { senha }  ->  { token, expira }
 *
 * Senha única compartilhada (Task 4B.1). Não é login por pessoa: é uma porta
 * trancada para uma equipe pequena. O navegador guarda o token, não a senha.
 */
import { json, emitirToken, iguaisEmTempoConstante } from './_middleware.js';

export async function onRequestPost({ request, env }) {
  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return json(400, { erro: 'corpo inválido: esperado JSON' });
  }

  const senha = corpo && corpo.senha;
  if (typeof senha !== 'string' || !senha) {
    return json(400, { erro: 'informe a senha' });
  }

  if (!iguaisEmTempoConstante(senha, env.ADMIN_PASSWORD)) {
    /* Atraso proposital: encarece a tentativa de adivinhar a senha em série.
     * A proteção de verdade é o Cloudflare Access na frente do site (Task 5.2). */
    await new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 300)));
    return json(401, { erro: 'senha incorreta' });
  }

  return json(200, await emitirToken(env.ADMIN_PASSWORD));
}
