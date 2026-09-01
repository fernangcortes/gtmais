<!--
  Overlay de comentários no player (Goiás Tec +).
  Referência: packages/frontend/src/components/Comments/CommentsPanel.vue

  Uso (em packages/frontend/src/pages/playback/video.vue):
    <CommentsPanel v-if="commentsEnabled" />

  Depende de:
    - playbackManager.currentTime (ms) e currentItem
    - msToTicks / formatTime de '#/utils/time.ts'
    - store goias-tec-comments + goiasTecApi
-->
<template>
  <aside
    v-if="commentsEnabled && itemId"
    class="comments-panel">
    <div class="comments-panel__header">
      <div>
        <div class="comments-panel__title">Comentários</div>
        <div class="comments-panel__subtitle">
          {{ pendingCount }} pendente(s) · {{ comments.length }} total
        </div>
      </div>
      <VBtn
        icon
        size="small"
        @click="toggleComments()">
        <JIcon class="i-mdi:close" />
      </VBtn>
    </div>

    <!-- Filtros -->
    <div class="comments-panel__filters">
      <VSelect
        v-model="commentFilter.categoryId"
        :items="categoryOptions"
        label="Categoria"
        density="compact"
        hide-details
        @update:model-value="reload()" />
      <VBtn
        variant="tonal"
        density="comfortable"
        :color="commentFilter.includeResolved ? '' : 'primary'"
        @click="commentFilter.includeResolved = !commentFilter.includeResolved; reload()">
        {{ commentFilter.includeResolved ? 'Ocultar resolvidos' : 'Mostrar resolvidos' }}
      </VBtn>
    </div>

    <!-- Lista -->
    <div class="comments-panel__list">
      <CommentItem
        v-for="comment in visibleComments"
        :key="comment.Id"
        :comment="comment"
        @seek="seekTo"
        @like="onLike(comment)"
        @updated="onUpdated"
        @deleted="onDeleted"
        @reply="startReply" />
      <div
        v-if="visibleComments.length === 0"
        class="comments-panel__empty">
        Nenhum comentário aqui ainda.
      </div>
    </div>

    <!-- Composer -->
    <div class="comments-panel__composer">
      <div class="comments-panel__anchor">
        <VBtn
          size="small"
          variant="tonal"
          @click="anchorAtCurrentTime()">
          <JIcon class="i-mdi:pin" /> Ancorar em {{ formatTime(anchorTicks) }}
        </VBtn>
      </div>
      <VTextarea
        v-model="draft"
        rows="2"
        :placeholder="replyingTo ? `Respondendo a ${replyingTo.UserName}...` : 'Comentar neste momento...'"
        density="compact"
        hide-details />
      <div class="comments-panel__composer-row">
        <VSelect
          v-model="draftCategoryId"
          :items="categoryOptions"
          label="Categoria"
          density="compact"
          hide-details
          class="comments-panel__category" />
        <VCheckbox
          v-if="isProducer"
          :model-value="draftIsPrivate"
          label="Privado (interno)"
          density="compact"
          hide-details
          @update:model-value="draftIsPrivate = $event === true" />
        <VSpacer />
        <VBtn
          color="primary"
          :disabled="!draft"
          @click="submitComment()">
          Enviar
        </VBtn>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { playbackManager } from '#/store/playback-manager.ts';
import { formatTime, msToTicks } from '#/utils/time.ts';
import { useSnackbar } from '#/composables/use-snackbar.ts';
import {
  addComment,
  commentCategories,
  commentFilter,
  commentsEnabled,
  commentsByItem,
  loadCategories,
  loadComments,
  pendingCountByItem,
  refreshPending,
  removeComment,
  setCommentStatus,
  toggleComments,
  toggleLike
} from '#/store/goias-tec-comments.ts';
import { goiasTecApi, type CommentDto, type CommentStatus } from '#/plugins/goiastec/goiastec-api.ts';

// importar/definir: CommentItem (subcomponente de item de comentário)
const CommentItem = () => import('./CommentItem.vue');

