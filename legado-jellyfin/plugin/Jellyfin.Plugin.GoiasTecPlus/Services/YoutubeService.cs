using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.GoiasTecPlus.Configuration;
using Jellyfin.Plugin.GoiasTecPlus.Db;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.GoiasTecPlus.Services;

/// <summary>
/// Integração com o YouTube via yt-dlp (com runtime deno): lista os vídeos do canal,
/// casa itens do Jellyfin com vídeos postados (por nome do arquivo) e baixa a
/// legenda automática quando o vídeo já está no YouTube.
/// </summary>
public class YoutubeService
{
    private static readonly Regex NonAlnum = new("[^a-z0-9]+", RegexOptions.Compiled);

    private readonly ILogger<YoutubeService> _logger;
    private readonly ILibraryManager _libraryManager;

    public YoutubeService(ILogger<YoutubeService> logger, ILibraryManager libraryManager)
    {
        _logger = logger;
        _libraryManager = libraryManager;
    }

    private PluginConfiguration Config => Plugin.Instance!.Configuration;

    private GoiasTecDatabase Db => Plugin.Instance!.Database;

    /// <summary>URL do canal (ex.: https://www.youtube.com/@goiastec/videos). Nulo se não configurado.</summary>
    public string? ChannelUrl
    {
        get
        {
            var handle = Config.YoutubeChannelHandle?.Trim();
            return string.IsNullOrEmpty(handle)
                ? null
                : $"https://www.youtube.com/{handle.TrimStart('@')}/videos";
        }
    }

    /// <summary>Lista os vídeos do canal (títulos + IDs) usando yt-dlp.</summary>
    public async Task<List<ChannelEntry>> GetChannelVideosAsync(CancellationToken cancellationToken)
    {
        var url = ChannelUrl;
        if (url is null)
        {
            _logger.LogInformation("Canal do YouTube não configurado — pulando.");
            return new List<ChannelEntry>();
        }

        var (stdout, exitCode) = await RunAsync(
            Config.YtDlpPath,
            new[] { "--flat-playlist", "--dump-single-json", "--no-warnings", "--no-playlist", url },
            cancellationToken);

        if (exitCode != 0)
        {
            _logger.LogWarning("yt-dlp falhou ao listar o canal (exit {ExitCode}).", exitCode);
            return new List<ChannelEntry>();
        }

        try
        {
            using var doc = JsonDocument.Parse(stdout);
            if (!doc.RootElement.TryGetProperty("entries", out var entries))
            {
                return new List<ChannelEntry>();
            }

            var result = new List<ChannelEntry>();
            foreach (var entry in entries.EnumerateArray())
            {
                if (entry.TryGetProperty("id", out var idEl) && entry.TryGetProperty("title", out var titleEl))
                {
                    var title = titleEl.GetString();
                    if (!string.IsNullOrEmpty(title))
                    {
                        result.Add(new ChannelEntry { VideoId = idEl.GetString()!, Title = title });
                    }
                }
            }

            _logger.LogInformation("Canal {Channel}: {Count} vídeos encontrados.", Config.YoutubeChannelHandle, result.Count);
            return result;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Falha ao interpretar a lista do canal do YouTube.");
            return new List<ChannelEntry>();
        }
    }

    /// <summary>Sincroniza um item: vincula ao vídeo do YouTube (por nome ou manual) e baixa a legenda.</summary>
    public async Task<YoutubeMapping> SyncItemAsync(BaseItem item, CancellationToken cancellationToken)
    {
        var itemId = item.Id.ToString();
        var mapping = Db.GetMapping(itemId);

        // Já vinculado (manual ou anterior) → só baixa legenda se faltar
        if (mapping?.VideoId is not null)
        {
            if (Config.AutoDownloadCaptions && mapping.Status != "caption_downloaded")
            {
                await DownloadCaptionsAndUpdateAsync(item, mapping, cancellationToken);
            }

            return Db.GetMapping(itemId)!;
        }

        var channelTitle = await GetChannelTitleAsync(cancellationToken);

        // Tenta casar por nome do arquivo
        var videos = await GetChannelVideosAsync(cancellationToken);
        if (videos.Count > 0)
        {
            var fileName = Path.GetFileNameWithoutExtension(item.Path) ?? item.Name ?? string.Empty;
            var needle = Normalize(fileName);
            var match = videos.FirstOrDefault(v => Normalize(v.Title) == needle)
                ?? videos.FirstOrDefault(v => Normalize(v.Title).Contains(needle) || needle.Contains(Normalize(v.Title)));

            if (match is not null)
            {
                _logger.LogInformation("Item {Item} casado com o YouTube: {VideoId} ({Title}).", item.Name, match.VideoId, match.Title);
                Db.SetMapping(itemId, match.VideoId, "linked", channelTitle, matchedByName: true);
                mapping = Db.GetMapping(itemId)!;

                if (Config.AutoDownloadCaptions)
                {
                    await DownloadCaptionsAndUpdateAsync(item, mapping, cancellationToken);
                }

                return Db.GetMapping(itemId)!;
            }
        }

        Db.SetMapping(itemId, null, "not_found", channelTitle, matchedByName: false);
        return Db.GetMapping(itemId)!;
    }

