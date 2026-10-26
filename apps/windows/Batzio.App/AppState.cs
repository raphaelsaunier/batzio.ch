using System.Text.Json.Nodes;
using Batzio.Core;
using Batzio.Core.Api;
using Batzio.Core.Local;
using Batzio.Core.Localization;
using Batzio.Core.Models;
using Batzio.Core.Session;
using Microsoft.UI.Dispatching;
using Windows.Storage;

namespace Batzio.App;

/// <summary>Screens on the back stack. Top-level destinations reset it.</summary>
public abstract record Route
{
    public sealed record Home(AppTarget Target, string Title) : Route;
    public sealed record List(string Resource) : Route;
    public sealed record Record(string Resource, int Id) : Route;
    public sealed record Form(string Resource, int? Id = null, JsonObject? Prefill = null) : Route;
    public sealed record Report(string Id) : Route;
    public sealed record File(int Id, string? Name) : Route;
    public sealed record Batzi : Route;
    public sealed record SettingsPage(string Page) : Route;
}

/// <summary>Session, company, navigation and everything screens share.</summary>
public sealed class AppState
{
    public enum PhaseKind { SignedOut, ChoosingCompany, Loading, Ready, Failed }

    public static AppState Current { get; } = new();

    private readonly PreferencesStore _store = new(ApplicationData.Current.LocalFolder.Path);
    private readonly ISecretStore _secrets = new CredentialLocker();
    private readonly DispatcherQueue _ui = DispatcherQueue.GetForCurrentThread();
    private string? _token;

    public Preferences Prefs { get; private set; }
    public PhaseKind Phase { get; private set; } = PhaseKind.SignedOut;
    public string? Failure { get; private set; }
    public Bootstrap? Bootstrap { get; private set; }
    public string? Selected { get; private set; }
    public List<Route> Stack { get; } = [new Route.Home(new AppTarget("today"), "")];
    public BatziModel Batzi { get; }

    /// <summary>Raised when what is on screen should be redrawn.</summary>
    public event Action? Changed;
    public event Action<string, string>? Toasted;

    private AppState()
    {
        Prefs = _store.Load();
        _token = _secrets.Get("token");
        Loc.Locale = Locale;
        Batzi = new BatziModel(this);
    }

    public string Locale => Prefs.Locale ?? Loc.Preferred(System.Globalization.CultureInfo.CurrentUICulture);
    public string TenantSlug => Prefs.Tenant ?? "";
    public bool IsAccountant => Prefs.Mode == "accountant";
    public ApiClient Api => new(Prefs.ServerUrl, _token, Prefs.Tenant, Locale, Prefs.Mode);

    public void Update(Func<Preferences, Preferences> change)
    {
        Prefs = change(Prefs);
        _store.Save(Prefs);
        Loc.Locale = Locale;
    }

    public void Refresh() => _ui.TryEnqueue(() => Changed?.Invoke());

    /// <summary>Bumped after changes so open screens reload.</summary>
    public int Revision { get; private set; }

    public void Touch()
    {
        Revision++;
        Refresh();
    }

    // ------------------------------------------------------------ session

    public async Task StartAsync()
    {
        if (_token is null) { Phase = PhaseKind.SignedOut; Refresh(); return; }
        Phase = PhaseKind.Loading;
        Refresh();
        try
        {
            var account = await Api.GetAsync<AccountInfo>("/auth/me");
            Update(p => p with { User = account.User, Companies = account.Companies });
            if (Prefs.Tenant is null || account.Companies.All(c => c.Slug != Prefs.Tenant))
            {
                if (account.Companies.Count == 1) Update(p => p with { Tenant = account.Companies[0].Slug });
                else { Phase = PhaseKind.ChoosingCompany; Refresh(); return; }
            }
            await ReloadAsync();
        }
        catch (ApiException e) when (e.IsUnauthorized)
        {
            // On this device the session simply expired: open a new one.
            if (!(IsOnDevice && await TrySignInOnDeviceAsync())) SignOut();
        }
        catch (ApiException e) { Failure = e.Message; Phase = PhaseKind.Failed; Refresh(); }
    }

