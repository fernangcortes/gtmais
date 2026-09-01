using System;
using System.Collections.Generic;
using Jellyfin.Plugin.GoiasTecPlus.Db;
using Jellyfin.Plugin.GoiasTecPlus.Dto;
using Jellyfin.Plugin.GoiasTecPlus.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.GoiasTecPlus.Api;

/// <summary>
/// API de categorias de comentário (roteiro, montagem, cor, tema, geral...).
/// Leitura para todos autenticados; escrita para admin+.
/// </summary>
[ApiController]
[Route(Plugin.ApiBasePath + "/[controller]")]
[Authorize]
public class CategoriesController : ControllerBase
{
    private readonly ILogger<CategoriesController> _logger;

    public CategoriesController(ILogger<CategoriesController> logger)
    {
        _logger = logger;
    }

    private GoiasTecDatabase Db => Plugin.Instance!.Database;

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
            _logger.LogError(ex, "Erro em CategoriesController.");
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
            _logger.LogError(ex, "Erro em CategoriesController.");
            return BadRequest(new { error = "Erro interno." });
        }
    }

    /// <summary>Lista categorias (ordem definida pelo admin).</summary>
    [HttpGet]
    public ActionResult<List<CategoryDto>> List()
        => Run(() =>
        {
            _ = RequireUserId();
            return Db.ListCategories().ConvertAll(ToDto);
        });

    /// <summary>Cria categoria (admin+).</summary>
    [HttpPost]
    public ActionResult<CategoryDto> Create([FromBody] CreateCategoryRequest request)
        => Run(() =>
        {
            var userId = RequireUserId();
            if (!RoleService.CanManageCategories(userId))
            {
                throw new UnauthorizedAccessException("Somente admin+ pode criar categorias.");
            }

            if (string.IsNullOrWhiteSpace(request.Name))
            {
                throw new ArgumentException("O nome da categoria não pode ser vazio.");
            }

            return ToDto(Db.CreateCategory(request.Name.Trim(), request.Color, request.SortOrder));
        });

    /// <summary>Edita categoria (admin+).</summary>
    [HttpPut("{id:long}")]
    public ActionResult<CategoryDto> Update(long id, [FromBody] UpdateCategoryRequest request)
        => Run(() =>
        {
            var userId = RequireUserId();
            if (!RoleService.CanManageCategories(userId))
            {
                throw new UnauthorizedAccessException("Somente admin+ pode editar categorias.");
            }

            if (Db.GetCategory(id) is null)
            {
                throw new ArgumentException("Categoria não encontrada.");
            }

            Db.UpdateCategory(id, request.Name, request.Color, request.SortOrder);
            return ToDto(Db.GetCategory(id)!);
        });

    /// <summary>Exclui categoria (admin+; categorias marcadas como não deletáveis são protegidas).</summary>
    [HttpDelete("{id:long}")]
    public ActionResult Delete(long id)
        => RunAction(() =>
        {
            var userId = RequireUserId();
            if (!RoleService.CanManageCategories(userId))
            {
                throw new UnauthorizedAccessException("Somente admin+ pode excluir categorias.");
            }

            if (!Db.DeleteCategory(id))
            {
                throw new ArgumentException("Categoria não encontrada ou protegida.");
            }
        });

    private static CategoryDto ToDto(Category c) => new()
    {
        Id = c.Id,
        Name = c.Name,
        Color = c.Color,
        SortOrder = c.SortOrder,
        IsDeletable = c.IsDeletable
    };
}
