<!--
  Item de comentário (Goiás Tec +).
  Referência: packages/frontend/src/components/Comments/CommentItem.vue
-->
<template>
  <div class="comment-item">
    <div class="comment-item__head">
      <div class="comment-item__user">
        <JIcon class="i-mdi:account-circle uno-text-xl" />
        <span class="comment-item__name">{{ comment.UserName }}</span>
      </div>
      <div class="comment-item__badges">
        <VChip
          v-if="comment.CategoryName"
          size="x-small"
          :color="comment.CategoryColor || undefined"
          variant="tonal">
          {{ comment.CategoryName }}
        </VChip>
        <VChip
          v-if="comment.IsPrivate"
          size="x-small"
          color="warning"
          variant="tonal">
          privado
        </VChip>
        <VBtn
          v-if="comment.TimestampTicks > 0"
          size="x-small"
          variant="text"
          @click="$emit('seek', comment.TimestampTicks)">
          <JIcon class="i-mdi:clock-outline" />
          {{ formatTime(comment.TimestampTicks / 10000) }}
        </VBtn>
      </div>
    </div>

    <div class="comment-item__body">{{ comment.Body }}</div>

    <div class="comment-item__actions">
      <!-- Fluxo de revisão: produtora muda o status -->
      <VMenu
        v-if="isProducer"
        location="bottom">
        <template #activator="{ props }">
          <VChip
            v-bind="props"
            size="x-small"
            :color="statusColor"
            variant="flat">
            {{ statusLabel }}
          </VChip>
        </template>
        <VList density="compact">
          <VListItem
            v-for="s in statusOptions"
            :key="s.value"
            @click="changeStatus(s.value)">
            {{ s.label }}
          </VListItem>
        </VList>
      </VMenu>
      <VChip
        v-else
        size="x-small"
        :color="statusColor"
        variant="flat">
        {{ statusLabel }}
      </VChip>

      <VSpacer />

      <VBtn
        size="x-small"
        icon
        :color="comment.LikedByMe ? 'primary' : undefined"
        @click="$emit('like')">
        <JIcon class="i-mdi:thumb-up-outline" />
        <span class="comment-item__count">{{ comment.LikeCount }}</span>
      </VBtn>
      <VBtn
        size="x-small"
        icon
        @click="$emit('reply')">
        <JIcon class="i-mdi:reply-outline" />
        <span class="comment-item__count">{{ comment.ReplyCount }}</span>
      </VBtn>
      <VBtn
        v-if="comment.CanEdit"
        size="x-small"
        icon
        @click="editing = !editing">
        <JIcon class="i-mdi:pencil-outline" />
      </VBtn>
      <VBtn
        v-if="comment.CanDelete"
        size="x-small"
        icon
        @click="onDelete">
        <JIcon class="i-mdi:delete-outline" />
      </VBtn>
    </div>

    <VTextarea
      v-if="editing"
      v-model="editDraft"
      rows="2"
      density="compact"
      hide-details>
      <template #append>
        <VBtn
          size="small"
          color="primary"
          @click="saveEdit">Salvar</VBtn>
      </template>
    </VTextarea>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatTime } from '#/utils/time.ts';
import { goiasTecApi, type CommentDto, type CommentStatus } from '#/plugins/goiastec/goiastec-api.ts';

const props = defineProps<{
  comment: CommentDto;
  isProducer?: boolean;
}>();

const emit = defineEmits<{
  seek: [ticks: number];
  like: [];
  reply: [];
  updated: [comment: CommentDto];
  deleted: [comment: CommentDto];
}>();

const editing = ref(false);
const editDraft = ref(props.comment.Body);

const statusOptions = [
  { value: 'open' as CommentStatus, label: 'Aberto' },
  { value: 'in_review' as CommentStatus, label: 'Em revisão' },
  { value: 'resolved' as CommentStatus, label: 'Resolvido' }
];

const statusLabel = computed(() =>
  statusOptions.find(s => s.value === props.comment.Status)?.label ?? 'Aberto'
);

const statusColor = computed(() => {
  switch (props.comment.Status) {
    case 'resolved': return 'success';
    case 'in_review': return 'warning';
    default: return 'secondary';
  }
});

async function changeStatus(status: CommentStatus): Promise<void> {
  const updated = await goiasTecApi.setCommentStatus(props.comment.Id, status);
  emit('updated', updated);
}

async function saveEdit(): Promise<void> {
  const updated = await goiasTecApi.updateComment(props.comment.Id, { Body: editDraft.value });
  editing.value = false;
  emit('updated', updated);
}

async function onDelete(): Promise<void> {
  emit('deleted', props.comment);
}
</script>

<style scoped>
.comment-item {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.comment-item__head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.comment-item__user { display: flex; align-items: center; gap: 6px; }
.comment-item__name { font-weight: 500; font-size: 0.85rem; }
.comment-item__badges { display: flex; align-items: center; gap: 4px; }
.comment-item__body { font-size: 0.9rem; white-space: pre-wrap; word-break: break-word; }
.comment-item__actions { display: flex; align-items: center; gap: 4px; }
.comment-item__count { font-size: 0.7rem; margin-left: 2px; }
</style>