const itemId = computed(() => playbackManager.currentItem.value?.Id ?? '');
const comments = computed(() => commentsByItem.get(itemId.value) ?? []);
const pendingCount = computed(() => pendingCountByItem.get(itemId.value) ?? 0);
const isProducer = ref(false);

const draft = ref('');
const draftCategoryId = ref<number | null>(null);
const draftIsPrivate = ref(false);
const anchorTicks = ref(0);
const replyingTo = ref<CommentDto | null>(null);

const categoryOptions = computed(() => [
  { title: 'Todas', value: null },
  ...commentCategories.value.map(c => ({ title: c.Name, value: c.Id }))
]);

const visibleComments = computed(() =>
  comments.value.filter(c => commentFilter.includeResolved || c.Status !== 'resolved')
);

onMounted(async () => {
  try {
    await Promise.all([loadCategories(), loadComments(itemId.value), refreshPending(itemId.value)]);
    isProducer.value = ['editor', 'admin', 'superadmin'].includes((await goiasTecApi.myRole()).role);
  } catch { /* servidor/plugin indisponível — a UI segue funcionando sem dados */ }
});

watch(itemId, () => { loadComments(itemId.value); refreshPending(itemId.value); });

function reload(): void {
  loadComments(itemId.value);
}

function anchorAtCurrentTime(): void {
  anchorTicks.value = msToTicks(playbackManager.currentTime.value ?? 0);
}

function seekTo(ticks: number): void {
  playbackManager.currentTime.value = ticks / 10000;
}

function startReply(comment: CommentDto): void {
  replyingTo.value = comment;
}

async function submitComment(): Promise<void> {
  if (!draft.value.trim()) return;
  try {
    await addComment({
      ItemId: itemId.value,
      TimestampTicks: replyingTo.value ? replyingTo.value.TimestampTicks : anchorTicks.value,
      CategoryId: draftCategoryId.value,
      Body: draft.value.trim(),
      ParentCommentId: replyingTo.value?.Id ?? null,
      IsPrivate: draftIsPrivate.value
    });
    draft.value = '';
    replyingTo.value = null;
    await refreshPending(itemId.value);
  } catch (e) {
    useSnackbar('Falha ao enviar comentário.', 'error');
  }
}

async function onUpdated(comment: CommentDto): Promise<void> {
  // Aplica a alteração (status/edição) no estado local sem recarregar a lista
  const list = commentsByItem.get(itemId.value) ?? [];
  const index = list.findIndex(c => c.Id === comment.Id);
  if (index >= 0) list[index] = comment;
  await refreshPending(itemId.value);
}

async function onLike(comment: CommentDto): Promise<void> {
  try {
    await toggleLike(comment);
  } catch {
    useSnackbar('Falha ao curtir comentário.', 'error');
  }
}

async function onDeleted(comment: CommentDto): Promise<void> {
  await removeComment(comment.Id, itemId.value);
}
</script>

<style scoped>
.comments-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(380px, 90vw);
  background: rgba(10, 10, 12, 0.92);
  border-left: 1px solid rgba(255, 255, 255, 0.12);
  display: flex;
  flex-direction: column;
  /* Acima do JOverlay do player (z-index 50): garante que o painel receba os
     cliques mesmo quando os controles (visíveis ou ocultos) cobrem a tela. */
  z-index: 100;
  padding: 12px;
  gap: 10px;
}
.comments-panel__header { display: flex; justify-content: space-between; align-items: center; }
.comments-panel__title { font-weight: 600; font-size: 1rem; }
.comments-panel__subtitle { opacity: 0.7; font-size: 0.8rem; }
.comments-panel__filters { display: flex; gap: 8px; align-items: center; }
.comments-panel__list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.comments-panel__empty { opacity: 0.6; text-align: center; padding: 24px 0; }
.comments-panel__composer { border-top: 1px solid rgba(255,255,255,0.12); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.comments-panel__composer-row { display: flex; gap: 8px; align-items: center; }
.comments-panel__category { min-width: 130px; }
</style>
