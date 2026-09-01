using System;
using System.Collections.Generic;
using System.Text;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.GoiasTecPlus.Db;

/// <summary>
/// Camada de acesso a dados em SQLite do plugin Goiás Tec +.
/// Banco em {dataPath}/goiastec/goiastec.db. Todas as consultas usam parâmetros.
/// </summary>
public sealed class GoiasTecDatabase
{
    private const string DateFormat = "o";
    private readonly string _connectionString;
    private readonly ILogger _logger;
    private readonly object _initLock = new();
    private bool _initialized;

    public GoiasTecDatabase(string databasePath, ILogger logger)
    {
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared
        }.ToString();
        _logger = logger;
    }

    private SqliteConnection OpenConnection()
    {
        var conn = new SqliteConnection(_connectionString);
        conn.Open();
        return conn;
    }

    /// <summary>Cria o schema (idempotente) e popula as categorias padrão na primeira execução.</summary>
    public void Initialize()
    {
        if (_initialized)
        {
            return;
        }

        lock (_initLock)
        {
            if (_initialized)
            {
                return;
            }

            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                CREATE TABLE IF NOT EXISTS categories (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    Name TEXT NOT NULL,
                    Color TEXT NOT NULL DEFAULT '#5dd000',
                    SortOrder INTEGER NOT NULL DEFAULT 0,
                    IsDeletable INTEGER NOT NULL DEFAULT 1,
                    CreatedAtUtc TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS comments (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ItemId TEXT NOT NULL,
                    UserId TEXT NOT NULL,
                    TimestampTicks INTEGER NOT NULL DEFAULT 0,
                    CategoryId INTEGER NULL,
                    Body TEXT NOT NULL,
                    ParentCommentId INTEGER NULL,
                    Status TEXT NOT NULL DEFAULT 'open',
                    IsPrivate INTEGER NOT NULL DEFAULT 0,
                    IsPinned INTEGER NOT NULL DEFAULT 0,
                    CreatedAtUtc TEXT NOT NULL,
                    EditedAtUtc TEXT NULL,
                    DeletedAtUtc TEXT NULL,
                    FOREIGN KEY (CategoryId) REFERENCES categories(Id) ON DELETE SET NULL,
                    FOREIGN KEY (ParentCommentId) REFERENCES comments(Id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_comments_item ON comments(ItemId);
                CREATE INDEX IF NOT EXISTS idx_comments_item_ts ON comments(ItemId, TimestampTicks);

                CREATE TABLE IF NOT EXISTS comment_likes (
                    CommentId INTEGER NOT NULL,
                    UserId TEXT NOT NULL,
                    CreatedAtUtc TEXT NOT NULL,
                    PRIMARY KEY (CommentId, UserId)
                );

                CREATE TABLE IF NOT EXISTS user_roles (
                    UserId TEXT PRIMARY KEY,
                    Role TEXT NOT NULL DEFAULT 'guest',
                    UpdatedAtUtc TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS youtube_mapping (
                    ItemId TEXT PRIMARY KEY,
                    VideoId TEXT NULL,
                    Status TEXT NOT NULL DEFAULT 'not_linked',
                    ChannelTitle TEXT NULL,
                    MatchedByName INTEGER NOT NULL DEFAULT 0,
                    LastCheckedUtc TEXT NULL,
                    UpdatedAtUtc TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS notifications (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    UserId TEXT NOT NULL,
                    Type TEXT NOT NULL,
                    CommentId INTEGER NULL,
                    ItemId TEXT NOT NULL,
                    ReadAtUtc TEXT NULL,
                    CreatedAtUtc TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(UserId, ReadAtUtc);
                """;
            cmd.ExecuteNonQuery();
            _initialized = true;

            SeedDefaultCategories(conn);
        }
    }

    private void SeedDefaultCategories(SqliteConnection conn)
    {
        using var countCmd = conn.CreateCommand();
        countCmd.CommandText = "SELECT COUNT(*) FROM categories";
        if (Convert.ToInt32(countCmd.ExecuteScalar()) > 0)
        {
            return;
        }

        var defaults = Plugin.Instance?.Configuration.DefaultCategories
                       ?? new[] { "roteiro", "montagem", "cor", "tema", "geral" };
        var colors = new[] { "#5dd000", "#00a3e0", "#e87c00", "#a855f7", "#e0e0e0" };

        for (var i = 0; i < defaults.Length; i++)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT INTO categories (Name, Color, SortOrder, IsDeletable, CreatedAtUtc)
                VALUES (@name, @color, @sort, 1, @now)
                """;
            cmd.Parameters.AddWithValue("@name", defaults[i]);
            cmd.Parameters.AddWithValue("@color", colors[i % colors.Length]);
            cmd.Parameters.AddWithValue("@sort", i);
            cmd.Parameters.AddWithValue("@now", DateTime.UtcNow.ToString(DateFormat));
            cmd.ExecuteNonQuery();
        }

        _logger.LogInformation("Categorias padrão criadas: {Count}", defaults.Length);
    }

    // ============================================================
    // Categories
    // ============================================================

    public List<Category> ListCategories()
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT Id, Name, Color, SortOrder, IsDeletable, CreatedAtUtc
            FROM categories ORDER BY SortOrder, Name
            """;
        var result = new List<Category>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            result.Add(ReadCategory(reader));
        }

        return result;
    }

    public Category? GetCategory(long id)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id, Name, Color, SortOrder, IsDeletable, CreatedAtUtc FROM categories WHERE Id = @id";
        cmd.Parameters.AddWithValue("@id", id);
        using var reader = cmd.ExecuteReader();
        return reader.Read() ? ReadCategory(reader) : null;
    }

    public Category CreateCategory(string name, string color, int sortOrder)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO categories (Name, Color, SortOrder, IsDeletable, CreatedAtUtc)
            VALUES (@name, @color, @sort, 1, @now);
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("@name", name);
        cmd.Parameters.AddWithValue("@color", color);
        cmd.Parameters.AddWithValue("@sort", sortOrder);
        cmd.Parameters.AddWithValue("@now", DateTime.UtcNow.ToString(DateFormat));
        var id = Convert.ToInt64(cmd.ExecuteScalar());
        return GetCategory(id)!;
    }

    public bool UpdateCategory(long id, string? name, string? color, int? sortOrder)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE categories SET Name = COALESCE(@name, Name), Color = COALESCE(@color, Color), SortOrder = COALESCE(@sort, SortOrder) WHERE Id = @id";
        cmd.Parameters.AddWithValue("@name", (object?)name ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@color", (object?)color ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@sort", (object?)sortOrder ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@id", id);
        return cmd.ExecuteNonQuery() > 0;
    }

    public bool DeleteCategory(long id)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM categories WHERE Id = @id AND IsDeletable = 1";
        cmd.Parameters.AddWithValue("@id", id);
        return cmd.ExecuteNonQuery() > 0;
    }

    // ============================================================
    // Comments
    // ============================================================

    /// <summary>
    /// Lista comentários de um item. Filtros: categoria, incluir resolvidos,
    /// incluir privados (só produtores), somente os meus, e ordenação.
    /// </summary>
    public List<Comment> ListComments(
        string itemId,
        long? categoryId = null,
        bool includeResolved = true,
        bool includePrivate = false,
        string? onlyMine = null,
        string sortBy = "time",      // time | likes | recent
        long? parentCommentId = null)
    {
        Initialize();
        var sql = new StringBuilder("""
            SELECT c.Id, c.ItemId, c.UserId, c.TimestampTicks, c.CategoryId, c.Body,
                   c.ParentCommentId, c.Status, c.IsPrivate, c.IsPinned, c.CreatedAtUtc,
                   c.EditedAtUtc, c.DeletedAtUtc,
                   (SELECT COUNT(*) FROM comment_likes cl WHERE cl.CommentId = c.Id) AS LikeCount,
                   (SELECT COUNT(*) FROM comments r WHERE r.ParentCommentId = c.Id AND r.DeletedAtUtc IS NULL) AS ReplyCount
            FROM comments c
            WHERE c.ItemId = @itemId AND c.DeletedAtUtc IS NULL
            """);
        if (categoryId.HasValue)
        {
            sql.Append(" AND c.CategoryId = @categoryId");
        }

        if (!includeResolved)
        {
            sql.Append(" AND c.Status != 'resolved'");
        }

        if (!includePrivate)
        {
            sql.Append(" AND c.IsPrivate = 0");
        }

        if (!string.IsNullOrEmpty(onlyMine))
        {
            sql.Append(" AND c.UserId = @onlyMine");
        }

        if (parentCommentId.HasValue)
        {
            sql.Append(" AND c.ParentCommentId = @parentCommentId");
        }

        sql.Append(sortBy switch
        {
            "likes" => " ORDER BY c.IsPinned DESC, LikeCount DESC, c.TimestampTicks",
            "recent" => " ORDER BY c.IsPinned DESC, c.CreatedAtUtc DESC",
            _ => " ORDER BY c.IsPinned DESC, c.TimestampTicks, c.Id"
        });

        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql.ToString();
        cmd.Parameters.AddWithValue("@itemId", itemId);
        if (categoryId.HasValue)
        {
            cmd.Parameters.AddWithValue("@categoryId", categoryId.Value);
        }

        if (!string.IsNullOrEmpty(onlyMine))
        {
            cmd.Parameters.AddWithValue("@onlyMine", onlyMine);
        }

        if (parentCommentId.HasValue)
        {
            cmd.Parameters.AddWithValue("@parentCommentId", parentCommentId.Value);
        }

        var result = new List<Comment>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            result.Add(ReadComment(reader));
        }

        return result;
    }

    public Comment? GetComment(long id)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT c.Id, c.ItemId, c.UserId, c.TimestampTicks, c.CategoryId, c.Body,
                   c.ParentCommentId, c.Status, c.IsPrivate, c.IsPinned, c.CreatedAtUtc,
                   c.EditedAtUtc, c.DeletedAtUtc,
                   (SELECT COUNT(*) FROM comment_likes cl WHERE cl.CommentId = c.Id) AS LikeCount,
                   (SELECT COUNT(*) FROM comments r WHERE r.ParentCommentId = c.Id AND r.DeletedAtUtc IS NULL) AS ReplyCount
            FROM comments c WHERE c.Id = @id AND c.DeletedAtUtc IS NULL
            """;
        cmd.Parameters.AddWithValue("@id", id);
        using var reader = cmd.ExecuteReader();
        return reader.Read() ? ReadComment(reader) : null;
    }

    public Comment CreateComment(
        string itemId, string userId, long timestampTicks, long? categoryId,
        string body, long? parentCommentId, bool isPrivate, CommentStatus status)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO comments (ItemId, UserId, TimestampTicks, CategoryId, Body, ParentCommentId, Status, IsPrivate, IsPinned, CreatedAtUtc)
            VALUES (@itemId, @userId, @ts, @categoryId, @body, @parent, @status, @isPrivate, 0, @now);
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("@itemId", itemId);
        cmd.Parameters.AddWithValue("@userId", userId);
        cmd.Parameters.AddWithValue("@ts", timestampTicks);
        cmd.Parameters.AddWithValue("@categoryId", (object?)categoryId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@body", body);
        cmd.Parameters.AddWithValue("@parent", (object?)parentCommentId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@status", StatusToString(status));
        cmd.Parameters.AddWithValue("@isPrivate", isPrivate ? 1 : 0);
        cmd.Parameters.AddWithValue("@now", DateTime.UtcNow.ToString(DateFormat));
        var id = Convert.ToInt64(cmd.ExecuteScalar());
        return GetComment(id)!;
    }

    public bool UpdateComment(long id, string? body, long? categoryId, CommentStatus? status, bool? isPrivate)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            UPDATE comments
            SET Body = COALESCE(@body, Body),
                CategoryId = COALESCE(@categoryId, CategoryId),
                Status = COALESCE(@status, Status),
                IsPrivate = COALESCE(@isPrivate, IsPrivate),
                EditedAtUtc = @now
            WHERE Id = @id
            """;
        cmd.Parameters.AddWithValue("@body", (object?)body ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@categoryId", (object?)categoryId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@status", status.HasValue ? StatusToString(status.Value) : (object?)DBNull.Value);
        cmd.Parameters.AddWithValue("@isPrivate", isPrivate.HasValue ? (isPrivate.Value ? 1 : 0) : (object?)DBNull.Value);
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.AddWithValue("@now", DateTime.UtcNow.ToString(DateFormat));
        return cmd.ExecuteNonQuery() > 0;
    }

    public bool SoftDeleteComment(long id)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE comments SET DeletedAtUtc = @now WHERE Id = @id";
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.AddWithValue("@now", DateTime.UtcNow.ToString(DateFormat));
        return cmd.ExecuteNonQuery() > 0;
    }

    public bool SetCommentPinned(long id, bool pinned)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE comments SET IsPinned = @pinned WHERE Id = @id";
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.AddWithValue("@pinned", pinned ? 1 : 0);
        return cmd.ExecuteNonQuery() > 0;
    }

    /// <summary>Conta comentários "abertos" (pendentes) de um item — para o badge do cliente.</summary>
    public int PendingCount(string itemId)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM comments WHERE ItemId = @itemId AND DeletedAtUtc IS NULL AND Status != 'resolved'";
        cmd.Parameters.AddWithValue("@itemId", itemId);
        return Convert.ToInt32(cmd.ExecuteScalar());
    }

    // ============================================================
    // Likes
    // ============================================================

    public bool IsLiked(long commentId, string userId)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM comment_likes WHERE CommentId = @commentId AND UserId = @userId";
        cmd.Parameters.AddWithValue("@commentId", commentId);
        cmd.Parameters.AddWithValue("@userId", userId);
        return Convert.ToInt32(cmd.ExecuteScalar()) > 0;
    }

    public bool Like(long commentId, string userId)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT OR IGNORE INTO comment_likes (CommentId, UserId, CreatedAtUtc)
            VALUES (@commentId, @userId, @now)
            """;
        cmd.Parameters.AddWithValue("@commentId", commentId);
        cmd.Parameters.AddWithValue("@userId", userId);
        cmd.Parameters.AddWithValue("@now", DateTime.UtcNow.ToString(DateFormat));
        return cmd.ExecuteNonQuery() > 0;
    }

    public bool Unlike(long commentId, string userId)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM comment_likes WHERE CommentId = @commentId AND UserId = @userId";
        cmd.Parameters.AddWithValue("@commentId", commentId);
        cmd.Parameters.AddWithValue("@userId", userId);
        return cmd.ExecuteNonQuery() > 0;
    }

    // ============================================================
    // Roles
    // ============================================================

    public GoiasTecRole GetRole(string userId)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Role FROM user_roles WHERE UserId = @userId";
        cmd.Parameters.AddWithValue("@userId", userId);
        var value = cmd.ExecuteScalar() as string;
        return ParseRole(value);
    }

    public bool SetRole(string userId, GoiasTecRole role)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO user_roles (UserId, Role, UpdatedAtUtc)
            VALUES (@userId, @role, @now)
            ON CONFLICT(UserId) DO UPDATE SET Role = @role, UpdatedAtUtc = @now
            """;
        cmd.Parameters.AddWithValue("@userId", userId);
        cmd.Parameters.AddWithValue("@role", RoleToString(role));
        cmd.Parameters.AddWithValue("@now", DateTime.UtcNow.ToString(DateFormat));
        return cmd.ExecuteNonQuery() > 0;
    }

    public Dictionary<string, GoiasTecRole> ListRoles()
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT UserId, Role FROM user_roles";
        var result = new Dictionary<string, GoiasTecRole>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            result[reader.GetString(0)] = ParseRole(reader.GetString(1));
        }

        return result;
    }

    // ============================================================
    // YouTube mapping
    // ============================================================

    public YoutubeMapping? GetMapping(string itemId)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT ItemId, VideoId, Status, ChannelTitle, MatchedByName, LastCheckedUtc, UpdatedAtUtc
            FROM youtube_mapping WHERE ItemId = @itemId
            """;
        cmd.Parameters.AddWithValue("@itemId", itemId);
        using var reader = cmd.ExecuteReader();
        return reader.Read() ? ReadMapping(reader) : null;
    }

    public void SetMapping(string itemId, string? videoId, string status, string? channelTitle = null, bool matchedByName = false)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO youtube_mapping (ItemId, VideoId, Status, ChannelTitle, MatchedByName, LastCheckedUtc, UpdatedAtUtc)
            VALUES (@itemId, @videoId, @status, @channelTitle, @matched, @checked, @now)
            ON CONFLICT(ItemId) DO UPDATE SET
                VideoId = @videoId,
                Status = @status,
                ChannelTitle = COALESCE(@channelTitle, ChannelTitle),
                MatchedByName = @matched,
                LastCheckedUtc = @checked,
                UpdatedAtUtc = @now
            """;
        cmd.Parameters.AddWithValue("@itemId", itemId);
        cmd.Parameters.AddWithValue("@videoId", (object?)videoId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@status", status);
        cmd.Parameters.AddWithValue("@channelTitle", (object?)channelTitle ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@matched", matchedByName ? 1 : 0);
        cmd.Parameters.AddWithValue("@checked", DateTime.UtcNow.ToString(DateFormat));
        cmd.Parameters.AddWithValue("@now", DateTime.UtcNow.ToString(DateFormat));
        cmd.ExecuteNonQuery();
    }

    public List<YoutubeMapping> ListMappings()
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT ItemId, VideoId, Status, ChannelTitle, MatchedByName, LastCheckedUtc, UpdatedAtUtc
            FROM youtube_mapping
            """;
        var result = new List<YoutubeMapping>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            result.Add(ReadMapping(reader));
        }

        return result;
    }

    // ============================================================
    // Notifications
    // ============================================================

    public long CreateNotification(string userId, string type, long? commentId, string itemId)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO notifications (UserId, Type, CommentId, ItemId, ReadAtUtc, CreatedAtUtc)
            VALUES (@userId, @type, @commentId, @itemId, NULL, @now);
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("@userId", userId);
        cmd.Parameters.AddWithValue("@type", type);
        cmd.Parameters.AddWithValue("@commentId", (object?)commentId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@itemId", itemId);
        cmd.Parameters.AddWithValue("@now", DateTime.UtcNow.ToString(DateFormat));
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    public List<Notification> ListNotifications(string userId, bool unreadOnly, int limit = 50)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = unreadOnly
            ? "SELECT Id, UserId, Type, CommentId, ItemId, ReadAtUtc, CreatedAtUtc FROM notifications WHERE UserId = @userId AND ReadAtUtc IS NULL ORDER BY Id DESC LIMIT @limit"
            : "SELECT Id, UserId, Type, CommentId, ItemId, ReadAtUtc, CreatedAtUtc FROM notifications WHERE UserId = @userId ORDER BY Id DESC LIMIT @limit";
        cmd.Parameters.AddWithValue("@userId", userId);
        cmd.Parameters.AddWithValue("@limit", limit);
        var result = new List<Notification>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            result.Add(ReadNotification(reader));
        }

        return result;
    }

    public int UnreadCount(string userId)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM notifications WHERE UserId = @userId AND ReadAtUtc IS NULL";
        cmd.Parameters.AddWithValue("@userId", userId);
        return Convert.ToInt32(cmd.ExecuteScalar());
    }

    public int MarkRead(string userId, long? id = null)
    {
        Initialize();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = id.HasValue
            ? "UPDATE notifications SET ReadAtUtc = @now WHERE UserId = @userId AND Id = @id AND ReadAtUtc IS NULL"
            : "UPDATE notifications SET ReadAtUtc = @now WHERE UserId = @userId AND ReadAtUtc IS NULL";
        cmd.Parameters.AddWithValue("@userId", userId);
        cmd.Parameters.AddWithValue("@now", DateTime.UtcNow.ToString(DateFormat));
        if (id.HasValue)
        {
            cmd.Parameters.AddWithValue("@id", id.Value);
        }

        return cmd.ExecuteNonQuery();
    }

    // ============================================================
    // Helpers
    // ============================================================

    internal static string StatusToString(CommentStatus status) => status switch
    {
        CommentStatus.InReview => "in_review",
        CommentStatus.Resolved => "resolved",
        _ => "open"
    };

    internal static CommentStatus ParseStatus(string? value) => value switch
    {
        "in_review" => CommentStatus.InReview,
        "resolved" => CommentStatus.Resolved,
        _ => CommentStatus.Open
    };

    internal static string RoleToString(GoiasTecRole role) => role switch
    {
        GoiasTecRole.SuperAdmin => "superadmin",
        GoiasTecRole.Admin => "admin",
        GoiasTecRole.Editor => "editor",
        _ => "guest"
    };

    internal static GoiasTecRole ParseRole(string? value) => value switch
    {
        "superadmin" => GoiasTecRole.SuperAdmin,
        "admin" => GoiasTecRole.Admin,
        "editor" => GoiasTecRole.Editor,
        _ => GoiasTecRole.Guest
    };

    private static Category ReadCategory(SqliteDataReader reader) => new()
    {
        Id = reader.GetInt64(0),
        Name = reader.GetString(1),
        Color = reader.GetString(2),
        SortOrder = reader.GetInt32(3),
        IsDeletable = reader.GetInt64(4) == 1,
        CreatedAtUtc = ParseDate(reader, 5)
    };

    private static Comment ReadComment(SqliteDataReader reader) => new()
    {
        Id = reader.GetInt64(0),
        ItemId = reader.GetString(1),
        UserId = reader.GetString(2),
        TimestampTicks = reader.GetInt64(3),
        CategoryId = reader.IsDBNull(4) ? null : reader.GetInt64(4),
        Body = reader.GetString(5),
        ParentCommentId = reader.IsDBNull(6) ? null : reader.GetInt64(6),
        Status = ParseStatus(reader.GetString(7)),
        IsPrivate = reader.GetInt64(8) == 1,
        IsPinned = reader.GetInt64(9) == 1,
        CreatedAtUtc = ParseDate(reader, 10),
        EditedAtUtc = reader.IsDBNull(11) ? null : ParseDate(reader, 11),
        DeletedAtUtc = reader.IsDBNull(12) ? null : ParseDate(reader, 12),
        LikeCount = reader.GetInt32(13),
        ReplyCount = reader.GetInt32(14)
    };

    private static YoutubeMapping ReadMapping(SqliteDataReader reader) => new()
    {
        ItemId = reader.GetString(0),
        VideoId = reader.IsDBNull(1) ? null : reader.GetString(1),
        Status = reader.GetString(2),
        ChannelTitle = reader.IsDBNull(3) ? null : reader.GetString(3),
        MatchedByName = reader.GetInt64(4) == 1,
        LastCheckedUtc = reader.IsDBNull(5) ? null : ParseDate(reader, 5),
        UpdatedAtUtc = ParseDate(reader, 6)
    };

    private static Notification ReadNotification(SqliteDataReader reader) => new()
    {
        Id = reader.GetInt64(0),
        UserId = reader.GetString(1),
        Type = reader.GetString(2),
        CommentId = reader.IsDBNull(3) ? null : reader.GetInt64(3),
        ItemId = reader.GetString(4),
        ReadAtUtc = reader.IsDBNull(5) ? null : ParseDate(reader, 5),
        CreatedAtUtc = ParseDate(reader, 6)
    };

    private static DateTime ParseDate(SqliteDataReader reader, int index)
        => DateTime.Parse(reader.GetString(index), null, System.Globalization.DateTimeStyles.RoundtripKind);
}
