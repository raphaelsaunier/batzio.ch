using System.Text.Json.Nodes;
using Batzio.Core;
using Batzio.Core.Format;
using Batzio.Core.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Data.Pdf;
using Windows.Storage.Streams;
using static Batzio.App.Localization;

namespace Batzio.App.Views;

public sealed class SettingsView : UserControl
{
    public SettingsView()
    {
        var state = AppState.Current;
        Content = Ui.Load(() => state.Api.GetAsync<SettingsScreen>("/app/settings"), (s, refresh) =>
        {
            var page = Ui.Stack(18, Ui.H1(L("Settings")));

            var language = new ComboBox { Header = L("Language"), MinWidth = 220 };
            foreach (var (code, name) in new[] { ("", L("Same as device")), ("en", "English"), ("de", "Deutsch"), ("fr", "Français"), ("it", "Italiano") })
                language.Items.Add(new ComboBoxItem { Content = name, Tag = code });
            language.SelectedItem = language.Items.OfType<ComboBoxItem>().FirstOrDefault(i => (string)i.Tag == (state.Prefs.Locale ?? ""));
            language.SelectionChanged += async (_, _) => await state.SetLocaleAsync((language.SelectedItem as ComboBoxItem)?.Tag is string { Length: > 0 } l ? l : null);
            var appearance = new ComboBox { Header = L("Appearance"), MinWidth = 220 };
            foreach (var (code, name) in new[] { ("system", L("System")), ("light", L("Light")), ("dark", L("Dark")) })
                appearance.Items.Add(new ComboBoxItem { Content = name, Tag = code });
            appearance.SelectedItem = appearance.Items.OfType<ComboBoxItem>().FirstOrDefault(i => (string)i.Tag == state.Prefs.Appearance);
            appearance.SelectionChanged += (_, _) => { if (appearance.SelectedItem is ComboBoxItem { Tag: string mode }) { state.Update(p => p with { Appearance = mode }); state.Touch(); } };
            var you = Ui.Stack(12, Ui.Section(L("You")), Ui.Body($"{state.Prefs.User?.Name} · {state.Prefs.User?.Email}"), Ui.Row(12, language, appearance));
            if ((state.Prefs.Companies ?? []).Count > 1)
            {
                var picker = new ComboBox { Header = L("Company"), MinWidth = 220, ItemsSource = state.Prefs.Companies!.Select(c => c.Name).ToList() };
                picker.SelectedIndex = state.Prefs.Companies!.FindIndex(c => c.Slug == state.TenantSlug);
                picker.SelectionChanged += async (_, _) => await state.ChooseAsync(state.Prefs.Companies![picker.SelectedIndex]);
                you.Children.Add(picker);
            }
            you.Children.Add(Ui.Button(L("Sign out"), () => state.SignOut()));
            page.Children.Add(Ui.Card(you));

            var inbox = Ui.Stack(10, Ui.Section(L("Batzi & inbox")), Ui.Muted(L("Everything here can also be set up by talking to Batzi or dropping a file.")));
            if (s.Inbox is { } address)
            {
                inbox.Children.Add(Ui.Body(address));
                if (s.CanWrite) inbox.Children.Add(Ui.Button(L("Get a new address"), async () =>
                {
                    await state.Api.SendAsync<JsonNode>("POST", "/app/inbox-address");
                    state.Toast(L("New address ready. The old one no longer works."));
                    await state.ReloadAsync();
                }, compact: true));
            }
            inbox.Children.Add(Ui.Muted("Batzi: " + (s.Agent ? L("Ready") : L("Needs an Anthropic API key on the server"))));
            page.Children.Add(Ui.Card(inbox));

            var company = Ui.Stack(8, Ui.Section(L("Company")));
            void Link(string title, string pageKey) => company.Children.Add(new HyperlinkButton { Content = title, Command = new RelayCommand(() => state.Push(new Route.SettingsPage(pageKey))) });
            Link(L("Company profile"), "company");
            Link(L("Accounting"), "accounting");
            Link(L("Document texts"), "texts");
            Link(L("Number formats"), "numbering");
            if (state.Bootstrap?.Can("users") == true) Link(L("Users & roles"), "team");
            Link(L("API & MCP"), "api");
            page.Children.Add(Ui.Card(company));

            var master = Ui.Stack(8, Ui.Section(L("Master data")));
            foreach (var r in (state.Bootstrap?.Resources ?? []).Where(r => r.Nav?.Group == "settings").OrderBy(r => r.Nav?.Order ?? 0))
                master.Children.Add(new HyperlinkButton { Content = r.LabelPlural, Command = new RelayCommand(() => state.Push(new Route.List(r.Name))) });
            if (state.Bootstrap?.Resource("audit_log") is not null)
                master.Children.Add(new HyperlinkButton { Content = L("Audit log"), Command = new RelayCommand(() => state.Push(new Route.List("audit_log"))) });
            page.Children.Add(Ui.Card(master));
            page.Children.Add(Ui.Muted($"{L("Server")}: {state.Prefs.ServerUrl}", 12));
            return Ui.Page(page);
        });
    }

