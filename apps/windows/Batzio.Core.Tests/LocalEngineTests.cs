using System.Text;
using System.Text.Json.Nodes;
using Batzio.Core.Api;
using Batzio.Core.Local;
using Batzio.Core.Models;
using Xunit;

namespace Batzio.Core.Tests;

/// <summary>
/// The on-device mode end to end: the embedded engine bundle in V8, SQLite files in a
/// temporary folder, and the app's own API client on top.
/// </summary>
public sealed class LocalEngineTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"batzio-local-{Guid.NewGuid():N}");

    public void Dispose()
    {
        try { Directory.Delete(_directory, true); } catch (IOException) { }
    }

    private static JsonObject SignUp(string company, bool demo) => new()
    {
        ["name"] = "Anna Muster",
        ["email"] = "anna@device.local",
        ["password"] = "on-this-device-only",
        ["company"] = company,
        ["language"] = "de",
        ["demo"] = demo,
    };

    [Fact]
    public async Task RunsTheWholeAppOnTheDevice()
    {
        using var engine = new LocalEngine(_directory, tenantSlots: 3);
        var http = new HttpClient(engine.Handler());
        var auth = await new ApiClient(LocalEngine.Origin, locale: "de", http: http).SendAsync<AuthResult>("POST", "/auth/signup", SignUp("Muster GmbH", demo: true));
        Assert.Equal(["muster-gmbh"], auth.Companies.Select(c => c.Slug));
        var api = new ApiClient(LocalEngine.Origin, auth.Token, "muster-gmbh", "de", http: http);

        var boot = await api.GetAsync<Bootstrap>("/app/bootstrap", new Dictionary<string, string?> { ["mode"] = "simple" });
        Assert.Equal("Heute", boot.Navigation[0].Items[0].Title);
        var list = await api.GetAsync<RecordList>("/app/records/invoices", new Dictionary<string, string?> { ["limit"] = "5" });
        Assert.NotEmpty(list.Rows);

        var pdf = await api.DownloadAsync($"/invoices/{list.Rows[0]["id"]}/pdf");
        Assert.Equal("application/pdf", pdf.MimeType);
        Assert.Equal("%PDF-", Encoding.ASCII.GetString(pdf.Bytes, 0, 5));

        var file = await api.UploadAsync<JsonObject>("/files/upload", [new UploadFile("Quittung Café.txt", "text/plain", Encoding.UTF8.GetBytes("Kaffee 4.50"))], fileField: "file");
        var download = await api.DownloadAsync($"/files/{file["id"]}/download");
        Assert.Equal("Quittung Café.txt", download.FileName);
        Assert.Equal("Kaffee 4.50", Encoding.UTF8.GetString(download.Bytes));

        var events = new List<AgentEvent>();
        await foreach (var e in api.AgentAsync(new JsonObject { ["text"] = "Hallo" })) events.Add(e);
        Assert.Equal(new AgentEvent.Error("no_agent"), events[^1]);

        Assert.True(File.Exists(Path.Combine(_directory, "control.sqlite")));
        Assert.True(File.Exists(Path.Combine(_directory, "tenant-001.sqlite")));
        var unauthorized = await Assert.ThrowsAsync<ApiException>(() => new ApiClient(LocalEngine.Origin, "nope", "muster-gmbh", http: http).GetAsync<Bootstrap>("/app/bootstrap"));
        Assert.True(unauthorized.IsUnauthorized);
    }

    [Fact]
    public async Task KeepsEverythingAcrossLaunches()
    {
        string token;
        using (var first = new LocalEngine(_directory, tenantSlots: 2))
        {
            var auth = await new ApiClient(LocalEngine.Origin, http: new HttpClient(first.Handler())).SendAsync<AuthResult>("POST", "/auth/signup", SignUp("Studio Luca", demo: false));
            token = auth.Token;
        }
        using var reopened = new LocalEngine(_directory, tenantSlots: 2);
        var me = await new ApiClient(LocalEngine.Origin, token, http: new HttpClient(reopened.Handler())).GetAsync<AccountInfo>("/auth/me");
        Assert.Equal(["Studio Luca"], me.Companies.Select(c => c.Name));
    }
}
