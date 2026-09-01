using System;
using System.Collections.Generic;
using Jellyfin.Plugin.GoiasTecPlus.Dto;
using Jellyfin.Plugin.GoiasTecPlus.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.GoiasTecPlus.Api;

/// <summary>
/// API de comentários ancorados no tempo.
/// Rotas: GET/POST /GoiasTec/Comments, PUT/DELETE /GoiasTec/Comments/{id},
/// status de revisão, pin, curtidas e contagem de pendências.
/// </summary>
[ApiController]
[Route(Plugin.ApiBasePath + "/[controller]")]
[Authorize]
public class CommentsController : ControllerBase
{
    private readonly CommentService _comments;
    private readonly ILogger<CommentsController> _logger;

    public CommentsController(CommentService comments, ILogger<CommentsController> logger)
    {
        _comments = comments;
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
            _logger.LogError(ex, "Erro em CommentsController.");
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
            _logger.LogError(ex, "Erro em CommentsController.");
            return BadRequest(new { error = "Erro interno." });
        }
    }

    /// <summary>Lista comentários de um item (filtros por categoria, status, ordenação, só os meus).</summary>
    [HttpGet]
    public ActionResult<List<CommentDto>> List(
        [FromQuery] string itemId,
        [FromQuery] long? categoryId = null,
        [FromQuery] bool includeResolved = true,
        [FromQuery] string sortBy = "time",
        [FromQuery] bool onlyMine = false)
        => Run(() => _comments.ListComments(itemId, categoryId, includeResolved, sortBy, onlyMine, RequireUserId()));

    /// <summary>Cria um comentário (ancorado em TimestampTicks; reply via ParentCommentId).</summary>
    [HttpPost]
    public ActionResult<CommentDto> Create([FromBody] CreateCommentRequest request)
        => Run(() => _comments.Create(request, RequireUserId()));

    /// <summary>Edita um comentário (autor ou admin+).</summary>
    [HttpPut("{id:long}")]
    public ActionResult<CommentDto> Update(long id, [FromBody] UpdateCommentRequest request)
        => Run(() => _comments.Update(id, request, RequireUserId()));

    /// <summary>Exclui (soft delete) um comentário (autor ou admin+).</summary>
    [HttpDelete("{id:long}")]
    public ActionResult Delete(long id)
        => RunAction(() => _comments.Delete(id, RequireUserId()));

    /// <summary>Altera o status do fluxo de revisão (somente produtora/editor+).</summary>
    [HttpPost("{id:long}/Status")]
    public ActionResult<CommentDto> SetStatus(long id, [FromBody] SetStatusRequest request)
        => Run(() => _comments.SetStatus(id, request, RequireUserId()));

    /// <summary>Fixa/desfixa um comentário (admin+).</summary>
    [HttpPost("{id:long}/Pin")]
    public ActionResult<CommentDto> Pin(long id, [FromQuery] bool pinned = true)
        => Run(() => _comments.SetPinned(id, pinned, RequireUserId()));

    /// <summary>Curtir um comentário.</summary>
    [HttpPost("{id:long}/Like")]
    public ActionResult Like(long id)
        => RunAction(() => _comments.Like(id, RequireUserId()));

    /// <summary>Remover curtida de um comentário.</summary>
    [HttpDelete("{id:long}/Like")]
    public ActionResult Unlike(long id)
        => RunAction(() => _comments.Unlike(id, RequireUserId()));

    /// <summary>Conta de comentários pendentes (não resolvidos) de um item — badge do cliente.</summary>
    [HttpGet("Items/{itemId}/PendingCount")]
    public ActionResult<int> PendingCount(string itemId)
        => Run(() => _comments.PendingCount(itemId));
}