    private async Task SignedInAsync(AuthResult r)
    {
        _token = r.Token;
        _secrets.Set("token", r.Token);
        Update(p => p with
        {
            User = r.User,
            Companies = r.Companies,
            Locale = p.Locale ?? (r.User.Locale is { } l && Loc.Supported.Contains(l) ? l : null),
            Tenant = r.Companies.Count == 1 ? r.Companies[0].Slug : null,
        });
        if (Prefs.Tenant is null) { Phase = PhaseKind.ChoosingCompany; Refresh(); }
        else await ReloadAsync();
    }

    public async Task SignInAsync(string email, string password) =>
        await SignedInAsync(await Api.SendAsync<AuthResult>("POST", "/auth/login", Json.Obj(("email", email), ("password", password))));

    public async Task SignUpAsync(string name, string email, string password, string company, string language, bool demo) =>
        await SignedInAsync(await Api.SendAsync<AuthResult>("POST", "/auth/signup", Json.Obj(("name", name), ("email", email), ("password", password), ("company", company), ("language", language), ("demo", demo))));

    public void SignOut() => SignOut(logout: true);

    private void SignOut(bool logout)
    {
        if (logout)
        {
            var api = Api;
            _ = Task.Run(async () => { try { await api.SendAsync<JsonNode>("POST", "/auth/logout"); } catch (Exception) { } });
        }
        _token = null;
        _secrets.Set("token", null);
        // The books stay on the device; “Continue on this device” opens them again.
        var server = IsOnDevice ? Preferences.DefaultServer : Prefs.ServerUrl;
        Update(p => p with { ServerUrl = server, Tenant = null, User = null, Companies = [] });
        Bootstrap = null;
        Selected = null;
        Reset(new Route.Home(new AppTarget("today"), ""));
        Batzi.Reset();
        Phase = PhaseKind.SignedOut;
        Refresh();
    }

    // ------------------------------------------------------------ on this device

    /// <summary>The on-device account. Its password only unlocks the local session.</summary>
    private const string DeviceEmail = "you@this-device.local";

    public bool IsOnDevice => LocalEngine.IsOnDevice(Prefs.ServerUrl);
    public string DeviceFolder => LocalEngine.DefaultDirectory();
    public bool HasDeviceData => _secrets.Get("device-password") is not null && System.IO.File.Exists(Path.Combine(DeviceFolder, "control.sqlite"));

