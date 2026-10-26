using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Batzio.Core.Local;
using Batzio.Core.Models;
using static Batzio.Core.Localization.Loc;

namespace Batzio.Core.Api;

public sealed class ApiException(int status, string code, string message, Dictionary<string, string>? fields = null) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public Dictionary<string, string> Fields { get; } = fields ?? [];
    public bool IsUnauthorized => Status == 401;
}

/// <summary>A file to upload (attachments, drops, bank statements).</summary>
public sealed record UploadFile(string Name, string MimeType, byte[] Bytes);

public sealed record Download(byte[] Bytes, string FileName, string MimeType);

/// <summary>
/// Talks to a Batzio server: <c>Authorization: Bearer &lt;session&gt;</c>, <c>X-Tenant</c> for the chosen
/// company and <c>Accept-Language</c> so every text comes back translated.
/// </summary>
public sealed class ApiClient(string baseUrl, string? token = null, string? tenant = null, string locale = "en", string mode = "simple", HttpClient? http = null)
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(10) };

    public string BaseUrl { get; } = baseUrl.TrimEnd('/');
    public string? Token { get; } = token;
    public string? Tenant { get; } = tenant;
    public string Locale { get; } = locale;
    public string Mode { get; } = mode;

    public Uri Url(string path, IDictionary<string, string?>? query = null)
    {
        var parts = (query ?? new Dictionary<string, string?>())
            .Where(kv => kv.Value is not null)
            .OrderBy(kv => kv.Key, StringComparer.Ordinal)
            .Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value!)}")
            .Append($"locale={Locale}");
        return new Uri($"{BaseUrl}{path}?{string.Join("&", parts)}");
    }

    /// <summary>A request can be sent only once; a retry sends this copy (same headers, same key, same body).</summary>
    private static async Task<HttpRequestMessage> Copy(HttpRequestMessage request)
    {
        var copy = new HttpRequestMessage(request.Method, request.RequestUri);
        foreach (var h in request.Headers) copy.Headers.TryAddWithoutValidation(h.Key, h.Value);
        if (request.Content is not null)
        {
            var bytes = await request.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
            copy.Content = new ByteArrayContent(bytes);
            foreach (var h in request.Content.Headers) copy.Content.Headers.TryAddWithoutValidation(h.Key, h.Value);
        }
        return copy;
    }

    /// <summary>"Batzio-Windows/0.1.0 (Windows 10.0.26100)": the audit log shows which app made a change.</summary>
    public static readonly string UserAgent = $"Batzio-Windows/{typeof(ApiClient).Assembly.GetName().Version?.ToString(3) ?? "0"} ({System.Runtime.InteropServices.RuntimeInformation.OSDescription})";

    private static string V1(string path) => path.StartsWith("/api/", StringComparison.Ordinal) ? path : "/api/v1" + path;

    public HttpRequestMessage Request(HttpMethod method, string path, IDictionary<string, string?>? query = null)
    {
        var r = new HttpRequestMessage(method, Url(path, query));
        r.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        r.Headers.AcceptLanguage.Add(new StringWithQualityHeaderValue(Locale));
        r.Headers.TryAddWithoutValidation("User-Agent", UserAgent);
        // A write sent twice (a retry after a dropped connection) is answered once.
        if (method != HttpMethod.Get) r.Headers.TryAddWithoutValidation("Idempotency-Key", Guid.NewGuid().ToString());
        if (Token is not null) r.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        if (Tenant is not null) r.Headers.Add("X-Tenant", Tenant);
        return r;
    }

    /// <summary>On this device, requests go to the engine instead of the network.</summary>
    public bool IsOnDevice => LocalEngine.IsOnDevice(BaseUrl);

    private async Task<HttpResponseMessage> Execute(HttpRequestMessage request, HttpCompletionOption completion = HttpCompletionOption.ResponseContentRead, CancellationToken ct = default)
    {
        HttpResponseMessage response;
        try
        {
            if (http is null && IsOnDevice)
            {
                using var local = new HttpClient(LocalEngine.Current.Handler()) { Timeout = TimeSpan.FromMinutes(10) };
                response = await local.SendAsync(request, completion, ct).ConfigureAwait(false);
            }
            else
            {
                var client = http ?? Http;
                var copy = request.Headers.Contains("Idempotency-Key") ? await Copy(request).ConfigureAwait(false) : null;
                try
                {
                    response = await client.SendAsync(request, completion, ct).ConfigureAwait(false);
                }
                catch (HttpRequestException) when (copy is not null)
                {
                    // Safe to send again: the same key makes the server answer the first attempt.
                    await Task.Delay(1000, ct).ConfigureAwait(false);
                    response = await client.SendAsync(copy, completion, ct).ConfigureAwait(false);
                }
            }
        }
        catch (HttpRequestException)
        {
            throw new ApiException(0, "offline", L("Batzio can’t be reached. Check your connection and the server address."));
        }
        catch (Exception e) when (IsOnDevice && e is not OperationCanceledException)
        {
            throw new ApiException(500, "local", e.Message);
        }
        if (response.IsSuccessStatusCode) return response;
        var text = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        string code = $"http_{(int)response.StatusCode}", message = response.ReasonPhrase ?? code;
        Dictionary<string, string>? fields = null;
        try
        {
            var error = JsonNode.Parse(text)?["error"];
            code = error?["code"].Str() ?? code;
            message = error?["message"].Str() ?? message;
            fields = error?["fields"]?.Deserialize<Dictionary<string, string>>(Json.Options);
        }
        catch (JsonException) { }
        response.Dispose();
        throw new ApiException((int)response.StatusCode, code, message, fields);
    }

    private static async Task<T> Decode<T>(HttpResponseMessage response)
    {
        using (response)
        {
            var node = JsonNode.Parse(await response.Content.ReadAsStringAsync().ConfigureAwait(false));
            return node!["data"].To<T>()!;
        }
    }

    public async Task<T> GetAsync<T>(string path, IDictionary<string, string?>? query = null) =>
        await Decode<T>(await Execute(Request(HttpMethod.Get, V1(path), query)));

    public async Task<T> SendAsync<T>(string method, string path, JsonNode? body = null, IDictionary<string, string?>? query = null)
    {
        var r = Request(new HttpMethod(method), V1(path), query);
        r.Content = new StringContent((body ?? new JsonObject()).ToJsonString(Json.Options), Encoding.UTF8, "application/json");
        return await Decode<T>(await Execute(r));
    }

    public async Task<Download> DownloadAsync(string path, IDictionary<string, string?>? query = null)
    {
        var r = Request(HttpMethod.Get, V1(path), query);
        r.Headers.Accept.Clear();
        r.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("*/*"));
        using var response = await Execute(r);
        var name = response.Content.Headers.ContentDisposition?.FileNameStar ?? response.Content.Headers.ContentDisposition?.FileName?.Trim('"') ?? path.Split('/').Last();
        return new Download(await response.Content.ReadAsByteArrayAsync(), name, response.Content.Headers.ContentType?.MediaType ?? "application/octet-stream");
    }

    public async Task<T> UploadAsync<T>(string path, IEnumerable<UploadFile> files, string fileField = "files", IDictionary<string, string>? fields = null, IDictionary<string, string?>? query = null)
    {
        var form = new MultipartFormDataContent();
        foreach (var (k, v) in fields ?? new Dictionary<string, string>()) form.Add(new StringContent(v), k);
        foreach (var f in files)
        {
            var content = new ByteArrayContent(f.Bytes);
            content.Headers.ContentType = new MediaTypeHeaderValue(f.MimeType);
            form.Add(content, fileField, f.Name);
        }
        var r = Request(HttpMethod.Post, V1(path), query);
        r.Content = form;
        return await Decode<T>(await Execute(r));
    }

    public async Task<T> SendRawAsync<T>(string path, byte[] body, string contentType, IDictionary<string, string?>? query = null)
    {
        var r = Request(HttpMethod.Post, V1(path), query);
        r.Content = new ByteArrayContent(body);
        r.Content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return await Decode<T>(await Execute(r));
    }

    /// <summary>Streams Batzi's work as it happens (NDJSON from <c>/api/agent</c>).</summary>
    public async IAsyncEnumerable<AgentEvent> AgentAsync(JsonObject body, [EnumeratorCancellation] CancellationToken ct = default)
    {
        body["locale"] ??= Locale;
        var r = Request(HttpMethod.Post, "/api/agent");
        r.Headers.Accept.Clear();
        r.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/x-ndjson"));
        r.Content = new StringContent(body.ToJsonString(Json.Options), Encoding.UTF8, "application/json");
        using var response = await Execute(r, HttpCompletionOption.ResponseHeadersRead, ct);
        using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream, Encoding.UTF8);
        while (await reader.ReadLineAsync(ct) is { } line)
        {
            if (AgentEvent.Parse(line) is { } e) yield return e;
        }
    }
}

/// <summary>One line of Batzi's stream.</summary>
public abstract record AgentEvent
{
    public sealed record Thread(string Id) : AgentEvent;
    public sealed record Text(string Delta) : AgentEvent;
    public sealed record Update(string Message) : AgentEvent;
    public sealed record Tool(ToolOutcome Outcome) : AgentEvent;
    public sealed record Done(bool Refused) : AgentEvent;
    public sealed record Error(string Message) : AgentEvent;

    public static AgentEvent? Parse(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return null;
        JsonNode? o;
        try { o = JsonNode.Parse(line); } catch (JsonException) { return null; }
        return o?["type"].Str() switch
        {
            "thread" => o["threadId"].Str() is { } id ? new Thread(id) : null,
            "text" => new Text(o["delta"].Str() ?? ""),
            "update" => new Update(o["text"].Str() ?? ""),
            "tool" => o["outcome"].To<ToolOutcome>() is { } t ? new Tool(t) : null,
            "done" => new Done(o["refused"].Bool() ?? false),
            "error" => new Error(o["message"].Str() ?? ""),
            _ => null,
        };
    }
}
