using System.Text.Json.Nodes;
using Batzio.Core.Format;
using Batzio.Core.Models;
using static Batzio.Core.Localization.Loc;

namespace Batzio.Core;

/// <summary>How a field's value reads on screen (same rules as the web cells).</summary>
public static class FieldText
{
    public static string Text(FieldDef field, JsonNode? value, IReadOnlyDictionary<string, Dictionary<string, string>>? labels = null)
    {
        if (value.IsNull()) return "";
        return field.Type switch
        {
            "money" => Fmt.Amount(value.Num()),
            "decimal" => Fmt.Number(value.Num()),
            "percent" => Fmt.Percent(value.Num()),
            "int" => field.Format == "duration" ? Fmt.Duration(value.Num()) : value.Str() ?? "",
            "date" => Fmt.Date(value.Str()),
            "datetime" => Fmt.DateTime(value.Str()),
            "boolean" => value.Bool() == true ? L("Yes") : L("No"),
            "enum" => field.Option(value)?.Label ?? value.Display(),
            "ref" => value.Str() is { } id ? (labels?.GetValueOrDefault(field.Name)?.GetValueOrDefault(id) ?? $"#{id}") : "",
            "tags" => string.Join(", ", (value as JsonArray ?? []).Select(x => x.Str()).OfType<string>().Select(id => labels?.GetValueOrDefault(field.Name)?.GetValueOrDefault(id) ?? $"#{id}")),
            "json" => "",
            _ => value.Display(),
        };
    }

    public static bool IsEmpty(JsonNode? value) => value.IsNull() || (value is JsonArray a && a.Count == 0) || (value is JsonValue && value.Display().Length == 0);

    /// <summary>Fields grouped into form sections, in definition order.</summary>
    public static IEnumerable<(string? Section, List<FieldDef> Fields)> Sections(IEnumerable<FieldDef> fields) =>
        fields.GroupBy(f => f.Section).Select(g => (g.Key, g.ToList()));
}
