<!--
  Seção de comentários na página de detalhes do item (Goiás Tec +).
  Referência: packages/frontend/src/components/Comments/CommentsSection.vue

  Uso (na página do item):
    <CommentsSection :item-id="item.Id" :item-name="item.Name" />
-->
<template>
  <section class="comments-section">
    <div class="comments-section__header">
      <div>
        <div class="comments-section__title">Comentários</div>
        <div class="comments-section__subtitle">
          {{ pendingCount }} pendente(s) · {{ totalCount }} comentário(s)
        </div>
      </div>
      <div class="comments-section__filters">
        <VSelect
          v-model="commentFilter.categoryId"
          :items="categoryOptions"
          label="Categoria"
          density="compact"
          hide-details
          class="comments-section__category"
          @update:model-value="reload()" />
        <VCheckbox
          :model-value="commentFilter.includeResolved"
          label="Mostrar resolvidos"
          density="compact"
          hide-details
          @update:model-value="commentFilter.includeResolved = $event === true; reload()" />
      </div>
    </div>

    <div class="comments-section__list">
      <CommentItem
        v-for="comment in visibleComments"
        :key="comment.Id"
        :comment="comment"
        :is-producer="isProducer"
        @like="onLike(comment)"
        @reply="startReply(comment)"
        @updated="reload"
        @deleted="onDeleted" />
      <div
        v-if="visibleComments.length === 0"
        class="comments-section__empty">
        Nenhum comentário ainda. Seja o primeiro!
      </div>
    </div>

    <div class="comments-section__composer">
      <VTextarea
        v-model="draft"
        rows="2"
        :placeholder="replyingTo ? `Respondendo a ${replyingTo.UserName}...` : 'Comentar este vídeo...'"
        density="compact"
        hide-details />
      <div class="comments-section__composer-row">
        <VSelect
          v-model="draftCategoryId"
          :items="categoryOptions"
          label="Categoria"
          density="compact"
          hide-details
          class="comments-section__category" />
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
          @click="submit">
          Comentar
        </VBtn>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useSnackbar } from '#/composables/use-snackbar.ts';
import {
  addComment,
  commentCategories,
  commentFilter,
  commentsByItem,
  loadCategories,
  loadComments,
  pendingCountByItem,
  refreshPending,
  removeComment,
  toggleLike
} from '#/store/goias-tec-comments.ts';
import { goiasTecApi, type CommentDto } from '#/plugins/goiastec/goiastec-api.ts';

const CommentItem = () => import('./CommentItem.vue');

const props = defineProps<{
  itemId: string;
}>();

const comments = computed(() => commentsByItem.get(props.itemId) ?? []);
const pendingCount = computed(() => pendingCountByItem.get(props.itemId) ?? 0);
const totalCount = computed(() => comments.value.length);
const visibleComments = computed(() =>
  comments.value.filter(c => commentFilter.includeResolved || c.Status !== 'resolved')
);

const draft = ref('');
const draftCategoryId = ref<number | null>(null);
const draftIsPrivate = ref(false);
const isProducer = ref(false);
const replyingTo = ref<CommentDto | null>(null);

const categoryOptions = computed(() => [
  { title: 'Todas', value: null },
  ...commentCategories.value.map(c => ({ title: c.Name, value: c.Id }))
]);

onMounted(async () => {
  try {
    await Promise.all([
      loadCategories(),
      loadComments(props.itemId),
      refreshPending(props.itemId)
    ]);
    isProducer.value = ['editor', 'admin', 'superadmin'].includes((await goiasTecApi.myRole()).role);
  } catch { /* servidor/plugin indisponível — a UI segue funcionando sem dados */ }
});

function reload(): void {
  loadComments(props.itemId);
}

async function onDeleted(): Promise<void> {
  await Promise.all([reload(), refreshPending(props.itemId)]);
}

function startReply(comment: CommentDto): void {
  replyingTo.value = comment;
}

async function onLike(comment: CommentDto): Promise<void> {
  try {
    await toggleLike(comment);
  } catch {
    useSnackbar('Falha ao curtir comentário.', 'error');
  }
}

async function submit(): Promise<void> {
  if (!draft.value.trim()) return;
  try {
    await addComment({
      ItemId: props.itemId,
      TimestampTicks: replyingTo.value?.TimestampTicks ?? 0,
      CategoryId: draftCategoryId.value,
      Body: draft.value.trim(),
      ParentCommentId: replyingTo.value?.Id ?? null,
      IsPrivate: draftIsPrivate.value
    });
    draft.value = '';
    replyingTo.value = null;
    await refreshPending(props.itemId);
  } catch {
    useSnackbar('Falha ao comentar.', 'error');
  }
}
</script>

<style scoped>
.comments-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 0;
  margin-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}
.comments-section__header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
.comments-section__title { font-weight: 600; font-size: 1.05rem; }
.comments-section__subtitle { opacity: 0.7; font-size: 0.85rem; }
.comments-section__filters { display: flex; align-items: center; gap: 12px; }
.comments-section__category { min-width: 140px; }
.comments-section__list { display: flex; flex-direction: column; gap: 10px; }
.comments-section__empty { opacity: 0.6; text-align: center; padding: 24px 0; }
.comments-section__composer { border-top: 1px solid rgba(255, 255, 255, 0.12); padding-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.comments-section__composer-row { display: flex; gap: 8px; align-items: center; }
</style>
