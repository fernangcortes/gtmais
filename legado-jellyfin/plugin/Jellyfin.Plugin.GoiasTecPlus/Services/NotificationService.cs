using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.GoiasTecPlus.Db;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.GoiasTecPlus.Services;

/// <summary>Notificações in-app de comentários (respostas e @menções).</summary>
public class NotificationService
{
    private static readonly Regex MentionRegex = new(@"@([\p{L}\p{N}_]+)", RegexOptions.Compiled);

    private readonly ILogger<NotificationService> _logger;
    private readonly IUserManager _userManager;

    public NotificationService(ILogger<NotificationService> logger, IUserManager userManager)
    {
        _logger = logger;
        _userManager = userManager;
    }

    public void CreateReplyNotification(string userId, long commentId, string itemId)
        => Plugin.Instance!.Database.CreateNotification(userId, "reply", commentId, itemId);

    public void CreateMentionNotification(string userId, long commentId, string itemId)
        => Plugin.Instance!.Database.CreateNotification(userId, "mention", commentId, itemId);

    /// <summary>Localiza usuários Jellyfin mencionados como @nome no corpo do comentário.</summary>
    public List<string> FindMentionedUserIds(string body)
    {
        var result = new List<string>();
        if (string.IsNullOrWhiteSpace(body))
        {
            return result;
        }

        var handles = MentionRegex.Matches(body)
            .Select(m => m.Groups[1].Value)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (handles.Count == 0)
        {
            return result;
        }

        foreach (var user in _userManager.GetUsers())
        {
            if (!string.IsNullOrEmpty(user.Username)
                && handles.Any(h => string.Equals(h, user.Username, StringComparison.OrdinalIgnoreCase)))
            {
                result.Add(user.Id.ToString());
            }
        }

        return result;
    }
}
