using System.Globalization;
using System.Text.Json;

namespace Batzio.Core.Localization;

/// <summary>
/// The shared EN/DE/FR/IT catalog (generated from packages/i18n by <c>pnpm gen</c>).
/// Keys are the English text, exactly as on the web: <c>L("Today")</c>, <c>L("{n} records", ("n", 3))</c>.
/// </summary>
public static class Loc
{
    public static readonly string[] Supported = ["en", "de", "fr", "it"];
    private static Dictionary<string, Dictionary<string, string>> _table = Load();
    private static string _locale = Preferred(CultureInfo.CurrentUICulture);

    public static string Locale
    {
        get => _locale;
        set => _locale = Supported.Contains(value) ? value : "en";
    }

    /// <summary>Swiss formatting culture for the current language (de-CH, fr-CH, …).</summary>
    public static CultureInfo Culture => CultureInfo.GetCultureInfo($"{_locale}-CH");

    public static string Preferred(CultureInfo culture) => Supported.Contains(culture.TwoLetterISOLanguageName) ? culture.TwoLetterISOLanguageName : "en";

    private static Dictionary<string, Dictionary<string, string>> Load()
    {
        using var stream = typeof(Loc).Assembly.GetManifestResourceStream("Batzio.Core.strings.json");
        return stream is null ? [] : JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(stream) ?? [];
    }

    public static void Load(string json) => _table = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(json) ?? [];

    public static string Translate(string key, string? locale = null)
    {
        var lang = locale ?? _locale;
        return lang != "en" && _table.TryGetValue(lang, out var t) && t.TryGetValue(key, out var v) ? v : key;
    }

    public static string L(string key, params (string Name, object? Value)[] vars)
    {
        var text = Translate(key);
        foreach (var (name, value) in vars) text = text.Replace("{" + name + "}", value?.ToString() ?? "");
        return text;
    }
}
