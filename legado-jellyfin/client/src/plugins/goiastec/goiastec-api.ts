/**
 * Cliente tipado da API do plugin Goiás Tec + (/GoiasTec).
 * Usa o axios do SDK do jellyfin-vue (remote.sdk.api.axiosInstance),
 * então herda autenticação e basePath automaticamente.
 *
 * Referência: usar dentro do fork do jellyfin-vue em packages/frontend/src/plugins/goiastec/
 */
import { remote } from '#/plugins/remote/index.ts';

const BASE = '/GoiasTec';

/* ------------------------------------------------------------------ */
/* Tipos (espelham os DTOs do plugin)                                  */
/* ------------------------------------------------------------------ */

export type CommentStatus = 'open' | 'in_review' | 'resolved';

export interface CategoryDto {
  Id: number;
  Name: string;
  Color: string;
  SortOrder: number;
  IsDeletable: boolean;
}

export interface CommentDto {
  Id: number;
  ItemId: string;
  UserId: string;
  UserName: string;
  TimestampTicks: number;
  CategoryId?: number | null;
  CategoryName?: string | null;
  CategoryColor?: string | null;
  Body: string;
  ParentCommentId?: number | null;
  Status: CommentStatus;
  IsPrivate: boolean;
  IsPinned: boolean;
  LikeCount: number;
  LikedByMe: boolean;
  ReplyCount: number;
  CreatedAtUtc: string;
  EditedAtUtc?: string | null;
  CanEdit: boolean;
  CanDelete: boolean;
}

export interface NotificationDto {
  Id: number;
  Type: 'reply' | 'mention';
  CommentId?: number | null;
  ItemId: string;
  CreatedAtUtc: string;
  Read: boolean;
}

export interface YoutubeStatusDto {
  ItemId: string;
  Status: 'not_linked' | 'linked' | 'caption_downloaded' | 'not_found' | 'error';
  VideoId?: string | null;
  ChannelTitle?: string | null;
  MatchedByName?: boolean;
  LastCheckedUtc?: string | null;
  VideoUrl?: string | null;
}

export interface MyRoleDto {
  userId: string;
  role: 'superadmin' | 'admin' | 'editor' | 'guest';
  isJellyfinAdmin: boolean;
}

export interface UserRoleDto {
  UserId: string;
  UserName: string;
  Role: 'superadmin' | 'admin' | 'editor' | 'guest';
}

export interface CreateCommentPayload {
  ItemId: string;
  TimestampTicks: number;
  CategoryId?: number | null;
  Body: string;
  ParentCommentId?: number | null;
  IsPrivate?: boolean;
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

function http(): import('axios').AxiosInstance {
  const axios = remote.sdk.api?.axiosInstance;
  if (!axios) {
    throw new Error('Sem conexão com o servidor Jellyfin.');
  }
  return axios;
}

export const goiasTecApi = {
  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const { data } = await http().get<T>(`${BASE}${path}`, { params });
    return data;
  },

  async post<T>(path: string, body?: unknown, params?: Record<string, unknown>): Promise<T> {
    const { data } = await http().post<T>(`${BASE}${path}`, body, { params });
    return data;
  },

  async put<T>(path: string, body?: unknown, params?: Record<string, unknown>): Promise<T> {
    const { data } = await http().put<T>(`${BASE}${path}`, body, { params });
    return data;
  },

  async del<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const { data } = await http().delete<T>(`${BASE}${path}`, { params });
    return data;
  },

  /* ----- Comentários ----- */
  listComments(itemId: string, opts?: {
    categoryId?: number; includeResolved?: boolean; sortBy?: string; onlyMine?: boolean
  }): Promise<CommentDto[]> {
    return this.get('/Comments', { itemId, ...opts });
  },
  createComment(payload: CreateCommentPayload): Promise<CommentDto> {
    return this.post('/Comments', payload);
  },
  updateComment(id: number, payload: { Body?: string; CategoryId?: number; IsPrivate?: boolean }): Promise<CommentDto> {
    return this.put(`/Comments/${id}`, payload);
  },
  deleteComment(id: number): Promise<void> {
    return this.del(`/Comments/${id}`);
  },
  setCommentStatus(id: number, status: CommentStatus): Promise<CommentDto> {
    return this.post(`/Comments/${id}/Status`, { Status: status });
  },
  setPinned(id: number, pinned: boolean): Promise<CommentDto> {
    return this.post(`/Comments/${id}/Pin`, undefined, { pinned });
  },
  likeComment(id: number): Promise<void> {
    return this.post(`/Comments/${id}/Like`);
  },
  unlikeComment(id: number): Promise<void> {
    return this.del(`/Comments/${id}/Like`);
  },
  pendingCount(itemId: string): Promise<number> {
    return this.get(`/Comments/Items/${itemId}/PendingCount`);
  },

  /* ----- Categorias ----- */
  listCategories(): Promise<CategoryDto[]> {
    return this.get('/Categories');
  },
  createCategory(payload: { Name: string; Color: string; SortOrder?: number }): Promise<CategoryDto> {
    return this.post('/Categories', payload);
  },
  updateCategory(id: number, payload: { Name?: string; Color?: string; SortOrder?: number }): Promise<CategoryDto> {
    return this.put(`/Categories/${id}`, payload);
  },
  deleteCategory(id: number): Promise<void> {
    return this.del(`/Categories/${id}`);
  },

  /* ----- Papéis ----- */
  myRole(): Promise<MyRoleDto> {
    return this.get('/Roles/Me');
  },
  listUsers(): Promise<UserRoleDto[]> {
    return this.get('/Roles');
  },
  setRole(userId: string, role: string): Promise<void> {
    return this.put(`/Roles/${userId}`, { Role: role });
  },

  /* ----- Notificações ----- */
  listNotifications(unreadOnly = false, limit = 50): Promise<NotificationDto[]> {
    return this.get('/Notifications', { unreadOnly, limit });
  },
  unreadCount(): Promise<number> {
    return this.get('/Notifications/UnreadCount');
  },
  markRead(id?: number): Promise<void> {
    return this.post('/Notifications/Read', undefined, id ? { id } : undefined);
  },

  /* ----- YouTube ----- */
  youtubeStatus(itemId: string): Promise<YoutubeStatusDto> {
    return this.get('/Youtube/Status', { itemId });
  },
  linkYoutube(itemId: string, videoId: string): Promise<void> {
    return this.post('/Youtube/Link', { ItemId: itemId, VideoId: videoId });
  },
  unlinkYoutube(itemId: string): Promise<void> {
    return this.post('/Youtube/Unlink', undefined, { itemId });
  },
  syncYoutubeItem(itemId: string): Promise<YoutubeStatusDto> {
    return this.post('/Youtube/SyncItem', undefined, { itemId });
  }
};
