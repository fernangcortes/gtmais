/**
 * Estado reativo dos comentários do Goiás Tec +.
 * Referência: packages/frontend/src/stores/goias-tec-comments.ts (fork jellyfin-vue).
 *
 * Nota: o jellyfin-vue usa um padrão próprio de store (CommonStore). Este módulo
 * usa Vue refs/reactive diretamente para ser simples; pode ser convertido para
 * CommonStore sem mudar a lógica.
 */
import { reactive, ref } from 'vue';
import {
  goiasTecApi,
  type CategoryDto,
  type CommentDto,
  type CommentStatus,
  type CreateCommentPayload
} from '../plugins/goiastec/goiastec-api';

/* ------------------------------------------------------------------ */

/** Categorias de comentário (editáveis por admin+). */
export const commentCategories = ref<CategoryDto[]>([]);

/** Comentários carregados por item. */
export const commentsByItem = reactive(new Map<string, CommentDto[]>());

/** Contador de pendências (comentários não resolvidos) por item. */
export const pendingCountByItem = reactive(new Map<string, number>());

/** Liga/desliga o overlay de comentários no player (atalho configurável, padrão C). */
export const commentsEnabled = ref(true);

/** Ordem/filtros atuais do painel. */
export const commentFilter = reactive({
  categoryId: null as number | null,
  includeResolved: true,
  sortBy: 'time',
  onlyMine: false
});

/* ------------------------------------------------------------------ */

export async function loadCategories(): Promise<void> {
  commentCategories.value = await goiasTecApi.listCategories();
}

export async function loadComments(itemId: string): Promise<CommentDto[]> {
  const list = await goiasTecApi.listComments(itemId, {
    categoryId: commentFilter.categoryId ?? undefined,
    includeResolved: commentFilter.includeResolved,
    sortBy: commentFilter.sortBy,
    onlyMine: commentFilter.onlyMine
  });
  commentsByItem.set(itemId, list);
  return list;
}

export async function addComment(payload: CreateCommentPayload): Promise<CommentDto> {
  const created = await goiasTecApi.createComment(payload);
  const current = commentsByItem.get(payload.ItemId) ?? [];
  if (payload.ParentCommentId) {
    // incrementa contagem de respostas do pai
    const parent = current.find(c => c.Id === payload.ParentCommentId);
    if (parent) parent.ReplyCount += 1;
  } else {
    current.push(created);
  }
  await refreshPending(payload.ItemId);
  return created;
}

export async function updateComment(id: number, itemId: string, payload: {
  Body?: string; CategoryId?: number; IsPrivate?: boolean
}): Promise<void> {
  const updated = await goiasTecApi.updateComment(id, payload);
  replaceInItem(itemId, updated);
}

export async function removeComment(id: number, itemId: string): Promise<void> {
  await goiasTecApi.deleteComment(id);
  const current = commentsByItem.get(itemId) ?? [];
  commentsByItem.set(itemId, current.filter(c => c.Id !== id));
  await refreshPending(itemId);
}

/** Fluxo de revisão: produtora (editor+) muda o status. */
export async function setCommentStatus(id: number, itemId: string, status: CommentStatus): Promise<void> {
  const updated = await goiasTecApi.setCommentStatus(id, status);
  replaceInItem(itemId, updated);
  await refreshPending(itemId);
}

export async function toggleLike(comment: CommentDto): Promise<void> {
  if (comment.LikedByMe) {
    await goiasTecApi.unlikeComment(comment.Id);
    comment.LikedByMe = false;
    comment.LikeCount = Math.max(0, comment.LikeCount - 1);
  } else {
    await goiasTecApi.likeComment(comment.Id);
    comment.LikedByMe = true;
    comment.LikeCount += 1;
  }
}

export async function refreshPending(itemId: string): Promise<void> {
  pendingCountByItem.set(itemId, await goiasTecApi.pendingCount(itemId));
}

export function toggleComments(): void {
  commentsEnabled.value = !commentsEnabled.value;
}

function replaceInItem(itemId: string, updated: CommentDto): void {
  const current = commentsByItem.get(itemId) ?? [];
  const index = current.findIndex(c => c.Id === updated.Id);
  if (index >= 0) {
    current[index] = updated;
  } else {
    current.push(updated);
  }
}
