using System;
using System.Collections.Generic;
using System.Linq;
using Jellyfin.Plugin.GoiasTecPlus.Db;
using Jellyfin.Plugin.GoiasTecPlus.Dto;
using Jellyfin.Plugin.GoiasTecPlus.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.GoiasTecPlus.Api;

/// <summary>
/// API de notificações in-app (respostas e @menções).
/// </summary>
[ApiController]
[Route(Plugin.ApiBasePath + "/[controller]")]
[Authorize]
public class NotificationsController : ControllerBase
{
    private readonly ILogger<NotificationsController> _logger;

    public NotificationsController(ILogger<NotificationsController> logger)
    {
        _logger = logger;
    }

    private Guid RequireUserId()
        => RoleService.GetUserId(User) ?? throw new UnauthorizedAccessException("Usuário não autenticado.");

    private ActionResult<T> Run<T>(Func<T> action)
    {
        try
        {
            return action();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro em NotificationsController.");
            return BadRequest(new { error = "Erro interno." });
        }
    }

    private ActionResult RunAction(Action action)
    {
        try
        {
            action();
            return NoContent();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro em NotificationsController.");
            return BadRequest(new { error = "Erro interno." });
        }
    }

    /// <summary>Lista notificações do usuário autenticado.</summary>
    [HttpGet]
    public ActionResult<List<NotificationDto>> List([FromQuery] bool unreadOnly = false, [FromQuery] int limit = 50)
        => Run(() =>
        {
            var userId = RequireUserId().ToString();
            return Plugin.Instance!.Database.ListNotifications(userId, unreadOnly, limit)
                .ConvertAll(n => new NotificationDto
                {
                    Id = n.Id,
                    Type = n.Type,
                    CommentId = n.CommentId,
                    ItemId = n.ItemId,
                    CreatedAtUtc = n.CreatedAtUtc,
                    Read = n.ReadAtUtc.HasValue
                });
        });

    /// <summary>Total de notificações não lidas (para o badge do sino).</summary>
    [HttpGet("UnreadCount")]
    public ActionResult<int> UnreadCount()
        => Run(() => Plugin.Instance!.Database.UnreadCount(RequireUserId().ToString()));

    /// <summary>Marca como lida (id informado) ou todas (id nulo).</summary>
    [HttpPost("Read")]
    public ActionResult MarkRead([FromQuery] long? id = null)
        => RunAction(() => Plugin.Instance!.Database.MarkRead(RequireUserId().ToString(), id));
}
