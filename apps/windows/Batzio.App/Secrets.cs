using Batzio.Core.Session;
using Windows.Security.Credentials;

namespace Batzio.App;

/// <summary>Keeps the session token in the Windows Credential Locker.</summary>
public sealed class CredentialLocker : ISecretStore
{
    private const string Resource = "Batzio";
    private readonly PasswordVault _vault = new();

    public string? Get(string key)
    {
        try
        {
            var c = _vault.Retrieve(Resource, key);
            c.RetrievePassword();
            return c.Password;
        }
        catch (Exception)
        {
            return null;
        }
    }

    public void Set(string key, string? value)
    {
        try { _vault.Remove(_vault.Retrieve(Resource, key)); } catch (Exception) { }
        if (value is not null) _vault.Add(new PasswordCredential(Resource, key, value));
    }
}
