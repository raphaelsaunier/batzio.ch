using System.Globalization;

namespace Batzio.Core.Format;

/// <summary>Swiss number, money and date formatting, matching the web (1’234.50).</summary>
public static class Fmt
{
    private static readonly NumberFormatInfo Swiss = new() { NumberGroupSeparator = "’", NumberDecimalSeparator = ".", NegativeSign = "-" };
    private static readonly TimeZoneInfo Zurich = FindZurich();

    private static TimeZoneInfo FindZurich()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("Europe/Zurich"); }
        catch (TimeZoneNotFoundException) { return TimeZoneInfo.FindSystemTimeZoneById("W. Europe Standard Time"); }
    }

    public static string Amount(double? value, int digits = 2) => value is { } v ? v.ToString("N" + digits, Swiss) : "";
    public static string Money(double? value, string currency = "CHF") => value is { } v ? $"{currency} {Amount(v)}" : "";
    public static string Number(double? value) => value switch
    {
        null => "",
        { } v when v == Math.Floor(v) => Amount(v, 0),
        { } v when Math.Abs(v * 100 - Math.Round(v * 100)) < 1e-9 => Amount(v, 2),
        { } v => Amount(v, 4),
    };
    public static string Percent(double? value) => value is { } v ? $"{Number(v)} %" : "";

    public static DateOnly? ParseDate(string? iso) =>
        iso is { Length: >= 10 } && DateOnly.TryParseExact(iso[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    public static string Date(string? iso) => ParseDate(iso)?.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture) ?? iso ?? "";

    public static string DateTime(string? iso)
    {
        if (iso is null) return "";
        if (!DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dto)) return Date(iso);
        return TimeZoneInfo.ConvertTime(dto, Zurich).ToString("dd.MM.yyyy HH:mm", CultureInfo.InvariantCulture);
    }

    public static string Duration(double? minutes) => minutes is { } m ? $"{(int)Math.Round(m) / 60}:{(int)Math.Round(m) % 60:00} h" : "";

    public static string Bytes(long size) => size switch
    {
        < 1024 => $"{size} B",
        < 1024 * 1024 => $"{size / 1024} KB",
        _ => $"{size / 1024.0 / 1024.0:0.0} MB",
    };

    public static string Today() => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(System.DateTime.UtcNow, Zurich)).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
