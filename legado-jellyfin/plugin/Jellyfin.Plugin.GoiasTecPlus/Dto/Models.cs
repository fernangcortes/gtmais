using System;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.GoiasTecPlus.Dto;

/// <summary>DTO de categoria de comentário.</summary>
public class CategoryDto
{
    public long Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Color { get; set; } = "#5dd000";
    public int SortOrder { get; set; }
    public bool IsDeletable { get; set; }
}

/// <summary>DTO de comentário retornado pela API.</summary>
public class CommentDto
{
    public long Id { get; set; }
    public string ItemId { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public string UserName { get; set; } = string.Empty;
    public long TimestampTicks { get; set; }
    public long? CategoryId { get; set; }
    public string? CategoryName { get; set; }
    public string? CategoryColor { get; set; }
    public string Body { get; set; } = string.Empty;
    public long? ParentCommentId { get; set; }
    public string Status { get; set; } = "open";
    public bool IsPrivate { get; set; }
    public bool IsPinned { get; set; }
    public int LikeCount { get; set; }
    public bool LikedByMe { get; set; }
    public int ReplyCount { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime? EditedAtUtc { get; set; }
    public bool CanEdit { get; set; }
    public bool CanDelete { get; set; }
}

/// <summary>Requisição de criação de comentário.</summary>
public class CreateCommentRequest
{
    public string ItemId { get; set; } = string.Empty;
    public long TimestampTicks { get; set; }
    public long? CategoryId { get; set; }
    public string Body { get; set; } = string.Empty;
    public long? ParentCommentId { get; set; }
    public bool IsPrivate { get; set; }
}

/// <summary>Requisição de edição de comentário.</summary>
public class UpdateCommentRequest
{
    public string? Body { get; set; }
    public long? CategoryId { get; set; }
    public bool? IsPrivate { get; set; }
}

/// <summary>Requisição de mudança de status (fluxo de revisão).</summary>
public class SetStatusRequest
{
    public string Status { get; set; } = "open";
}

/// <summary>Requisição de criação de categoria.</summary>
public class CreateCategoryRequest
{
    public string Name { get; set; } = string.Empty;
    public string Color { get; set; } = "#5dd000";
    public int SortOrder { get; set; }
}

/// <summary>Requisição de edição de categoria.</summary>
public class UpdateCategoryRequest
{
    public string? Name { get; set; }
    public string? Color { get; set; }
    public int? SortOrder { get; set; }
}

/// <summary>Requisição de atribuição de papel.</summary>
public class SetRoleRequest
{
    public string Role { get; set; } = "guest";
}

/// <summary>DTO de usuário com papel.</summary>
public class UserRoleDto
{
    public string UserId { get; set; } = string.Empty;
    public string UserName { get; set; } = string.Empty;
    public string Role { get; set; } = "guest";
}

/// <summary>DTO do papel do usuário autenticado (camelCase p/ o cliente Vue).</summary>
public class MyRoleDto
{
    [JsonPropertyName("userId")]
    public Guid UserId { get; set; }

    [JsonPropertyName("role")]
    public string Role { get; set; } = "guest";

    [JsonPropertyName("isJellyfinAdmin")]
    public bool IsJellyfinAdmin { get; set; }
}

/// <summary>DTO de notificação in-app.</summary>
public class NotificationDto
{
    public long Id { get; set; }
    public string Type { get; set; } = string.Empty;
    public long? CommentId { get; set; }
    public string ItemId { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; }
    public bool Read { get; set; }
}

/// <summary>Requisição de vínculo manual item ↔ vídeo do YouTube.</summary>
public class YoutubeLinkRequest
{
    public string ItemId { get; set; } = string.Empty;
    public string VideoId { get; set; } = string.Empty;
}

/// <summary>DTO de status do vínculo com o YouTube.</summary>
public class YoutubeStatusDto
{
    public string ItemId { get; set; } = string.Empty;
    public string Status { get; set; } = "not_linked";
    public string? VideoId { get; set; }
    public string? ChannelTitle { get; set; }
    public bool MatchedByName { get; set; }
    public DateTime? LastCheckedUtc { get; set; }
    public string? VideoUrl => string.IsNullOrEmpty(VideoId)
        ? null
        : $"https://www.youtube.com/watch?v={VideoId}";
}
