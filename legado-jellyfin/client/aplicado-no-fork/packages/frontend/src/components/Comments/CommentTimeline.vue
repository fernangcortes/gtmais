<!--
  Marcadores de comentários na timeline do player (Goiás Tec +).
  Referência: packages/frontend/src/components/Comments/CommentTimeline.vue

  Uso (em packages/frontend/src/components/Layout/TimeSlider.vue):
    <CommentTimeline
      :item-id="currentItemId"
      :runtime-ms="runtime" />
-->
<template>
  <div
    v-if="markers.length"
    class="comment-timeline">
    <button
      v-for="m in markers"
      :key="m.ticks"
      class="comment-timeline__marker"
      :style="{
        left: `${Math.min(100, Math.max(0, (m.ticks / totalTicks) * 100))}%`,
        background: m.color || '#5dd000'
      }"
      :title="`${m.count} comentário(s) · ${m.categoryName ?? 'sem categoria'}`"
      @click="$emit('seek', m.ticks)" />
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { commentCategories, commentsByItem, loadComments } from '#/store/goias-tec-comments.ts';

const props = defineProps<{
  itemId: string;
  runtimeMs: number;
}>();

const emit = defineEmits<{
  seek: [ticks: number];
}>();

const totalTicks = computed(() => props.runtimeMs * 10000);

/** Agrupa comentários em buckets (ex.: 1 por segundo de vídeo) para não poluir a barra. */
const markers = computed(() => {
  const comments = commentsByItem.get(props.itemId) ?? [];
  const byTicks = new Map<number, { ticks: number; count: number; categoryName?: string | null; color?: string | null }>();
  for (const c of comments) {
    if (c.TimestampTicks <= 0) continue;
    const bucket = Math.floor(c.TimestampTicks / 10000); // segundo
    const entry = byTicks.get(bucket);
    if (entry) {
      entry.count += 1;
    } else {
      const cat = commentCategories.value.find(x => x.Id === c.CategoryId);
      byTicks.set(bucket, {
        ticks: c.TimestampTicks,
        count: 1,
        categoryName: cat?.Name,
        color: cat?.Color
      });
    }
  }
  return [...byTicks.values()].sort((a, b) => a.ticks - b.ticks);
});

watch(
  () => props.itemId,
  () => { if (props.itemId) loadComments(props.itemId); },
  { immediate: true }
);
</script>

<style scoped>
.comment-timeline {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 100%;
  pointer-events: none;
}
.comment-timeline__marker {
  position: absolute;
  top: 0;
  width: 3px;
  height: 100%;
  border-radius: 2px;
  opacity: 0.85;
  pointer-events: auto;
  cursor: pointer;
}
.comment-timeline__marker:hover {
  opacity: 1;
  transform: scaleX(1.6);
}
</style>
