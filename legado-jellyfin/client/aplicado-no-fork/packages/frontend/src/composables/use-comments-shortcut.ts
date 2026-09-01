/**
 * Atalho configurável para ligar/desligar os comentários no player (Goiás Tec +).
 * Padrão: tecla "C" (livre no Jellyfin).
 *
 * A tecla é configurável via localStorage (chave "goiastec:commentsShortcut");
 * uma futura tela de configurações pode chamar setCommentsShortcut().
 *
 * Usa onKeyStroke com um predicado para que o atalho NÃO dispare enquanto o
 * usuário digita em campos de texto (ex.: o textarea de comentário).
 */
import { computed } from 'vue';
import { onKeyStroke } from '@vueuse/core';
import { toggleComments } from '../store/goias-tec-comments';

const STORAGE_KEY = 'goiastec:commentsShortcut';

/** Teclas já usadas pelo player (evita conflito). */
const RESERVED_KEYS = [' ', 'f', 'm', 'k', 'j', 'l', 'arrowleft', 'arrowright'];

function currentShortcut(): string {
  const key = localStorage.getItem(STORAGE_KEY)?.trim().toLowerCase() || 'c';
  return RESERVED_KEYS.includes(key) ? 'c' : key;
}

/** True se o evento veio de um campo onde o usuário está digitando. */
function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  return target.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Registra o atalho. Deve ser chamado dentro do ciclo de vida da página de playback
 * (o onKeyStroke limpa os listeners quando o escopo é destruído).
 */
export function useCommentsShortcut(active = true): void {
  const shortcutKey = computed(() => currentShortcut());

  onKeyStroke(
    (event) => {
      // Ignora enquanto o usuário digita em um campo de texto
      if (isTyping(event)) return false;
      return (event.key || '').toLowerCase() === shortcutKey.value;
    },
    () => {
      if (active) {
        toggleComments();
      }
    }
  );
}

/** Altera a tecla do atalho (persiste no navegador). */
export function setCommentsShortcut(key: string): void {
  const normalized = key.trim().toLowerCase();
  localStorage.setItem(STORAGE_KEY, normalized && !RESERVED_KEYS.includes(normalized) ? normalized : 'c');
}
