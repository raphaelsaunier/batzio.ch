using System.Text.Json.Nodes;
using SQLitePCL;

namespace Batzio.Core.Local;

/// <summary>
/// One SQLite file, spoken to the way the on-device engine expects (D1 semantics):
/// rows as objects, the number of changed rows and the last inserted id.
/// </summary>
internal sealed class SqliteFile : IDisposable
{
    private readonly sqlite3 _db;

    static SqliteFile() => Batteries_V2.Init();

    public SqliteFile(string path)
    {
        var rc = raw.sqlite3_open_v2(path, out _db, raw.SQLITE_OPEN_READWRITE | raw.SQLITE_OPEN_CREATE, null);
        if (rc != raw.SQLITE_OK) throw new InvalidOperationException(raw.sqlite3_errmsg(_db).utf8_to_string());
        raw.sqlite3_busy_timeout(_db, 5000);
        // D1 enforces foreign keys; WAL keeps the file consistent if the app is closed mid-write.
        Execute("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    }

    public void Execute(string sql)
    {
        if (raw.sqlite3_exec(_db, sql) != raw.SQLITE_OK) throw Failure();
    }

    /// <summary>Runs one statement. Parameters come from JSON: numbers, strings, null or <c>{"$bytes": base64}</c>.</summary>
    public JsonObject Run(string sql, JsonArray parameters)
    {
        if (raw.sqlite3_prepare_v2(_db, sql, out var stmt) != raw.SQLITE_OK) throw Failure();
        using (stmt)
        {
            for (var i = 0; i < parameters.Count; i++)
            {
                var index = i + 1;
                var value = parameters[i];
                var rc = value switch
                {
                    null => raw.sqlite3_bind_null(stmt, index),
                    JsonObject o => raw.sqlite3_bind_blob(stmt, index, Convert.FromBase64String(o["$bytes"]?.GetValue<string>() ?? "")),
                    JsonValue v when v.TryGetValue<string>(out var s) => raw.sqlite3_bind_text(stmt, index, s),
                    JsonValue v when v.TryGetValue<bool>(out var b) => raw.sqlite3_bind_int64(stmt, index, b ? 1 : 0),
                    // JSON writes whole numbers without a fraction.
                    JsonValue v when v.TryGetValue<long>(out var l) => raw.sqlite3_bind_int64(stmt, index, l),
                    JsonValue v when v.TryGetValue<double>(out var d) => raw.sqlite3_bind_double(stmt, index, d),
                    _ => raw.sqlite3_bind_text(stmt, index, value.ToJsonString()),
                };
                if (rc != raw.SQLITE_OK) throw Failure();
            }

            var rows = new JsonArray();
            var columns = raw.sqlite3_column_count(stmt);
            while (true)
            {
                var rc = raw.sqlite3_step(stmt);
                if (rc == raw.SQLITE_DONE) break;
                if (rc != raw.SQLITE_ROW) throw Failure();
                var row = new JsonObject();
                for (var c = 0; c < columns; c++)
                {
                    var name = raw.sqlite3_column_name(stmt, c).utf8_to_string();
                    row[name] = raw.sqlite3_column_type(stmt, c) switch
                    {
                        raw.SQLITE_INTEGER => JsonValue.Create(raw.sqlite3_column_int64(stmt, c)),
                        raw.SQLITE_FLOAT => JsonValue.Create(raw.sqlite3_column_double(stmt, c)),
                        raw.SQLITE_TEXT => JsonValue.Create(raw.sqlite3_column_text(stmt, c).utf8_to_string()),
                        raw.SQLITE_BLOB => new JsonObject { ["$bytes"] = Convert.ToBase64String(raw.sqlite3_column_blob(stmt, c).ToArray()) },
                        _ => null,
                    };
                }
                rows.Add(row);
            }
            var readOnly = raw.sqlite3_stmt_readonly(stmt) != 0;
            return new JsonObject
            {
                ["rows"] = rows,
                ["changes"] = readOnly ? 0 : raw.sqlite3_changes(_db),
                ["lastRowId"] = readOnly ? 0 : raw.sqlite3_last_insert_rowid(_db),
            };
        }
    }

    /// <summary>Runs statements in one transaction (D1 batches are atomic).</summary>
    public JsonArray Batch(JsonArray statements)
    {
        Execute("BEGIN IMMEDIATE");
        try
        {
            var results = new JsonArray();
            foreach (var s in statements)
                results.Add(Run(s!["sql"]!.GetValue<string>(), s["params"] as JsonArray ?? []));
            Execute("COMMIT");
            return results;
        }
        catch
        {
            try { Execute("ROLLBACK"); } catch (InvalidOperationException) { }
            throw;
        }
    }

    private InvalidOperationException Failure() => new(raw.sqlite3_errmsg(_db).utf8_to_string());

    public void Dispose() => _db.Dispose();
}