    public async Task StartOnDeviceAsync(string name, string company, string language, bool demo)
    {
        Update(p => p with { ServerUrl = LocalEngine.Origin });
        var password = _secrets.Get("device-password") ?? Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(24));
        _secrets.Set("device-password", password);
        try
        {
            await SignedInAsync(await Api.SendAsync<AuthResult>("POST", "/auth/signup", Json.Obj(("name", name), ("email", DeviceEmail), ("password", password), ("company", company), ("language", language), ("demo", demo))));
        }
        catch (ApiException)
        {
            Update(p => p with { ServerUrl = Preferences.DefaultServer });
            throw;
        }
    }

    public async Task ContinueOnDeviceAsync()
    {
        Update(p => p with { ServerUrl = LocalEngine.Origin });
        if (!await TrySignInOnDeviceAsync())
        {
            Update(p => p with { ServerUrl = Preferences.DefaultServer });
            throw new ApiException(0, "local", Localization.L("Batzio could not start on this device."));
        }
    }

    private async Task<bool> TrySignInOnDeviceAsync()
    {
        if (_secrets.Get("device-password") is not { } password) return false;
        try
        {
            await SignedInAsync(await Api.SendAsync<AuthResult>("POST", "/auth/login", Json.Obj(("email", DeviceEmail), ("password", password))));
            return true;
        }
        catch (ApiException) { return false; }
    }

    /// <summary>Removes every company, document and file stored on this device.</summary>
    public void DeleteEverythingOnDevice()
    {
        SignOut(logout: false);
        LocalEngine.Shutdown();
        try { Directory.Delete(DeviceFolder, recursive: true); } catch (IOException) { }
        _secrets.Set("device-password", null);
    }

    public async Task ChooseAsync(Company company)
    {
        Update(p => p with { Tenant = company.Slug });
        Bootstrap = null;
        Selected = null;
        Batzi.Reset();
        Reset(new Route.Home(new AppTarget("today"), ""));
        await ReloadAsync();
    }

    /// <summary>Loads (or reloads) navigation and every module definition.</summary>
    public async Task ReloadAsync()
    {
        if (Bootstrap is null) { Phase = PhaseKind.Loading; Refresh(); }
        try
        {
            Bootstrap = await Api.GetAsync<Bootstrap>("/app/bootstrap", new Dictionary<string, string?> { ["mode"] = Prefs.Mode });
            var items = Bootstrap.Navigation.SelectMany(s => s.Items).ToList();
            if (Selected is null || items.All(i => i.Key != Selected)) { if (items.FirstOrDefault() is { } first) Select(first); }
            Phase = PhaseKind.Ready;
            Touch();
        }
        catch (ApiException e) when (e.IsUnauthorized)
        {
            if (!(IsOnDevice && await TrySignInOnDeviceAsync())) SignOut();
        }
        catch (ApiException e)
        {
            if (Bootstrap is null) { Failure = e.Message; Phase = PhaseKind.Failed; Refresh(); } else Toast(e.Message, "danger");
        }
    }

    public async Task SetLocaleAsync(string? locale)
    {
        Update(p => p with { Locale = locale });
        if (locale is not null) { try { await Api.SendAsync<JsonNode>("PATCH", "/auth/me", Json.Obj(("locale", locale))); } catch (ApiException) { } }
        await ReloadAsync();
    }

    public async Task SetModeAsync(string mode)
    {
        Update(p => p with { Mode = mode });
        await ReloadAsync();
    }

    // ------------------------------------------------------------ navigation

    private void Reset(Route root)
    {
        Stack.Clear();
        Stack.Add(root);
    }

    public void Select(NavItem item)
    {
        Selected = item.Key;
        Reset(new Route.Home(item.Target, item.Title));
        Refresh();
    }

    /// <summary>Opens a destination: sidebar ones reset the stack, the rest push.</summary>
    public void Go(AppTarget target)
    {
        var items = Bootstrap?.Navigation.SelectMany(s => s.Items).ToList() ?? [];
        var match = items.FirstOrDefault(i => i.Target == target) ?? items.FirstOrDefault(i => i.Tabs?.Any(t => t.Target == target) == true);
        if (match is not null && target.Id is null && target.Create != true)
        {
            Selected = match.Key;
            Reset(new Route.Home(target, match.Title));
            Refresh();
            return;
        }
        Push(RouteFor(target));
    }

    public static Route RouteFor(AppTarget t) => t.Kind switch
    {
        "resource" when t.Id is { } id => new Route.Record(t.Resource!, id),
        "resource" when t.Create == true => new Route.Form(t.Resource!),
        "resource" => new Route.List(t.Resource!),
        "reports" when t.Report is { } r => new Route.Report(r),
        "file" => new Route.File(t.Id ?? 0, null),
        _ => new Route.Home(t, ""),
    };

    public void Push(Route route) { Stack.Add(route); Refresh(); }
    public void Pop() { if (Stack.Count > 1) { Stack.RemoveAt(Stack.Count - 1); Refresh(); } }
    public void Open(RecordRef r) => Push(new Route.Record(r.Resource, r.Id));

    // ------------------------------------------------------------ feedback

    public void Toast(string text, string tone = "success") => _ui.TryEnqueue(() => Toasted?.Invoke(text, tone));
    public void Report(Exception e) => Toast(e.Message, "danger");

    /// <summary>Files dropped, shared or picked: handled at once where possible, else queued for Batzi.</summary>
    public async Task DropAsync(List<UploadFile> files)
    {
        if (files.Count == 0 || Phase != PhaseKind.Ready) return;
        Toast(Localization.L("Got it — reading {n} file(s)…", ("n", files.Count)), "info");
        try
        {
            var outcomes = await Api.UploadAsync<List<DropOutcome>>("/api/drop", files);
            foreach (var o in outcomes) Toast(o.Text ?? o.File.Name, o.Handled ? "success" : "info");
            Touch();
        }
        catch (ApiException e) { Report(e); }
    }
}

/// <summary>A conversation with Batzi, streamed live from <c>/api/agent</c>.</summary>
public sealed class BatziModel(AppState app)
{
    public sealed class Message
    {
        public required string Role { get; init; }
        public string Text { get; set; } = "";
        public List<FileRef> Files { get; init; } = [];
        public List<string> Updates { get; } = [];
        public List<ToolOutcome> Tools { get; } = [];
        public bool Refused { get; set; }
        public bool Streaming { get; set; }
    }

