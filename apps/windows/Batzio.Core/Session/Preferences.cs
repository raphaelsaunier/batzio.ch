using System.Text.Json;
using Batzio.Core.Models;

namespace Batzio.Core.Session;

/// <summary>What the app remembers between launches (the session token lives in a secret store).</summary>
public sealed record Preferences(
    string ServerUrl,
    string? Tenant = null,
    UserInfo? User = null,
    List<Company>? Companies = null,
    string? Locale = null,
    string Mode = "simple",
    string Appearance = "system")
{
    public const string DefaultServer = "http://localhost:5173";
}

/// <summary>Where the session token is kept (Windows Credential Locker in the app; memory in tests).</summary>
public interface ISecretStore
{
    string? Get(string key);
    void Set(string key, string? value);
}

public sealed class MemorySecretStore : ISecretStore
{
    private readonly Dictionary<string, string> _values = [];
    public string? Get(string key) => _values.GetValueOrDefault(key);
    public void Set(string key, string? value) { if (value is null) _values.Remove(key); else _values[key] = value; }
}

public sealed class PreferencesStore(string directory)
{
    private string File => Path.Combine(directory, "preferences.json");

    public Preferences Load()
    {
        try
        {
            if (System.IO.File.Exists(File)) return JsonSerializer.Deserialize<Preferences>(System.IO.File.ReadAllText(File), Json.Options) ?? new(Preferences.DefaultServer);
        }
        catch (JsonException) { }
        return new Preferences(Preferences.DefaultServer);
    }

    public void Save(Preferences p)
    {
        Directory.CreateDirectory(directory);
        System.IO.File.WriteAllText(File, JsonSerializer.Serialize(p, Json.Options));
    }
}
