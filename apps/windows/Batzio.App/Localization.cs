namespace Batzio.App;

/// <summary>Shortcut to the shared catalog for UI code: <c>Localization.L("Today")</c>.</summary>
public static class Localization
{
    public static string L(string key, params (string Name, object? Value)[] vars) => Core.Localization.Loc.L(key, vars);
}
