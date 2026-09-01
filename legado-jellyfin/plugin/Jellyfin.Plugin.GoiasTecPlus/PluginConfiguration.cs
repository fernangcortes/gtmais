using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.GoiasTecPlus.Configuration;

/// <summary>Configuração do plugin (Dashboard > Plugins > GoiasTecPlus).</summary>
public class PluginConfiguration : BasePluginConfiguration
{
    // ---- YouTube ----
    /// <summary>Handle do canal (ex.: "@goiastec"). Deixe vazio até a conta existir.</summary>
    public string YoutubeChannelHandle { get; set; } = string.Empty;

    /// <summary>Caminho do binário yt-dlp (no container: "yt-dlp").</summary>
    public string YtDlpPath { get; set; } = "yt-dlp";

    /// <summary>Caminho do runtime deno (no container: "deno").</summary>
    public string DenoPath { get; set; } = "deno";

    /// <summary>Baixar automaticamente a legenda automática do YouTube quando o vídeo estiver postado.</summary>
    public bool AutoDownloadCaptions { get; set; } = true;

    /// <summary>Idioma da legenda baixada do YouTube.</summary>
    public string CaptionLanguage { get; set; } = "pt";

    // ---- Drive watch ----
    /// <summary>Ativa a tarefa que detecta novos vídeos no mount do rclone.</summary>
    public bool DriveWatchEnabled { get; set; } = true;

    /// <summary>Pasta do mount do rclone dentro do container Jellyfin.</summary>
    public string DriveWatchFolder { get; set; } = "/media/goiastec";

    /// <summary>Remote do rclone usado para listar (ex.: "goiastec:"). Deixe vazio para usar só o filesystem.</summary>
    public string DriveRemote { get; set; } = string.Empty;

    /// <summary>Caminho do binário rclone (usado para invalidar cache via "rclone rc").</summary>
    public string RclonePath { get; set; } = "rclone";

    /// <summary>Intervalo (min) entre varreduras da tarefa de watch do Drive.</summary>
    public int ScanIntervalMinutes { get; set; } = 30;

    // ---- Geral ----
    /// <summary>Cor padrão de novas categorias.</summary>
    public string DefaultCategoryColor { get; set; } = "#5dd000";

    /// <summary>Categorias padrão criadas na primeira execução.</summary>
    public string[] DefaultCategories { get; set; } = { "roteiro", "montagem", "cor", "tema", "geral" };
}
