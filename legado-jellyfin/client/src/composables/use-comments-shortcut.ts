/**
 * Atalho configurável para ligar/desligar os comentários no player.
 * Padrão: tecla "C" (livre no Jellyfin). Usa o mesmo padrão do jellyfin-vue
 * (useMagicKeys + whenever, ver packages/frontend/src/composables/use-playback.ts).
 *
 * Referência: packages/frontend/src/composables/use-comments-shortcut.ts
 */
import { computed, type Ref } from 'vue';
import { useMagicKeys, whenever } from '@vueuse/core';
import { toggleComments } from '../stores/goias-tec-comments';

interface ShortcutSettings {
  /** Tecla configurável pelo usuário (padrão "c"). */
  commentsShortcut?: string;
}

/**
 * @param settings Ref reativo com as preferências do usuário (ex.: settings store).
 * @param active  Quando false, o atalho não interfere (ex.: campo de texto focado).
 */
export function useCommentsShortcut(
  settings: Ref<ShortcutSettings>,
  active: Ref<boolean> = computed(() => true)
): void {
  const keys = useMagicKeys();

  const shortcutKey = computed(() => {
    const key = settings.value.commentsShortcut?.trim().toLowerCase() || 'c';
    // Evita conflito com atalhos padrão do player (espaço, f, m, k, j, l, setas)
    return [' ', 'f', 'm', 'k', 'j', 'l', 'arrowleft', 'arrowright'].includes(key) ? 'c' : key;
  });

  whenever(keys[shortcutKey.value], () => {
    if (active.value) {
      toggleComments();
    }
  });
}