    /// <summary>Baixa a legenda automática do YouTube e atualiza o status do mapping.</summary>
    private async Task DownloadCaptionsAndUpdateAsync(BaseItem item, YoutubeMapping mapping, CancellationToken cancellationToken)
    {
        var videoId = mapping.VideoId;
        if (string.IsNullOrEmpty(videoId))
        {
            return;
        }

        var ok = await DownloadCaptionsAsync(item, videoId, cancellationToken);
        Db.SetMapping(
            item.Id.ToString(),
            videoId,
            ok ? "caption_downloaded" : "error",
            mapping.ChannelTitle,
            mapping.MatchedByName);
    }

    /// <summary>Baixa a legenda automática (srt) e coloca ao lado do arquivo de mídia.</summary>
    public async Task<bool> DownloadCaptionsAsync(BaseItem item, string videoId, CancellationToken cancellationToken)
    {
        var mediaPath = item.Path;
        if (string.IsNullOrEmpty(mediaPath))
        {
            return false;
        }

        var lang = string.IsNullOrWhiteSpace(Config.CaptionLanguage) ? "pt" : Config.CaptionLanguage;
        var tempDir = Path.Combine(Path.GetTempPath(), "goiastec-yt");
        Directory.CreateDirectory(tempDir);

        var outputTemplate = Path.Combine(tempDir, "%(title)s [%(id)s]");
        var videoUrl = $"https://www.youtube.com/watch?v={videoId}";

        var args = new[]
        {
            "--skip-download",
            "--write-auto-subs",
            "--sub-langs", lang,
            "--sub-format", "srt/best",
            "--convert-subs", "srt",
            "--no-warnings",
            "-o", outputTemplate,
            videoUrl
        };

        var (_, exitCode) = await RunAsync(Config.YtDlpPath, args, cancellationToken);
        if (exitCode != 0)
        {
            _logger.LogWarning("yt-dlp falhou ao baixar a legenda de {VideoId} (exit {ExitCode}).", videoId, exitCode);
            return false;
        }

        var subtitleFile = Directory.EnumerateFiles(tempDir, "*.srt").FirstOrDefault();
        if (subtitleFile is null)
        {
            _logger.LogWarning("Nenhuma legenda {Lang} encontrada para {VideoId}.", lang, videoId);
            return false;
        }

        var destination = Path.ChangeExtension(mediaPath, $".{lang}.srt");
        File.Copy(subtitleFile, destination, overwrite: true);
        _logger.LogInformation("Legenda salva em {Destination}.", destination);

        Cleanup(tempDir);

        try
        {
            await item.RefreshMetadata(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Falha ao atualizar metadados após salvar a legenda (rode um scan manual se necessário).");
        }

        return true;
    }

    private async Task<string?> GetChannelTitleAsync(CancellationToken cancellationToken)
    {
        var url = ChannelUrl;
        if (url is null)
        {
            return null;
        }

        var (stdout, exitCode) = await RunAsync(
            Config.YtDlpPath,
            new[] { "--flat-playlist", "--dump-single-json", "--no-warnings", "--no-playlist", url },
            cancellationToken);

        if (exitCode != 0)
        {
            return null;
        }

        try
        {
            using var doc = JsonDocument.Parse(stdout);
            return doc.RootElement.TryGetProperty("channel", out var ch) ? ch.GetString() : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Lista todos os itens de vídeo da biblioteca.</summary>
    public IReadOnlyList<BaseItem> GetVideoItems()
    {
        try
        {
            return _libraryManager.GetItemList(new InternalItemsQuery
            {
                Recursive = true,
                IncludeItemTypes = new[] { BaseItemKind.Movie, BaseItemKind.Episode, BaseItemKind.Video }
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Falha ao listar itens de vídeo da biblioteca.");
            return Array.Empty<BaseItem>();
        }
    }

    /// <summary>Normaliza texto para comparação de nomes (minúsculas, sem acentos/símbolos).</summary>
    public static string Normalize(string value)
        => NonAlnum.Replace(RemoveDiacritics(value.ToLowerInvariant()), string.Empty);

    private static string RemoveDiacritics(string value)
    {
        var normalized = value.Normalize(System.Text.NormalizationForm.FormD);
        var sb = new System.Text.StringBuilder();
        foreach (var ch in normalized)
        {
            if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(ch) != System.Globalization.UnicodeCategory.NonSpacingMark)
            {
                sb.Append(ch);
            }
        }

        return sb.ToString().Normalize(System.Text.NormalizationForm.FormC);
    }

    private void Cleanup(string dir)
    {
        try
        {
            foreach (var file in Directory.EnumerateFiles(dir))
            {
                File.Delete(file);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Falha ao limpar diretório temporário {Dir}.", dir);
        }
    }

    private async Task<(string StdOut, int ExitCode)> RunAsync(string program, IReadOnlyList<string> args, CancellationToken cancellationToken)
    {
        try
        {
            var psi = new ProcessStartInfo(program)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            foreach (var arg in args)
            {
                psi.ArgumentList.Add(arg);
            }

            using var process = Process.Start(psi);
            if (process is null)
            {
                _logger.LogError("Não foi possível iniciar {Program}.", program);
                return (string.Empty, -1);
            }

            var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
            var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);
            await process.WaitForExitAsync(cancellationToken);

            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            if (!string.IsNullOrWhiteSpace(stderr))
            {
                _logger.LogDebug("{Program} (stderr): {Stderr}", program, stderr);
            }

            return (stdout, process.ExitCode);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Falha ao executar {Program}.", program);
            return (string.Empty, -1);
        }
    }

    /// <summary>Vídeo do canal (id + título) retornado pelo yt-dlp.</summary>
    public sealed record ChannelEntry
    {
        public string VideoId { get; init; } = string.Empty;
        public string Title { get; init; } = string.Empty;
    }
}