    public List<Message> Messages { get; } = [];
    public List<FileRef> Attachments { get; } = [];
    public string? ThreadId { get; private set; }
    public bool Working { get; private set; }
    public event Action? Changed;

    private void Notify() => app.Touch();

    public void Reset()
    {
        Messages.Clear();
        Attachments.Clear();
        ThreadId = null;
        Working = false;
        Changed?.Invoke();
    }

    public async Task<List<ThreadSummary>> ThreadsAsync()
    {
        try { return await app.Api.GetAsync<List<ThreadSummary>>("/app/threads"); } catch (ApiException) { return []; }
    }

    public async Task LoadAsync(string thread)
    {
        try
        {
            var turns = await app.Api.GetAsync<List<ChatTurn>>($"/app/threads/{thread}");
            ThreadId = thread;
            Messages.Clear();
            foreach (var t in turns)
            {
                var m = new Message { Role = t.Role, Text = t.Text, Files = t.Files ?? [], Refused = t.Refused ?? false };
                m.Tools.AddRange(t.Tools ?? []);
                Messages.Add(m);
            }
            Changed?.Invoke();
        }
        catch (ApiException e) { app.Report(e); }
    }

    public async Task AttachAsync(List<UploadFile> files)
    {
        if (files.Count == 0) return;
        try
        {
            var stored = await app.Api.UploadAsync<List<StoredFile>>("/api/drop", files, query: new Dictionary<string, string?> { ["store"] = "1" });
            Attachments.AddRange(stored.Select(s => s.File));
            Changed?.Invoke();
        }
        catch (ApiException e) { app.Report(e); }
    }

    public Task SendAsync(string text)
    {
        var files = Attachments.ToList();
        Attachments.Clear();
        Messages.Add(new Message { Role = "user", Text = text, Files = files });
        return StreamAsync(Json.Obj(("threadId", ThreadId), ("text", text), ("fileIds", files.Select(f => f.Id).ToList()), ("page", $"/{app.TenantSlug}")));
    }

    /// <summary>Lets Batzi take care of an inbox item (a dropped file or forwarded mail).</summary>
    public Task ProcessAsync(int? fileId, int? inboxId, string? prompt)
    {
        var text = prompt ?? Localization.L("Take care of this, please.");
        Messages.Add(new Message { Role = "user", Text = text });
        return StreamAsync(Json.Obj(("threadId", ThreadId), ("text", text), ("fileIds", fileId is { } f ? new List<int> { f } : []), ("inboxIds", inboxId is { } i ? new List<int> { i } : [])));
    }

    public Task ConfirmAsync(ToolOutcome tool, bool approve) =>
        StreamAsync(Json.Obj(("threadId", ThreadId), ("confirm", Json.Obj(("toolUseId", tool.Id), ("approve", approve)))));

    private async Task StreamAsync(JsonObject body)
    {
        Working = true;
        var reply = new Message { Role = "assistant", Streaming = true };
        Messages.Add(reply);
        Changed?.Invoke();
        try
        {
            await foreach (var e in app.Api.AgentAsync(body))
            {
                switch (e)
                {
                    case AgentEvent.Thread t: ThreadId = t.Id; break;
                    case AgentEvent.Text t: reply.Text += t.Delta; break;
                    case AgentEvent.Update u: reply.Updates.Add(u.Message); break;
                    case AgentEvent.Tool t:
                        reply.Tools.RemoveAll(x => x.Id == t.Outcome.Id);
                        reply.Tools.Add(t.Outcome);
                        break;
                    case AgentEvent.Done d: reply.Refused = d.Refused; break;
                    case AgentEvent.Error err:
                        reply.Text += err.Message != "no_agent" ? err.Message
                            : app.IsOnDevice ? Localization.L("Batzi needs an internet connection. On this device, quick sentences and file drops still work.")
                            : Localization.L("Batzi needs an Anthropic API key on the server before it can chat. Quick sentences and file drops still work.");
                        break;
                }
                Changed?.Invoke();
            }
        }
        catch (ApiException ex) { reply.Text += ex.Message; }
        finally
        {
            reply.Streaming = false;
            Working = false;
            Changed?.Invoke();
            Notify();
        }
    }
}
