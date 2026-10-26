using System.Net;
using System.Net.Http.Headers;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.ClearScript.V8;

namespace Batzio.Core.Local;

/// <summary>
/// Batzio without a server: the engine (<c>packages/local</c>, one script embedded in this
/// assembly) runs in V8 on SQLite files in <see cref="Directory"/> — <c>control.sqlite</c> for
/// accounts, <c>tenant-NNN.sqlite</c> per company and <c>files\</c> for attachments. The app
/// reaches it through the same REST API as online, at <see cref="Origin"/>.
/// </summary>
public sealed partial class LocalEngine : IDisposable
{
    public const string Origin = "https://device.batzio.local";

    private static LocalEngine? _current;
    private static readonly Lock CurrentLock = new();

    private readonly V8ScriptEngine _engine;
    private readonly Bridge _bridge;
    private readonly Lock _gate = new();
    private long _nextId;

    public string Directory { get; }

    public LocalEngine(string directory, int tenantSlots = 20, string? script = null)
    {
        Directory = directory;
        System.IO.Directory.CreateDirectory(Path.Combine(directory, "files"));
        _bridge = new Bridge(directory);
        _engine = new V8ScriptEngine(V8ScriptEngineFlags.DisableGlobalMembers);
        _engine.AddHostObject("__batzio_host", _bridge);
        _engine.Execute("batzio-local.js", script ?? EmbeddedScript());
        _engine.Execute($"BatzioLocal.configure('{{\"tenantSlots\":{tenantSlots}}}')");
    }

    /// <summary>The default place for on-device data: %LOCALAPPDATA%\Batzio\On this device.</summary>
    public static string DefaultDirectory() =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Batzio", "On this device");

    public static bool IsOnDevice(string baseUrl) => baseUrl.TrimEnd('/') == Origin;

    /// <summary>The engine for <see cref="DefaultDirectory"/>, started on first use.</summary>
    public static LocalEngine Current
    {
        get
        {
            lock (CurrentLock) return _current ??= new LocalEngine(DefaultDirectory());
        }
    }

    /// <summary>Stops the shared engine and closes its files (before deleting them).</summary>
    public static void Shutdown()
    {
        lock (CurrentLock)
        {
            _current?.Dispose();
            _current = null;
        }
    }

    private static string EmbeddedScript()
    {
        using var stream = typeof(LocalEngine).Assembly.GetManifestResourceStream("Batzio.Core.batzio-local.js")
            ?? throw new InvalidOperationException("The on-device engine is missing from this build.");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return reader.ReadToEnd();
    }

    /// <summary>Handles one request (<c>{method, url, headers, body}</c> as JSON) and returns the engine's JSON answer.</summary>
    public string Dispatch(string wire)
    {
        lock (_gate)
        {
            var id = (++_nextId).ToString(System.Globalization.CultureInfo.InvariantCulture);
            _engine.Script.BatzioLocal.dispatch(id, wire);
            // V8 runs the engine's promise jobs before the call returns: every host call is
            // synchronous, so the answer is already here.
            return _bridge.Take(id) ?? throw new InvalidOperationException("The on-device engine did not answer.");
        }
    }

    /// <summary>An <see cref="HttpMessageHandler"/> whose requests never touch the network.</summary>
    public HttpMessageHandler Handler() => new EngineHandler(this);

    public void Dispose()
    {
        _engine.Dispose();
        _bridge.Dispose();
    }

