namespace Jellyfin.Plugin.GoiasTecPlus.Db;

/// <summary>Status de um comentário no fluxo de revisão produtora↔cliente.</summary>
public enum CommentStatus
{
    /// <summary>Aberto (cliente apontou; aguarda produtora).</summary>
    Open,

    /// <summary>Em revisão (produtora está corrigindo).</summary>
    InReview,

    /// <summary>Resolvido (correção feita / aprovado).</summary>
    Resolved
}

/// <summary>
/// Papéis de usuário do Goiás Tec +.
/// Ordem IMPORTANTE: maior valor = mais privilégio (usado em comparações &gt;=).
/// </summary>
public enum GoiasTecRole
{
    /// <summary>Assiste e comenta (comentários públicos).</summary>
    Guest = 0,

    /// <summary>Comenta, vê comentários privados e avança o fluxo de revisão.</summary>
    Editor = 1,

    /// <summary>Gerencia vídeos, modera comentários e gerencia categorias.</summary>
    Admin = 2,

    /// <summary>Controle total (gerencia usuários, papéis e categorias).</summary>
    SuperAdmin = 3
}

/// <summary>Categoria de comentário (roteiro, montagem, cor, tema, geral...). Editável por admin+.</summary>
public class Category
{
    public long Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Color { get; set; } = "#5dd000";
    public int SortOrder { get; set; }
    public bool IsDeletable { get; set; } = true;
    public DateTime CreatedAtUtc { get; set; }
}

/// <summary>Comentário ancorado no tempo de um item (vídeo).</summary>
public class Comment
{
    public long Id { get; set; }
    public string ItemId { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;

    /// <summary>Posição no vídeo em ticks do Jellyfin (10.000.000 ticks = 1 segundo).</summary>
    public long TimestampTicks { get; set; }
    public long? CategoryId { get; set; }
    public string Body { get; set; } = string.Empty;
    public long? ParentCommentId { get; set; }
    public CommentStatus Status { get; set; } = CommentStatus.Open;

    /// <summary>Comentário privado/interno: visível apenas para produtores (editor+).</summary>
    public bool IsPrivate { get; set; }
    public bool IsPinned { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime? EditedAtUtc { get; set; }
    public DateTime? DeletedAtUtc { get; set; }

    // Campos computados (preenchidos nas consultas)
    public int LikeCount { get; set; }
    public int ReplyCount { get; set; }
}

/// <summary>Curtida de um comentário.</summary>
public class CommentLike
{
    public long CommentId { get; set; }
    public string UserId { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; }
}

/// <summary>Papel atribuído a um usuário Jellyfin.</summary>
public class UserRole
{
    public string UserId { get; set; } = string.Empty;
    public GoiasTecRole Role { get; set; } = GoiasTecRole.Guest;
    public DateTime UpdatedAtUtc { get; set; }
}

/// <summary>Vínculo entre um item do Jellyfin e um vídeo do YouTube.</summary>
public class YoutubeMapping
{
    public string ItemId { get; set; } = string.Empty;
    public string? VideoId { get; set; }
    public string Status { get; set; } = "not_linked";
    public string? ChannelTitle { get; set; }
    public bool MatchedByName { get; set; }
    public DateTime? LastCheckedUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
}

/// <summary>Notificação in-app (respostas e menções).</summary>
public class Notification
{
    public long Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string Type { get; set; } = "reply"; // reply | mention
    public long? CommentId { get; set; }
    public string ItemId { get; set; } = string.Empty;
    public DateTime? ReadAtUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; }
}
