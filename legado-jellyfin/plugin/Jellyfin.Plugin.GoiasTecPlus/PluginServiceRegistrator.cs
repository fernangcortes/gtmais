using Jellyfin.Plugin.GoiasTecPlus.Services;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.GoiasTecPlus;

/// <summary>Registra os serviços do plugin no container de DI do Jellyfin.</summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<CommentService>();
        serviceCollection.AddSingleton<NotificationService>();
        serviceCollection.AddSingleton<YoutubeService>();
    }
}
