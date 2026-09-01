using System;
using System.Collections.Generic;
using System.Linq;
using Jellyfin.Plugin.GoiasTecPlus.Db;
using Jellyfin.Plugin.GoiasTecPlus.Dto;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.GoiasTecPlus.Services;

/// <summary>
/// Regras de negócio dos comentários: autorização por papel, fluxo de revisão,
/// respostas, curtições, privacidade (produtora vs cliente) e notificações.
/// </summary>
public class CommentService
{
    private readonly ILogger<CommentService> _logger;
    private readonly IUserManager _userManager;
    private readonly NotificationService _notifications;

    public CommentService(ILogger<CommentService> logger, IUserManager userManager, NotificationService notifications)
    {
        _logger = logger;
        _userManager = userManager;
        _notifications = notifications;
    }

    private GoiasTecDatabase Db => Plugin.Instance!.Database;

    public List<CommentDto> ListComments(
        string itemId, long? categoryId, bool includeResolved, string sortBy, bool onlyMine, Guid viewerId)
    {
        var isProducer = RoleService.IsProducer(viewerId);
        var comments = Db.ListComments(
            itemId,
            categoryId,
            includeResolved,
            includePrivate: isProducer,
            onlyMine: onlyMine ? viewerId.ToString() : null,
            sortBy: sortBy);

        return comments.Select(c => ToDto(c, viewerId)).ToList();
    }

    public CommentDto Create(CreateCommentRequest req, Guid userId)
    {
        var isProducer = RoleService.IsProducer(userId);
        if (req.IsPrivate && !isProducer)
        {
            throw new UnauthorizedAccessException("Somente produtores (editor+) podem criar comentários privados.");
        }

        if (string.IsNullOrWhiteSpace(req.Body))
        {
            throw new ArgumentException("O comentário não pode ser vazio.");
        }

        if (req.ParentCommentId.HasValue)
        {
            var parent = Db.GetComment(req.ParentCommentId.Value)
                ?? throw new ArgumentException("Comentário pai não encontrado.");
            req.ItemId = parent.ItemId;
        }

        var comment = Db.CreateComment(
            req.ItemId,
            userId.ToString(),
            req.TimestampTicks,
            req.CategoryId,
            req.Body.Trim(),
            req.ParentCommentId,
            req.IsPrivate,
            CommentStatus.Open);

        // Notificação de resposta para o autor do comentário pai
        if (req.ParentCommentId.HasValue)
        {
            var parent = Db.GetComment(req.ParentCommentId.Value)!;
            if (!string.Equals(parent.UserId, userId.ToString(), StringComparison.OrdinalIgnoreCase))
            {
                _notifications.CreateReplyNotification(parent.UserId, comment.Id, comment.ItemId);
            }
        }

        // Notificações de @menções
        foreach (var mentionedId in _notifications.FindMentionedUserIds(req.Body))
        {
            if (!string.Equals(mentionedId, userId.ToString(), StringComparison.OrdinalIgnoreCase))
            {
                _notifications.CreateMentionNotification(mentionedId, comment.Id, comment.ItemId);
            }
        }

        return ToDto(comment, userId);
    }

    public CommentDto Update(long id, UpdateCommentRequest req, Guid userId)
    {
        var comment = Db.GetComment(id) ?? throw new ArgumentException("Comentário não encontrado.");
        var isAuthor = string.Equals(comment.UserId, userId.ToString(), StringComparison.OrdinalIgnoreCase);
        if (!isAuthor && !RoleService.CanModerate(userId))
        {
            throw new UnauthorizedAccessException("Você não pode editar este comentário.");
        }

        if (req.IsPrivate == true && !RoleService.IsProducer(userId))
        {
            throw new UnauthorizedAccessException("Somente produtores podem marcar comentários como privados.");
        }

        Db.UpdateComment(id, req.Body, req.CategoryId, null, req.IsPrivate);
        return ToDto(Db.GetComment(id)!, userId);
    }

    public void Delete(long id, Guid userId)
    {
        var comment = Db.GetComment(id) ?? throw new ArgumentException("Comentário não encontrado.");
        var isAuthor = string.Equals(comment.UserId, userId.ToString(), StringComparison.OrdinalIgnoreCase);
        if (!isAuthor && !RoleService.CanModerate(userId))
        {
            throw new UnauthorizedAccessException("Você não pode excluir este comentário.");
        }

        Db.SoftDeleteComment(id);
    }

    /// <summary>Fluxo de revisão: apenas a produtora (editor+) muda o status.</summary>
    public CommentDto SetStatus(long id, SetStatusRequest req, Guid userId)
    {
        if (!RoleService.IsProducer(userId))
        {
            throw new UnauthorizedAccessException("Somente a produtora (editor+) pode alterar o status do fluxo de revisão.");
        }

        if (Db.GetComment(id) is null)
        {
            throw new ArgumentException("Comentário não encontrado.");
        }

        var status = req.Status?.ToLowerInvariant() switch
        {
            "in_review" => CommentStatus.InReview,
            "resolved" => CommentStatus.Resolved,
            _ => CommentStatus.Open
        };

        Db.UpdateComment(id, null, null, status, null);
        return ToDto(Db.GetComment(id)!, userId);
    }

    public CommentDto SetPinned(long id, bool pinned, Guid userId)
    {
        if (!RoleService.CanModerate(userId))
        {
            throw new UnauthorizedAccessException("Somente admin+ pode fixar comentários.");
        }

        if (Db.GetComment(id) is null)
        {
            throw new ArgumentException("Comentário não encontrado.");
        }

        Db.SetCommentPinned(id, pinned);
        return ToDto(Db.GetComment(id)!, userId);
    }

    public bool Like(long id, Guid userId)
        => Db.GetComment(id) != null && Db.Like(id, userId.ToString());

    public bool Unlike(long id, Guid userId)
        => Db.GetComment(id) != null && Db.Unlike(id, userId.ToString());

    public int PendingCount(string itemId) => Db.PendingCount(itemId);

    private CommentDto ToDto(Comment c, Guid viewerId)
    {
        var category = c.CategoryId.HasValue ? Db.GetCategory(c.CategoryId.Value) : null;
        var isAuthor = string.Equals(c.UserId, viewerId.ToString(), StringComparison.OrdinalIgnoreCase);

        return new CommentDto
        {
            Id = c.Id,
            ItemId = c.ItemId,
            UserId = c.UserId,
            UserName = GetUserName(c.UserId),
            TimestampTicks = c.TimestampTicks,
            CategoryId = c.CategoryId,
            CategoryName = category?.Name,
            CategoryColor = category?.Color,
            Body = c.Body,
            ParentCommentId = c.ParentCommentId,
            Status = GoiasTecDatabase.StatusToString(c.Status),
            IsPrivate = c.IsPrivate,
            IsPinned = c.IsPinned,
            LikeCount = c.LikeCount,
            LikedByMe = Db.IsLiked(c.Id, viewerId.ToString()),
            ReplyCount = c.ReplyCount,
            CreatedAtUtc = c.CreatedAtUtc,
            EditedAtUtc = c.EditedAtUtc,
            CanEdit = isAuthor,
            CanDelete = isAuthor || RoleService.CanModerate(viewerId)
        };
    }

    private string GetUserName(string userId)
    {
        if (Guid.TryParse(userId, out var guid))
        {
            try
            {
                return _userManager.GetUserById(guid)?.Username ?? userId;
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Falha ao buscar nome do usuário {UserId}", userId);
            }
        }

        return userId;
    }
}
