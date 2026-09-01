using System;
using System.Collections.Generic;
using System.Linq;
using Jellyfin.Plugin.GoiasTecPlus.Db;
using Jellyfin.Plugin.GoiasTecPlus.Dto;
using Jellyfin.Plugin.GoiasTecPlus.Services;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.GoiasTecPlus.Api;

/// <summary>
/// API de papéis (superadmin / admin / editor / convidado).
/// Atribuição de papéis: apenas superadmin.
/// </summary>
[ApiController]
[Route(Plugin.ApiBasePath + "/[controller]")]
[Authorize]
public class RolesController : ControllerBase
{
    private readonly IUserManager _userManager;
    private readonly ILogger<RolesController> _logger;

    public RolesController(IUserManager userManager, ILogger<RolesController> logger)
    {
        _userManager = userManager;
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
            _logger.LogError(ex, "Erro em RolesController.");
            return BadRequest(new { error = "Erro interno." });
        }
    }

    /// <summary>Papel do usuário autenticado (o cliente usa para liberar/ocultar recursos).</summary>
    [HttpGet("Me")]
    public ActionResult<MyRoleDto> Me()
        => Run(() =>
        {
            var userId = RequireUserId();
            return new MyRoleDto
            {
                UserId = userId,
                Role = GoiasTecDatabase.RoleToString(RoleService.GetRole(userId)),
                IsJellyfinAdmin = RoleService.IsJellyfinAdmin(User)
            };
        });

    /// <summary>Lista usuários com seus papéis (somente superadmin).</summary>
    [HttpGet]
    public ActionResult<List<UserRoleDto>> List()
        => Run(() =>
        {
            var userId = RequireUserId();
            if (!RoleService.CanManageRoles(userId))
            {
                throw new UnauthorizedAccessException("Somente superadmin pode listar papéis.");
            }

            var roles = Plugin.Instance!.Database.ListRoles();
            return _userManager.GetUsers()
                .Select(u => new UserRoleDto
                {
                    UserId = u.Id.ToString(),
                    UserName = u.Username ?? string.Empty,
                    Role = roles.TryGetValue(u.Id.ToString(), out var role)
                        ? GoiasTecDatabase.RoleToString(role)
                        : GoiasTecDatabase.RoleToString(GoiasTecRole.Guest)
                })
                .OrderBy(u => u.UserName)
                .ToList();
        });

    /// <summary>Atribui um papel a um usuário (somente superadmin).</summary>
    [HttpPut("{userId:guid}")]
    public ActionResult Set(Guid userId, [FromBody] SetRoleRequest request)
        => RunAction(() =>
        {
            var actorId = RequireUserId();
            if (!RoleService.CanManageRoles(actorId))
            {
                throw new UnauthorizedAccessException("Somente superadmin pode atribuir papéis.");
            }

            var role = request.Role?.ToLowerInvariant() switch
            {
                "superadmin" => GoiasTecRole.SuperAdmin,
                "admin" => GoiasTecRole.Admin,
                "editor" => GoiasTecRole.Editor,
                _ => GoiasTecRole.Guest
            };

            Plugin.Instance!.Database.SetRole(userId.ToString(), role);
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
        _logger.LogError(ex, "Erro em RolesController.");
        return BadRequest(new { error = "Erro interno." });
    }
}
}
