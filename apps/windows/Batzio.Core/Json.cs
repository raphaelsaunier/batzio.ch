using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Batzio.Core;

/// <summary>JSON settings and helpers. Records travel as <see cref="JsonObject"/>: their shape comes from the server.</summary>
public static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    public static string? Str(this JsonNode? node) => node is JsonValue v ? v.GetValueKind() switch
    {
        JsonValueKind.String => v.GetValue<string>(),
        JsonValueKind.Number => Num(v) is { } d && d == Math.Floor(d) && Math.Abs(d) < 9e15 ? ((long)d).ToString(CultureInfo.InvariantCulture) : v.ToJsonString(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        _ => null,
    } : null;

    public static double? Num(this JsonNode? node) => node is JsonValue v ? v.GetValueKind() switch
    {
        JsonValueKind.Number => double.Parse(v.ToJsonString(), CultureInfo.InvariantCulture),
        JsonValueKind.String => double.TryParse(v.GetValue<string>(), NumberStyles.Float, CultureInfo.InvariantCulture, out var p) ? p : null,
        JsonValueKind.True => 1,
        JsonValueKind.False => 0,
        _ => null,
    } : null;

    public static int? Int(this JsonNode? node) => node.Num() is { } d ? (int)d : null;

    public static bool? Bool(this JsonNode? node) => node is JsonValue v ? v.GetValueKind() switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Number => Num(v) != 0,
        JsonValueKind.String => v.GetValue<string>() is "1" or "true" or "yes",
        _ => null,
    } : null;

    public static bool IsNull(this JsonNode? node) => node is null || (node is JsonValue v && v.GetValueKind() == JsonValueKind.Null);

    /// <summary>Plain text for display when nothing better is known.</summary>
    public static string Display(this JsonNode? node) => node switch
    {
        null => "",
        JsonArray a => string.Join(", ", a.Select(x => x.Display())),
        JsonObject => "",
        _ => node.Str() ?? "",
    };

    public static T? To<T>(this JsonNode? node) => node is null ? default : node.Deserialize<T>(Options);

    public static JsonObject Obj(params (string Key, object? Value)[] pairs)
    {
        var o = new JsonObject();
        foreach (var (k, v) in pairs) o[k] = v is JsonNode n ? n : JsonSerializer.SerializeToNode(v, Options);
        return o;
    }
}
