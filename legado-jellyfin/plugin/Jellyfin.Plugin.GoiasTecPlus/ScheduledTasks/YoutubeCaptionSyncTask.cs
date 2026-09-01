using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.GoiasTecPlus.Services;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.GoiasTecPlus.ScheduledTasks;

/// <summary>
/// Sincroniza com o YouTube: casa os itens da biblioteca com os vídeos postados
/// no canal (por nome de arquivo ou vínculo manual) e baixa a legenda automática
/// via yt-dlp/deno quando o vídeo já estiver publicado.
/// </summary>
public class YoutubeCaptionSyncTask : IScheduledTask
{
    private readonly ILogger<YoutubeCaptionSyncTask> _logger;
    private readonly YoutubeService _youtube;

    public YoutubeCaptionSyncTask(ILogger<YoutubeCaptionSyncTask> logger, YoutubeService youtube)
    {
        _logger = logger;
        _youtube = youtube;
    }

    public string Name => "Goiás Tec +: sincronizar legendas com o YouTube";
    public string Key => "GoiasTecYoutubeSync";
    public string Description => "Verifica se os vídeos estão postados no canal do Goiás Tec e baixa as legendas automáticas (yt-dlp/deno).";
    public string Category => "Goiás Tec +";

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
    {
        return new[]
        {
            // Diário às 04:00 + repetição a cada 12h (cobre vídeos postados ao longo do dia)
            new TaskTriggerInfo { Type = TaskTriggerInfoType.DailyTrigger, TimeOfDayTicks = TimeSpan.FromHours(4).Ticks },
            new TaskTriggerInfo { Type = TaskTriggerInfoType.IntervalTrigger, IntervalTicks = TimeSpan.FromHours(12).Ticks }
        };
    }

    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        var config = Plugin.Instance?.Configuration;
        if (config is null)
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(config.YoutubeChannelHandle))
        {
            _logger.LogInformation("Canal do YouTube ainda não configurado — sync de legendas adiado.");
            return;
        }

        var items = _youtube.GetVideoItems();
        if (items.Count == 0)
        {
            _logger.LogInformation("Nenhum item de vídeo na biblioteca.");
            return;
        }

        _logger.LogInformation("YouTube sync: processando {Count} itens.", items.Count);
        progress.Report(0);

        var db = Plugin.Instance!.Database;
        var processed = 0;
        foreach (var item in items)
        {
            cancellationToken.ThrowIfCancellationRequested();

            // Pula itens já resolvidos
            var existing = db.GetMapping(item.Id.ToString());
            if (existing is not null)
            {
                if (existing.Status == "caption_downloaded")
                {
                    continue;
                }

                if (existing.Status == "not_found"
                    && existing.LastCheckedUtc.HasValue
                    && DateTime.UtcNow - existing.LastCheckedUtc.Value < TimeSpan.FromHours(24))
                {
                    continue; // evita consultar o YouTube repetidamente para itens sem match
                }
            }

            try
            {
                await _youtube.SyncItemAsync(item, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "YouTube sync: falha no item {Item}.", item.Name);
            }

            processed++;
            progress.Report(processed * 100.0 / items.Count);
        }

        progress.Report(100);
        _logger.LogInformation("YouTube sync concluído ({Processed} itens processados).", processed);
    }
}