    public static UIElement Page(string page) => page switch
    {
        "company" or "accounting" or "texts" => FormPage(page),
        "numbering" => NumberingPage(),
        "team" => TeamPage(),
        _ => ApiKeysPage(),
    };

    private static UIElement FormPage(string group)
    {
        var state = AppState.Current;
        return Ui.Load(() => state.Api.GetAsync<SettingsScreen>("/app/settings"), (s, _) =>
        {
            var form = group switch { "company" => s.Forms.Company, "accounting" => s.Forms.Accounting, _ => s.Forms.Texts };
            var values = (JsonObject)form.Values.DeepClone();
            var title = group switch { "company" => L("Company profile"), "accounting" => L("Accounting"), _ => L("Document texts") };
            var card = Ui.Stack(12);
            foreach (var f in form.Fields) card.Children.Add(FieldEditor.Create(f, values[f.Name], v => values[f.Name] = v?.DeepClone()));
            if (group == "company" && s.CanWrite)
            {
                card.Children.Add(Ui.Button(L("Upload logo…"), async () =>
                {
                    var files = await Files.PickAsync(false, ".png", ".jpg", ".jpeg");
                    if (files.Count == 0) return;
                    var stored = await state.Api.UploadAsync<JsonNode>("/files/upload", files, "file", new Dictionary<string, string> { ["description"] = "Logo" });
                    if (stored["id"].Int() is { } id)
                    {
                        await state.Api.SendAsync<MessageResult>("PATCH", "/app/settings/company", Json.Obj(("logo_file_id", id)));
                        state.Toast(L("Logo saved. It is printed on your documents."));
                    }
                }));
            }
            if (s.CanWrite) card.Children.Add(Ui.Button(L("Save"), async () =>
            {
                var r = await state.Api.SendAsync<MessageResult>("PATCH", $"/app/settings/{group}", values);
                state.Toast(r.Message);
                await state.ReloadAsync();
                state.Pop();
            }, prominent: true));
            return Ui.Page(Ui.Stack(16, Ui.H1(title), Ui.Card(card)), 760);
        });
    }

    private static UIElement NumberingPage()
    {
        var state = AppState.Current;
        return Ui.Load(() => state.Api.GetAsync<SettingsScreen>("/app/settings"), (s, refresh) =>
        {
            var list = Ui.Stack(10, Ui.H1(L("Number formats")), Ui.Muted(L("Use {YYYY}, {YY}, {MM} and #### for the counter.")));
            foreach (var f in s.Numbering)
            {
                var format = new TextBox { Header = f.Label, Text = f.Format, MinWidth = 260, IsEnabled = s.CanWrite };
                var next = new NumberBox { Header = L("Next number: {nr}", ("nr", f.Preview)), Value = f.NextValue, Minimum = 1, IsEnabled = s.CanWrite };
                var save = Ui.Button(L("Save"), async () =>
                {
                    var r = await state.Api.SendAsync<MessageResult>("PATCH", $"/app/numbering/{f.Key}", Json.Obj(("format", format.Text), ("next_value", (int)next.Value)));
                    state.Toast(r.Message);
                    await refresh();
                }, compact: true);
                save.VerticalAlignment = VerticalAlignment.Bottom;
                list.Children.Add(Ui.Card(Ui.Row(12, format, next, save), 14));
            }
            return Ui.Page(list, 900);
        });
    }