    private sealed class EngineHandler(LocalEngine engine) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var headers = new JsonArray();
            foreach (var h in request.Headers) headers.Add(new JsonArray(h.Key, string.Join(", ", h.Value)));
            byte[]? body = null;
            if (request.Content is not null)
            {
                foreach (var h in request.Content.Headers) headers.Add(new JsonArray(h.Key, string.Join(", ", h.Value)));
                body = await request.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
            }
            var wire = new JsonObject
            {
                ["method"] = request.Method.Method,
                ["url"] = request.RequestUri!.ToString(),
                ["headers"] = headers,
                ["body"] = body is null ? null : Convert.ToBase64String(body),
            }.ToJsonString();
            var reply = JsonNode.Parse(await Task.Run(() => engine.Dispatch(wire), ct).ConfigureAwait(false))!;
            var response = new HttpResponseMessage((HttpStatusCode)(reply["status"]?.GetValue<int>() ?? 500))
            {
                RequestMessage = request,
                Content = new ByteArrayContent(Convert.FromBase64String(reply["body"]?.GetValue<string>() ?? "")),
            };
            foreach (var pair in reply["headers"]?.AsArray() ?? [])
            {
                var key = pair![0]!.GetValue<string>();
                var value = pair[1]!.GetValue<string>();
                if (!response.Headers.TryAddWithoutValidation(key, value)) response.Content.Headers.TryAddWithoutValidation(key, value);
            }
            return response;
        }
    }

    /// <summary>What the engine calls back into (packages/local/src/host-api.ts).</summary>
    public sealed partial class Bridge(string directory) : IDisposable
    {
        private readonly Dictionary<string, SqliteFile> _databases = [];
        private readonly Dictionary<string, string> _answers = [];

        internal string? Take(string id) => _answers.Remove(id, out var answer) ? answer : null;

        private SqliteFile Database(string binding)
        {
            if (_databases.TryGetValue(binding, out var db)) return db;
            var name = binding == "DB" ? "control" : binding.Replace("TENANT_DB_", "tenant-", StringComparison.Ordinal);
            if (!DatabaseName().IsMatch(name)) throw new InvalidOperationException($"Unknown database {binding}");
            return _databases[binding] = new SqliteFile(Path.Combine(directory, $"{name}.sqlite"));
        }

        public string query(string db, string sql, string parameters) =>
            Encode(() => Database(db).Run(sql, JsonNode.Parse(parameters)?.AsArray() ?? []));

        public string batch(string db, string statements) =>
            Encode(() => Database(db).Batch(JsonNode.Parse(statements)!.AsArray()));

        /// <summary>Storage keys look like <c>&lt;tenant&gt;/&lt;uuid&gt;/&lt;name&gt;</c>; every segment is kept to safe characters.</summary>
        private string? FilePath(string key)
        {
            var segments = key.Split('/').Select(s => string.Concat(s.Select(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' ? c.ToString() : $"%{(int)c:x4}"))).ToArray();
            if (segments.Length == 0 || segments.Any(s => s is "" or "." or "..")) return null;
            return Path.Combine([directory, "files", .. segments]);
        }

        public string? fileGet(string key)
        {
            var path = FilePath(key);
            if (path is null || !File.Exists(path)) return null;
            var type = File.Exists(path + ".content-type") ? File.ReadAllText(path + ".content-type") : "application/octet-stream";
            return new JsonObject { ["data"] = Convert.ToBase64String(File.ReadAllBytes(path)), ["type"] = type }.ToJsonString();
        }

        public void filePut(string key, string data, string type)
        {
            var path = FilePath(key);
            if (path is null) return;
            System.IO.Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllBytes(path, Convert.FromBase64String(data));
            File.WriteAllText(path + ".content-type", type);
        }

        public void fileDelete(string key)
        {
            var path = FilePath(key);
            if (path is null) return;
            File.Delete(path);
            File.Delete(path + ".content-type");
        }

        public string random(int n) => Convert.ToBase64String(RandomNumberGenerator.GetBytes(n));

        public string sha256(string data) => Convert.ToBase64String(SHA256.HashData(Convert.FromBase64String(data)));

        public string pbkdf2(string password, string salt, int iterations, int bits) =>
            Convert.ToBase64String(Rfc2898DeriveBytes.Pbkdf2(Convert.FromBase64String(password), Convert.FromBase64String(salt), iterations, HashAlgorithmName.SHA256, bits / 8));

        public void log(string level, string message)
        {
            if (level is "error" or "warn") System.Diagnostics.Debug.WriteLine($"[Batzio on this device] {level}: {message}");
        }

        public void respond(string id, string response) => _answers[id] = response;

        private static string Encode(Func<JsonNode> work)
        {
            try { return work().ToJsonString(); }
            catch (Exception e) when (e is InvalidOperationException or FormatException or System.Text.Json.JsonException)
            {
                return new JsonObject { ["error"] = e.Message }.ToJsonString();
            }
        }

        [GeneratedRegex(@"^(control|tenant-\d{3})$")]
        private static partial Regex DatabaseName();

        public void Dispose()
        {
            foreach (var db in _databases.Values) db.Dispose();
            _databases.Clear();
        }
    }
}
