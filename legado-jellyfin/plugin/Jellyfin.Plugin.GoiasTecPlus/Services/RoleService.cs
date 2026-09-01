using System;
using System.Security.Claims;
using Jellyfin.Plugin.GoiasTecPlus.Db;

namespace Jellyfin.Plugin.GoiasTecPlus.Services;

/// <summary>
/// Autorização por papel do Goiás Tec +. O papel fica no banco do plugin,
/// chaveado pelo ID do usuário Jellyfin.
/// </summary>
public static class RoleService
{
    /// <summary>Obtém o papel de um usuário (padrão: convidado).</summary>
    public static GoiasTecRole GetRole(Guid userId)
        => Plugin.Instance?.Database.GetRole(userId.ToString()) ?? GoiasTecRole.Guest;

    /// <summary>Verdadeiro se o usuário tem papel igual ou superior a <paramref name="minimum"/>.</summary>
    public static bool IsAtLeast(Guid userId, GoiasTecRole minimum)
        => GetRole(userId) >= minimum;

    /// <summary>Pode moderar comentários e gerenciar categorias (admin+).</summary>
    public static bool CanModerate(Guid userId) => IsAtLeast(userId, GoiasTecRole.Admin);

    /// <summary>Produtor (editor+): vê comentários privados e avança o fluxo de revisão.</summary>
    public static bool IsProducer(Guid userId) => IsAtLeast(userId, GoiasTecRole.Editor);

    /// <summary>Pode gerenciar categorias (admin+).</summary>
    public static bool CanManageCategories(Guid userId) => IsAtLeast(userId, GoiasTecRole.Admin);

    /// <summary>Pode gerenciar papéis de usuário (apenas superadmin).</summary>
    public static bool CanManageRoles(Guid userId) => GetRole(userId) == GoiasTecRole.SuperAdmin;

    /// <summary>Extrai o ID do usuário autenticado dos claims do Jellyfin.</summary>
    public static Guid? GetUserId(ClaimsPrincipal? user)
    {
        // Jellyfin (10.9+) não usa ClaimTypes.NameIdentifier: o userId fica no claim
        // customizado "Jellyfin-UserId" (Jellyfin.Api.Constants.InternalClaimTypes.UserId).
        // Mantemos o NameIdentifier como fallback por compatibilidade.
        var id = user?.FindFirst("Jellyfin-UserId")?.Value
            ?? user?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return Guid.TryParse(id, out var guid) ? guid : null;
    }

    /// <summary>Verdadeiro se o usuário é administrador nativo do Jellyfin.</summary>
    public static bool IsJellyfinAdmin(ClaimsPrincipal? user) => user?.IsInRole("Administrator") == true;
}
