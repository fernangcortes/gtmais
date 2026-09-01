using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.GoiasTecPlus.ScheduledTasks;

/// <summary>
/// Detecta novos vídeos na pasta do mount do rclone (Google Drive) e dispara
/// um scan da biblioteca para que apareçam automaticamente no player.
/// </summary>
public class DriveWatchTask : IScheduledTask
{
    private static readonly string[] VideoExtensions =
    {
        ".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".wmv", ".flv", ".ts", ".mts", ".m2ts"
    };

    private readonly ILogger<DriveWatchTask> _logger;
    private readonly ILibraryManager _libraryManager;

    public DriveWatchTask(ILogger<DriveWatchTask> logger, ILibraryManager libraryManager)
    {
        _logger = logger;
        _libraryManager = libraryManager;
    }

    public string Name => "Goiás Tec +: detectar novos vídeos no Drive";
    public string Key => "GoiasTecDriveWatch";
    public string Description => "Verifica a pasta do mount do Google Drive e dispara um scan da biblioteca quando encontra arquivos novos ou alterados.";
    public string Category => "Goiás Tec +";

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
    {
        var interval = TimeSpan.FromMinutes(Plugin.Instance?.Configuration.ScanIntervalMinutes ?? 30);
        return new[]
        {
            new TaskTriggerInfo { Type = TaskTriggerInfoType.IntervalTrigger, IntervalTicks = interval.Ticks }
        };
    }

    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        var config = Plugin.Instance?.Configuration;
        if (config is null)
        {
            return;
        }

        if (!config.DriveWatchEnabled)
        {
            _logger.LogInformation("Drive watch desativado na configuração do plugin.");
            return;
        }

        var folder = config.DriveWatchFolder;
        if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder))
        {
            _logger.LogWarning("Pasta do Drive não encontrada: {Folder}. Verifique o mount do rclone.", folder);
            return;
        }

        var snapshotPath = Path.Combine(Path.GetDirectoryName(Plugin.Instance!.DatabasePath)!, "drive-snapshot.json");
        var current = BuildSnapshot(folder, cancellationToken);
        var previous = LoadSnapshot(snapshotPath);

        var changed = current
            .Where(kv => !previous.TryGetValue(kv.Key, out var old) || old != kv.Value)
            .Select(kv => kv.Key)
            .ToList();
        var removed = previous.Keys.Where(k => !current.ContainsKey(k)).ToList();

        if (changed.Count == 0 && removed.Count == 0)
        {
            _logger.LogInformation("Drive watch: nenhuma mudança detectada.");
            SaveSnapshot(snapshotPath, current);
            return;
        }

        _logger.LogInformation(
            "Drive watch: {Changed} novo(s)/alterado(s) e {Removed} removido(s). Disparando scan da biblioteca.",
            changed.Count,
            removed.Count);
        progress.Report(10);

        await Task.Run(
            () => _libraryManager.ValidateMediaLibrary(new NullProgress(), cancellationToken),
            cancellationToken);

        SaveSnapshot(snapshotPath, current);
        progress.Report(100);
    }

    private Dictionary<string, string> BuildSnapshot(string folder, CancellationToken cancellationToken)
    {
        var snapshot = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!VideoExtensions.Contains(Path.GetExtension(file), StringComparer.OrdinalIgnoreCase))
            {
                continue;
            }

            try
            {
                var info = new FileInfo(file);
                snapshot[file] = $"{info.LastWriteTimeUtc.Ticks}:{info.Length}";
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Falha ao inspecionar {File}.", file);
            }
        }

        return snapshot;
    }

    private Dictionary<string, string> LoadSnapshot(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                return JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(path))
                       ?? new Dictionary<string, string>();
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Falha ao ler snapshot do Drive; recriando.");
        }

        return new Dictionary<string, string>();
    }

    private void SaveSnapshot(string path, Dictionary<string, string> snapshot)
    {
        try
        {
            File.WriteAllText(path, JsonSerializer.Serialize(snapshot));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Falha ao salvar snapshot do Drive.");
        }
    }

    private sealed class NullProgress : IProgress<double>
    {
        public void Report(double value)
        {
        }
    }
}
