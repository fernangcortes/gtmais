<!--
  Sino de notificações in-app (Goiás Tec +) — respostas e @menções.
  Referência: packages/frontend/src/components/Notifications/NotificationBell.vue

  Uso (em packages/frontend/src/components/Layout/AppBar/AppBar.vue):
    <NotificationBell />
-->
<template>
  <VMenu
    location="bottom end"
    :close-on-content-click="false">
    <template #activator="{ props }">
      <VBtn
        v-bind="props"
        icon>
        <JIcon class="i-mdi:bell-outline" />
        <span
          v-if="unread > 0"
          class="notification-bell__badge">
          {{ unread > 99 ? '99+' : unread }}
        </span>
      </VBtn>
    </template>

    <VCard
      width="340"
      max-height="420"
      class="overflow-y-auto">
      <VCardTitle class="d-flex align-center">
        Notificações
        <VSpacer />
        <VBtn
          v-if="unread > 0"
          size="small"
          variant="text"
          @click="markAllRead">
          Marcar lidas
        </VBtn>
      </VCardTitle>
      <VList density="compact">
        <VListItem
          v-for="n in items"
          :key="n.Id"
          :to="`/item/${n.ItemId}`"
          @click="markRead(n.Id)">
          <VListItemTitle>
            {{ n.Type === 'mention' ? '@menção' : 'Resposta' }} no comentário
          </VListItemTitle>
          <VListItemSubtitle>
            {{ timeAgo(n.CreatedAtUtc) }}
          </VListItemSubtitle>
          <template #append>
            <JIcon
              v-if="!n.Read"
              class="i-mdi:circle notification-bell__dot"
              color="primary" />
          </template>
        </VListItem>
        <VListItem v-if="items.length === 0">
          <VListItemTitle class="text-center opacity-60">
            Nenhuma notificação.
          </VListItemTitle>
        </VListItem>
      </VList>
    </VCard>
  </VMenu>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { formatDistanceToNow } from 'date-fns';
import { goiasTecApi, type NotificationDto } from '#/plugins/goiastec/goiastec-api.ts';

const items = ref<NotificationDto[]>([]);
const unread = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  refresh();
  timer = setInterval(refresh, 60000); // 1 min
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

async function refresh(): Promise<void> {
  try {
    const [list, count] = await Promise.all([
      goiasTecApi.listNotifications(false, 30),
      goiasTecApi.unreadCount()
    ]);
    items.value = list;
    unread.value = count;
  } catch { /* servidor indisponível */ }
}

async function markRead(id: number): Promise<void> {
  await goiasTecApi.markRead(id);
  await refresh();
}

async function markAllRead(): Promise<void> {
  await goiasTecApi.markRead();
  await refresh();
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}
</script>

<style scoped>
.notification-bell__badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  background: #e53935;
  color: #fff;
  font-size: 0.65rem;
  line-height: 16px;
  text-align: center;
  padding: 0 4px;
}
.notification-bell__dot {
  font-size: 0.7rem;
}
</style>