    private static readonly string[] Roles = ["owner", "admin", "accountant", "member", "viewer"];
    private static string RoleLabel(string role) => role switch
    {
        "owner" => L("Owner"),
        "admin" => L("Administrator"),
        "accountant" => L("Accountant"),
        "member" => L("Member"),
        _ => L("Viewer"),
    };

    private static UIElement TeamPage()
    {
        var state = AppState.Current;
        return Ui.Load(() => state.Api.GetAsync<TeamScreen>("/app/team"), (team, refresh) =>
        {
            var members = Ui.Stack(8, Ui.Section(L("Members")));
            foreach (var m in team.Members)
            {
                var role = new ComboBox { ItemsSource = Roles.Select(RoleLabel).ToList(), SelectedIndex = Array.IndexOf(Roles, m.Role), IsEnabled = team.CanWrite && m.UserId != team.Me, MinWidth = 160 };
                role.SelectionChanged += async (_, _) =>
                {
                    try
                    {
                        await state.Api.SendAsync<JsonNode>("PATCH", $"/app/team/{m.UserId}", Json.Obj(("role", Roles[role.SelectedIndex])));
                        state.Toast(L("Role updated."));
                    }
                    catch (Core.Api.ApiException e) { state.Report(e); }
                };
                var row = Ui.Row(12, Ui.Stack(0, Ui.Strong(m.Name), Ui.Muted(m.Email, 12)), role);
                if (team.CanWrite && m.UserId != team.Me) row.Children.Add(Ui.Button(L("Remove"), async () =>
                {
                    await state.Api.SendAsync<JsonNode>("DELETE", $"/app/team/{m.UserId}");
                    state.Toast(L("Member removed."));
                    await refresh();
                }, compact: true));
                members.Children.Add(row);
            }
            foreach (var i in team.Invitations) members.Children.Add(Ui.Muted($"{L("Invitations")}: {i.Email} · {RoleLabel(i.Role)}"));
            var page = Ui.Stack(16, Ui.H1(L("Users & roles")), Ui.Card(members));
            if (team.CanWrite)
            {
                var email = new TextBox { Header = L("Email"), MinWidth = 280 };
                var role = new ComboBox { Header = L("Role"), ItemsSource = Roles.Select(RoleLabel).ToList(), SelectedIndex = 3 };
                var result = Ui.Stack(6);
                page.Children.Add(Ui.Card(Ui.Stack(12, Ui.Section(L("Invite")), Ui.Row(12, email, role), Ui.Button(L("Invite"), async () =>
                {
                    var r = await state.Api.SendAsync<InviteResult>("POST", "/app/team", Json.Obj(("email", email.Text), ("role", Roles[role.SelectedIndex])));
                    state.Toast(r.Message);
                    result.Children.Clear();
                    if (r.Link is { } link)
                    {
                        result.Children.Add(Ui.Muted(L("Share this link with your colleague")));
                        var box = new TextBox { Text = link, IsReadOnly = true };
                        result.Children.Add(box);
                    }
                }, prominent: true), result)));
            }
            return Ui.Page(page, 900);
        });
    }

