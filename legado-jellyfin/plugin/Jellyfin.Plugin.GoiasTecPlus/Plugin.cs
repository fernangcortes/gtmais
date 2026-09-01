using System;
using System.IO;
using Jellyfin.Plugin.GoiasTecPlus.Configuration;
using Jellyfin.Plugin.GoiasTecPlus.Db;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.GoiasTecPlus;

/// <summary>
/// Plugin "Goiás Tec +": comentários ancorados no tempo, papéis de usuário,
/// sync com Google Drive (rclone mount) e legendas automáticas do YouTube (yt-dlp).
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>
{
    public const string PluginKey = "GoiasTecPlus";
    public const string ApiBasePath = "/GoiasTec";

    private readonly ILogger<Plugin> _logger;
    private readonly object _dbLock = new();
    private GoiasTecDatabase? _database;

    /// <summary>Inicializa o plugin e define o caminho do banco SQLite.</summary>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer, ILoggerFactory loggerFactory)
        : base(applicationPaths, xmlSerializer)
    {
        _logger = loggerFactory.CreateLogger<Plugin>();
        Instance = this;

        var dataDir = Path.Combine(applicationPaths.DataPath, "goiastec");
        Directory.CreateDirectory(dataDir);
        DatabasePath = Path.Combine(dataDir, "goiastec.db");
    }

    /// <summary>Instância singleton do plugin (padrão usado por plugins Jellyfin).</summary>
    public static Plugin? Instance { get; private set; }

    /// <summary>Caminho do banco SQLite do plugin.</summary>
    public string DatabasePath { get; }

    /// <summary>Acesso ao banco de dados (criado sob demanda).</summary>
    public GoiasTecDatabase Database
    {
        get
        {
            lock (_dbLock)
            {
                return _database ??= new GoiasTecDatabase(DatabasePath, _logger);
            }
        }
    }

    /// <inheritdoc />
    public override string Name => PluginKey;

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("9f3a7b1c-2d4e-4f5a-8b6c-3d4e5f6a7b8c");
}
