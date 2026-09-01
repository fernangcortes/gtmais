using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.GoiasTecPlus.Db;
using Jellyfin.Plugin.GoiasTecPlus.Dto;
using Jellyfin.Plugin.GoiasTecPlus.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.GoiasTecPlus.Api;

/// <summary>
/// API de integração com o YouTube: status do vínculo item↔vídeo, link manual,
/// e gatilhos de sync (por item ou em lote).
/// </summary>
[ApiController]
[Route(Plugin.ApiBasePath + "/[controller]")]
[Authorize]
public class YoutubeController : ControllerBase
{
    private readonly YoutubeService _youtube;
    private readonly ILogger<YoutubeController> _logger;

    public YoutubeController(YoutubeService youtube, ILogger<YoutubeController> logger)
    {
        _youtube = youtube;
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
            _logger.LogError(ex, "Erro em YoutubeController.");
            return BadRequest(new { error = "Erro interno." });
        }
    }

    /// <summary>Configuração do canal (handle) — para o cliente exibir o estado.</summary>
    [HttpGet("Channel")]
    public ActionResult<object> Channel()
        => Run(() =>
        {
            var handle = Plugin.Instance!.Configuration.YoutubeChannelHandle ?? string.Empty;
            return new { handle, configured = !string.IsNullOrWhiteSpace(handle) };
        });

    /// <summary>Status do vínculo de um item com o YouTube.</summary>
    [HttpGet("Status")]
    public ActionResult<YoutubeStatusDto> Status([FromQuery] string itemId)
        => Run(() =>
        {
            _ = RequireUserId();
            var mapping = Plugin.Instance!.Database.GetMapping(itemId);
            return mapping is null
                ? new YoutubeStatusDto { ItemId = itemId }
                : new YoutubeStatusDto
                {
                    ItemId = mapping.ItemId,
                    Status = mapping.Status,
                    VideoId = mapping.VideoId,
                    ChannelTitle = mapping.ChannelTitle,
                    MatchedByName = mapping.MatchedByName,
                    LastCheckedUtc = mapping.LastCheckedUtc
                };
        });

    /// <summary>Vínculo manual item ↔ videoId do YouTube (admin+).</summary>
    [HttpPost("Link")]
    public ActionResult Link([FromBody] YoutubeLinkRequest request)
        => RunAction(() =>
        {
            var userId = RequireUserId();
            if (!RoleService.CanModerate(userId))
            {
                throw new UnauthorizedAccessException("Somente admin+ pode vincular vídeos.");
            }

            if (string.IsNullOrWhiteSpace(request.ItemId) || string.IsNullOrWhiteSpace(request.VideoId))
            {
                throw new ArgumentException("ItemId e VideoId são obrigatórios.");
            }

            Plugin.Instance!.Database.SetMapping(request.ItemId, request.VideoId, "linked");
        });

    /// <summary>Remove o vínculo manual (admin+).</summary>
    [HttpPost("Unlink")]
    public ActionResult Unlink([FromQuery] string itemId)
        => RunAction(() =>
        {
            var userId = RequireUserId();
            if (!RoleService.CanModerate(userId))
            {
                throw new UnauthorizedAccessException("Somente admin+ pode desvincular vídeos.");
            }

            Plugin.Instance!.Database.SetMapping(itemId, null, "not_linked");
        });

    /// <summary>Sincroniza um item específico (match por nome + download de legenda).</summary>
    [HttpPost("SyncItem")]
    public async Task<ActionResult<YoutubeStatusDto>> SyncItem([FromQuery] string itemId, CancellationToken cancellationToken)
        => await RunAsync(async () =>
        {
            _ = RequireUserId();
            var item = _youtube.GetVideoItems().FirstOrDefault(i => i.Id.ToString() == itemId);
            if (item is null)
            {
                throw new ArgumentException("Item não encontrado na biblioteca.");
            }

            var mapping = await _youtube.SyncItemAsync(item, cancellationToken);
            return new YoutubeStatusDto
            {
                ItemId = mapping.ItemId,
                Status = mapping.Status,
                VideoId = mapping.VideoId,
                ChannelTitle = mapping.ChannelTitle,
                MatchedByName = mapping.MatchedByName,
                LastCheckedUtc = mapping.LastCheckedUtc
            };
        });

    /// <summary>Dispara sync de todos os itens em segundo plano (admin+).</summary>
    [HttpPost("SyncAll")]
    public ActionResult SyncAll()
        => RunAction(() =>
        {
            var userId = RequireUserId();
            if (!RoleService.CanModerate(userId))
            {
                throw new UnauthorizedAccessException("Somente admin+ pode disparar o sync.");
            }

            _ = Task.Run(async () =>
            {
                foreach (var item in _youtube.GetVideoItems())
                {
                    try
                    {
                        await _youtube.SyncItemAsync(item, CancellationToken.None);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Falha no sync do item {Item}.", item.Name);
                    }
                }
            });
        });

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
            _logger.LogError(ex, "Erro em YoutubeController.");
            return BadRequest(new { error = "Erro interno." });
        }
    }

    private async Task<ActionResult<T>> RunAsync<T>(Func<Task<T>> action)
    {
        try
        {
            return await action();
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
            _logger.LogError(ex, "Erro em YoutubeController.");
            return BadRequest(new { error = "Erro interno." });
        }
    }
}