    private static UIElement ApiKeysPage()
    {
        var state = AppState.Current;
        return Ui.Load(() => state.Api.GetAsync<List<ApiKeyInfo>>("/app/api-keys"), (keys, refresh) =>
        {
            var list = Ui.Stack(8, Ui.Muted(L("Connect scripts, other software and AI assistants (MCP) with an API key.")), Ui.Body($"MCP: {state.Prefs.ServerUrl}/api/mcp"));
            foreach (var k in keys)
            {
                var row = Ui.Row(12, Ui.Stack(0, Ui.Strong(k.Name), Ui.Muted($"{k.Prefix}… · {k.Scope} · {k.UserName}", 12)));
                if (k.RevokedAt is not null) row.Children.Add(Ui.Badge(L("Revoked"), "muted"));
                else row.Children.Add(Ui.Button(L("Revoke"), async () =>
                {
                    await state.Api.SendAsync<JsonNode>("DELETE", $"/app/api-keys/{k.Id}");
                    state.Toast(L("API key revoked."));
                    await refresh();
                }, compact: true));
                list.Children.Add(row);
            }
            var name = new TextBox { Header = L("Name"), MinWidth = 260 };
            var write = new ToggleSwitch { Header = L("Allow changes (not just reading)") };
            var created = Ui.Stack(6);
            var create = Ui.Button(L("Create"), async () =>
            {
                var r = await state.Api.SendAsync<CreatedApiKey>("POST", "/app/api-keys", Json.Obj(("name", name.Text), ("scope", write.IsOn ? "write" : "read"), ("role", state.Bootstrap?.Role ?? "viewer")));
                created.Children.Clear();
                var warn = Ui.Body(L("API key created. Copy it now — it will not be shown again."));
                warn.Foreground = Ui.Brush("BzWarningBrush");
                created.Children.Add(warn);
                created.Children.Add(new TextBox { Text = r.Key, IsReadOnly = true });
            }, prominent: true);
            return Ui.Page(Ui.Stack(16, Ui.H1(L("API & MCP")), Ui.Card(list), Ui.Card(Ui.Stack(12, Ui.Section(L("New API key")), name, write, create, created))), 900);
        });
    }
}

/// <summary>Minimal ICommand for hyperlinks.</summary>
public sealed class RelayCommand(Action run) : System.Windows.Input.ICommand
{
    public event EventHandler? CanExecuteChanged { add { } remove { } }
    public bool CanExecute(object? parameter) => true;
    public void Execute(object? parameter) => run();
}

/// <summary>Shows an attachment: PDFs render in place, anything else opens in its app.</summary>
public sealed class FileView : UserControl
{
    public FileView(int id, string? name)
    {
        var state = AppState.Current;
        Content = Ui.Load(() => state.Api.DownloadAsync($"/files/{id}/download", new Dictionary<string, string?> { ["inline"] = "1" }), (d, reload) =>
        {
            var pages = Ui.Stack(12);
            var header = Ui.Row(12, Ui.H1(name ?? d.FileName, 22), Ui.Button(L("Open"), async () => await Files.OpenAsync(d), compact: true));
            if (!d.MimeType.StartsWith("application/pdf", StringComparison.Ordinal))
            {
                _ = Files.OpenAsync(d);
                return Ui.Page(Ui.Stack(12, header, Ui.Muted(Fmt.Bytes(d.Bytes.Length))));
            }
            _ = RenderAsync(d.Bytes, pages);
            return Ui.Page(Ui.Stack(16, header, pages), 1000);
        });
    }

    private static async Task RenderAsync(byte[] bytes, StackPanel pages)
    {
        using var stream = new InMemoryRandomAccessStream();
        await stream.WriteAsync(bytes.AsBuffer());
        stream.Seek(0);
        var pdf = await PdfDocument.LoadFromStreamAsync(stream);
        for (uint i = 0; i < pdf.PageCount; i++)
        {
            using var page = pdf.GetPage(i);
            using var image = new InMemoryRandomAccessStream();
            await page.RenderToStreamAsync(image, new PdfPageRenderOptions { DestinationWidth = (uint)(page.Size.Width * 2) });
            var bitmap = new BitmapImage();
            await bitmap.SetSourceAsync(image);
            pages.Children.Add(new Border { Child = new Image { Source = bitmap, MaxWidth = 900 }, Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.White), Shadow = new Microsoft.UI.Xaml.Media.ThemeShadow(), Translation = new System.Numerics.Vector3(0, 0, 16) });
        }
    }
}
