using System.Text.Json.Nodes;
using Batzio.Core;
using Batzio.Core.Api;
using Batzio.Core.Format;
using Batzio.Core.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using static Batzio.App.Localization;

namespace Batzio.App.Views;

using Labels = Dictionary<string, Dictionary<string, string>>;

/// <summary>Any module's list: search, status filter, paging, totals, export.</summary>
public sealed class ResourceListView : UserControl
{
    private readonly TextBox _search = new() { PlaceholderText = L("Search"), MinWidth = 280 };
    private readonly ComboBox _status = new() { MinWidth = 180 };
    private readonly StackPanel _rows = new() { Spacing = 10 };
    private readonly TextBlock _summary = Ui.Muted("");
    private readonly Button _more;
    private readonly List<JsonObject> _loaded = [];
    private readonly Labels _labels = [];
    private readonly Dictionary<string, string> _titles = [];
    private string _resource;
    private int _total;

    public ResourceListView(string resource, List<NavTab>? tabs = null)
    {
        _resource = resource;
        _more = Ui.Button(L("More"), async () => await LoadAsync(false));
        var state = AppState.Current;
        var top = Ui.Stack(14);
        var family = (tabs ?? []).Where(t => t.Target.Kind == "resource" && t.Target.Id is null && t.Target.Create != true).ToList();
        if (family.Count > 1)
        {
            top.Children.Add(Ui.Flow(family.Select(t => (UIElement)Ui.Button(t.Title, async () =>
            {
                _resource = t.Target.Resource!;
                BuildFilters();
                await LoadAsync(true);
            }, prominent: t.Target.Resource == _resource, compact: true))));
        }
        var title = Ui.H1(state.Bootstrap?.Resource(resource)?.LabelPlural ?? resource);
        var toolbar = Ui.Row(10, _search, _status);
        var export = Ui.Button(L("Export to Excel"), async () =>
        {
            var q = Query();
            q["format"] = "xlsx";
            q.Remove("limit");
            await Files.OpenAsync(await state.Api.DownloadAsync("/" + _resource, q));
        }, compact: true, icon: "FileSpreadsheet");
        toolbar.Children.Add(export);
        var res = state.Bootstrap?.Resource(resource);
        if (res?.CanCreate == true) toolbar.Children.Add(Ui.Button(res.Label, () => state.Push(new Route.Form(_resource)), prominent: true, icon: "Plus"));
        top.Children.Add(title);
        top.Children.Add(toolbar);
        top.Children.Add(_summary);
        top.Children.Add(_rows);
        top.Children.Add(_more);
        Content = Ui.Page(top, 1100);
        CancellationTokenSource? typing = null;
        _search.TextChanged += async (_, _) =>
        {
            typing?.Cancel();
            var cts = typing = new CancellationTokenSource();
            try { await Task.Delay(250, cts.Token); await LoadAsync(true); } catch (TaskCanceledException) { }
        };
        _status.SelectionChanged += async (_, _) => await LoadAsync(true);
        BuildFilters();
        _ = LoadAsync(true);
    }

    private ResourceSchema? Res => AppState.Current.Bootstrap?.Resource(_resource);

    private void BuildFilters()
    {
        _status.Items.Clear();
        var options = Res?.StatusDef?.Options;
        _status.Visibility = options is null ? Visibility.Collapsed : Visibility.Visible;
        if (options is null) return;
        _status.Items.Add(new ComboBoxItem { Content = L("All"), Tag = null });
        foreach (var o in options) _status.Items.Add(new ComboBoxItem { Content = o.Label, Tag = o.Value });
        _status.SelectedIndex = 0;
    }

    private Dictionary<string, string?> Query()
    {
        var q = new Dictionary<string, string?> { ["limit"] = "40" };
        if (_search.Text.Trim() is { Length: > 0 } text) q["q"] = text;
        if (Res?.StatusField is { } f && (_status.SelectedItem as ComboBoxItem)?.Tag is string s) q[f] = s;
        return q;
    }

    private async Task LoadAsync(bool reset)
    {
        var res = Res;
        if (res is null) { _rows.Children.Clear(); _rows.Children.Add(Ui.Empty(L("This module is not available to your role."))); return; }
        var q = Query();
        q["offset"] = reset ? "0" : _loaded.Count.ToString();
        try
        {
            var page = await AppState.Current.Api.GetAsync<RecordList>($"/app/records/{res.Name}", q);
            if (reset) { _loaded.Clear(); _labels.Clear(); _titles.Clear(); _rows.Children.Clear(); }
            _loaded.AddRange(page.Rows);
            foreach (var (k, v) in page.Labels ?? []) _labels[k] = v;
            foreach (var (k, v) in page.Titles ?? []) _titles[k] = v;
            _total = page.Total;
            foreach (var row in page.Rows) _rows.Children.Add(Row(res, row));
            var money = res.ListFields.FirstOrDefault(f => f.Type == "money");
            _summary.Text = L("{n} records", ("n", _total)) + (money is not null && page.Totals?.GetValueOrDefault(money.Name) is { } sum ? $" · {money.Label}: {Fmt.Money(sum)}" : "");
            _more.Visibility = _loaded.Count < _total ? Visibility.Visible : Visibility.Collapsed;
            if (_loaded.Count == 0) _rows.Children.Add(res.Empty is { } e && _search.Text.Length == 0 ? Ui.Empty(e.Title, e.Text) : Ui.Empty(L("Nothing found")));
        }
        catch (ApiException e) { AppState.Current.Report(e); }
    }

    private UIElement Row(ResourceSchema res, JsonObject row)
    {
        var id = row["id"].Int() ?? 0;
        var title = _titles.GetValueOrDefault(id.ToString()) ?? $"#{id}";
        var money = res.ListFields.FirstOrDefault(f => f.Type == "money");
        var details = res.ListFields.Where(f => f.Name != money?.Name && f.Name != res.StatusField && f.Type != "boolean").Take(3)
            .Select(f => FieldText.Text(f, row[f.Name], _labels)).Where(t => t.Length > 0 && t != title);
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.Children.Add(Ui.Stack(2, Ui.Strong(title, 15), Ui.Muted(string.Join(" · ", details))));
        var right = Ui.Stack(4);
        right.HorizontalAlignment = HorizontalAlignment.Right;
        if (money is not null) right.Children.Add(Ui.Number(FieldText.Text(money, row[money.Name]), 15, true));
        if (res.StatusDef?.Option(row[res.StatusField!]) is { } o) right.Children.Add(Ui.Badge(o.Label, o.Tone));
        Grid.SetColumn(right, 1);
        grid.Children.Add(right);
        var button = new Button { Content = grid, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch, CornerRadius = new CornerRadius(16), Padding = new Thickness(16, 12, 16, 12) };
        button.Click += (_, _) => AppState.Current.Push(new Route.Record(res.Name, id));
        return button;
    }
}

/// <summary>One record: key figures, workflow actions, fields, children, related records, attachments, history.</summary>
public sealed class RecordView : UserControl
{
    public RecordView(string resource, int id)
    {
        var state = AppState.Current;
        var res = state.Bootstrap?.Resource(resource);
        if (res is null) { Content = Ui.Empty(L("This module is not available to your role.")); return; }
        Content = Ui.Load(() => state.Api.GetAsync<RecordScreen>($"/app/records/{resource}/{id}", new Dictionary<string, string?> { ["mode"] = state.Prefs.Mode }), (screen, refresh) =>
        {
            var record = screen.Record;
            var labels = screen.Labels ?? [];
            var page = Ui.Stack(18);

            var header = Ui.Stack(8, Ui.H1(screen.Title));
            var badges = Ui.Row(8, Ui.Muted(res.Label, 14));
            if (res.StatusDef?.Option(record[res.StatusField!]) is { } o) badges.Children.Add(Ui.Badge(o.Label, o.Tone));
            if (screen.Archived) badges.Children.Add(Ui.Badge(L("Archived"), "muted"));
            header.Children.Add(badges);
            var figures = Ui.Row(28);
            foreach (var f in res.Fields.Where(f => f.Type == "money" && f.List == true && !FieldText.IsEmpty(record[f.Name])).Take(3))
                figures.Children.Add(Ui.Stack(2, Ui.TermLabel(f.Label, f.Term), Ui.H1(Fmt.Amount(record[f.Name].Num()), 24)));
            header.Children.Add(figures);
            if (screen.Locked is { } locked) header.Children.Add(Ui.Muted("🔒 " + locked));
            page.Children.Add(Ui.Card(header));

            var actions = new List<UIElement>();
            if (screen.CanEdit && !res.ReadOnly) actions.Add(Ui.Button(L("Edit"), () => state.Push(new Route.Form(resource, id)), icon: "FilePen"));
            if (screen.Pdf is { } pdf) actions.Add(Ui.Button("PDF", async () => await Files.OpenAsync(await state.Api.DownloadAsync(pdf)), icon: "FileText"));
            for (var i = 0; i < screen.Actions.Count; i++)
                if (res.Action(screen.Actions[i]) is { } a) actions.Add(ActionButton(res, id, a, i == 0, refresh));
            actions.Add(Ui.Button(L("Ask Batzi about this"), async () =>
            {
                state.Push(new Route.Batzi());
                await state.Batzi.SendAsync(L("About {label} {title}: ", ("label", res.Label), ("title", screen.Title)));
            }, icon: "Sparkles"));
            if (screen.CanDelete)
            {
                actions.Add(Ui.Button(res.SoftDelete ? L("Archive") : L("Delete"), async () =>
                {
                    var dialog = new ContentDialog { Title = res.SoftDelete ? L("Archive this record?") : L("Delete this record?"), PrimaryButtonText = res.SoftDelete ? L("Archive") : L("Delete"), CloseButtonText = L("Cancel"), XamlRoot = XamlRoot };
                    if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
                    await state.Api.SendAsync<JsonNode>("DELETE", $"/{resource}/{id}");
                    state.Toast(res.SoftDelete ? L("Archived") : L("Deleted"));
                    state.Pop();
                }, icon: "Trash2"));
            }
            page.Children.Add(Ui.Flow(actions, 10));

            var visible = res.Fields.Where(f => f.Hidden != true && f.Type != "json" && f.Name != "id" && !FieldText.IsEmpty(record[f.Name]));
            foreach (var (section, fields) in FieldText.Sections(visible))
            {
                var card = Ui.Stack(8);
                if (section is not null) card.Children.Add(Ui.Section(section));
                foreach (var f in fields)
                {
                    var row = new Grid { ColumnSpacing = 16 };
                    row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(220) });
                    row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                    row.Children.Add(Ui.TermLabel(f.Label, f.Term));
                    UIElement value;
                    if (f.Name == res.StatusField && f.Option(record[f.Name]) is { } so) value = Ui.Badge(so.Label, so.Tone);
                    else if (f.Type == "ref" && f.Ref is { } target && record[f.Name].Int() is { } refId)
                    {
                        var link = new HyperlinkButton { Content = FieldText.Text(f, record[f.Name], labels), Padding = new Thickness(0) };
                        link.Click += (_, _) => state.Push(new Route.Record(target, refId));
                        value = link;
                    }
                    else { var t = Ui.Body(FieldText.Text(f, record[f.Name], labels)); t.IsTextSelectionEnabled = true; value = t; }
                    Grid.SetColumn((FrameworkElement)value, 1);
                    row.Children.Add(value);
                    card.Children.Add(row);
                }
                page.Children.Add(Ui.Card(card));
            }

            foreach (var child in res.Children ?? [])
            {
                if (record[child.Name] is not JsonArray rows || rows.Count == 0) continue;
                var shown = child.Fields.Where(f => f.Hidden != true && f.Type != "json" && f.Name is not ("id" or "sort") && rows.Any(r => !FieldText.IsEmpty(r?[f.Name]))).Take(6).ToList();
                var table = new Grid { ColumnSpacing = 18, RowSpacing = 6 };
                foreach (var _ in shown) table.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                for (var c = 0; c < shown.Count; c++) { var h = Ui.Muted(shown[c].Label, 12); Grid.SetColumn(h, c); table.Children.Add(h); }
                for (var r = 0; r < rows.Count; r++)
                {
                    table.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                    for (var c = 0; c < shown.Count; c++)
                    {
                        var key = $"{child.Name}.{shown[c].Name}";
                        var cellLabels = labels.TryGetValue(key, out var l) ? new Labels { [shown[c].Name] = l } : null;
                        var cell = Ui.Body(FieldText.Text(shown[c], rows[r]?[shown[c].Name], cellLabels));
                        cell.MaxWidth = 320;
                        Grid.SetRow(cell, r + 1);
                        Grid.SetColumn(cell, c);
                        table.Children.Add(cell);
                    }
                }
                table.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                page.Children.Add(Ui.Card(Ui.Stack(10, Ui.Section(child.Label), new ScrollViewer { Content = table, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled })));
            }

            foreach (var rel in screen.Related.Where(r => r.Total > 0))
            {
                var card = Ui.Stack(6, Ui.Section($"{rel.Label} ({rel.Total})"));
                foreach (var r in rel.Rows)
                {
                    var link = new HyperlinkButton { Content = r.Title };
                    link.Click += (_, _) => state.Push(new Route.Record(rel.Resource, r.Id));
                    card.Children.Add(link);
                }
                page.Children.Add(Ui.Card(card));
            }

            var files = Ui.Stack(6, Ui.Row(8, Ui.Section(L("Attachments")), Ui.Button("+", async () =>
            {
                foreach (var f in await Files.PickAsync())
                    await state.Api.UploadAsync<JsonNode>("/files/upload", [f], "file", new Dictionary<string, string> { ["ref_type"] = resource, ["ref_id"] = id.ToString() });
                await refresh();
            }, compact: true)));
            foreach (var f in screen.Files)
            {
                var link = new HyperlinkButton { Content = $"📎 {f.Name} · {Fmt.Bytes(f.Size)}" };
                link.Click += (_, _) => state.Push(new Route.File(f.Id, f.Name));
                files.Children.Add(link);
            }
            if (screen.Files.Count == 0) files.Children.Add(Ui.Muted(L("Drop receipts or documents here to keep them with this record.")));
            page.Children.Add(Ui.Card(files));

            if (screen.History.Count > 0) page.Children.Add(Ui.Card(HistorySection(screen.History, refresh)));
            return Ui.Page(page);
        });
    }

    /// <summary>A record's history in words: who (a person or software), from where, before → after, and undo.</summary>
    private static StackPanel HistorySection(List<HistoryEntry> entries, Func<Task> refresh)
    {
        var state = AppState.Current;
        var history = Ui.Stack(14, Ui.Section(L("History")));
        foreach (var h in entries)
        {
            var who = new FontIcon { Glyph = h.Automated ? "\uE99A" : "\uE77B", FontSize = 14, Foreground = Ui.Brush(h.Automated ? "BzPrimaryBrush" : "BzMutedForegroundBrush") };
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(who, h.Automated ? L("Software") : L("Person"));
            var body = Ui.Stack(3, Ui.Strong(string.Join(" · ", new[] { h.Title ?? h.Summary ?? h.Action, h.Actor?.Name ?? h.ActorName, h.Actor?.SourceLabel }.Where(s => !string.IsNullOrEmpty(s)))));
            body.Children.Add(Ui.Muted(string.Join(" · ", new[] { h.When ?? Fmt.DateTime(h.At), h.Device }.Where(s => !string.IsNullOrEmpty(s))), 12));
            foreach (var p in h.Provenance ?? []) body.Children.Add(Ui.Muted(p.Detail is null ? p.Label : $"{p.Label}: {p.Detail}", 12));
            if (h.Undo?.UndoneBy is { } undoneBy) body.Children.Add(Ui.Muted(L("Undone in entry #{id}", ("id", undoneBy)), 12));
            foreach (var c in (h.Changes ?? []).Take(6))
            {
                var line = c.Kind switch { "added" => $"+ {c.To}", "removed" => $"− {c.From}", _ => $"{c.From ?? "–"} → {c.To ?? "–"}" };
                var text = Ui.Body($"{c.Label}: {line}", 12);
                if (c.Kind == "removed") text.Foreground = Ui.Brush("BzDestructiveBrush");
                body.Children.Add(text);
            }
            if ((h.Changes?.Count ?? 0) > 6) body.Children.Add(Ui.Muted(L("Show all {n} changes", ("n", h.Changes!.Count)), 12));
            if (h.Undo?.Possible == true)
            {
                Button? undo = null;
                undo = Ui.Button(L("Undo"), async () =>
                {
                    var dialog = new ContentDialog
                    {
                        Title = L("Undo this change?"),
                        Content = L("Puts the record back the way it was before this change (or removes what it created, or brings back what it deleted). Booked, issued or paid records are never rewritten."),
                        PrimaryButtonText = L("Undo"),
                        CloseButtonText = L("Cancel"),
                        DefaultButton = ContentDialogButton.Primary,
                        XamlRoot = undo!.XamlRoot,
                    };
                    if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
                    try
                    {
                        await state.Api.SendAsync<ActionResponse>("POST", $"/audit_log/{h.Id}/undo");
                        state.Toast(L("Change undone."));
                        state.Touch();
                        await refresh();
                    }
                    catch (ApiException e) { state.Toast(e.Message, "danger"); }
                }, compact: true);
                undo.HorizontalAlignment = HorizontalAlignment.Left;
                body.Children.Add(undo);
            }
            var row = new Grid { ColumnSpacing = 10 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.Children.Add(who);
            Grid.SetColumn(body, 1);
            row.Children.Add(body);
            history.Children.Add(row);
        }
        return history;
    }

    /// <summary>A workflow step on a record (issue, record payment, book…), with confirmation or inputs.</summary>
    private Button ActionButton(ResourceSchema res, int id, ActionDef action, bool primary, Func<Task> refresh)
    {
        var state = AppState.Current;
        return Ui.Button(action.Label, async () =>
        {
            var input = new JsonObject();
            if (action.Input is { Count: > 0 })
            {
                var values = new Dictionary<string, JsonNode?>();
                foreach (var f in action.Input) values[f.Name] = f.Default?.DeepClone() ?? (f.Type == "date" ? JsonValue.Create(Fmt.Today()) : null);
                var form = Ui.Stack(10, Ui.Muted(action.Description));
                foreach (var f in action.Input) form.Children.Add(FieldEditor.Create(f, values.GetValueOrDefault(f.Name), v => values[f.Name] = v));
                var dialog = new ContentDialog { Title = action.Label, Content = new ScrollViewer { Content = form }, PrimaryButtonText = action.Label, CloseButtonText = L("Cancel"), XamlRoot = XamlRoot };
                if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
                foreach (var (k, v) in values) input[k] = v?.DeepClone();
            }
            else if (action.Confirm is { } confirm)
            {
                var dialog = new ContentDialog { Title = confirm, Content = action.Description, PrimaryButtonText = action.Label, CloseButtonText = L("Cancel"), XamlRoot = XamlRoot };
                if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
            }
            var r = await state.Api.SendAsync<ActionResponse>("POST", $"/{res.Name}/{id}/{action.Name}", input);
            if (r.Message is { } m) state.Toast(m);
            if (r.Redirect is { } to) state.Push(new Route.Record(to.Resource, to.Id)); else state.Touch();
        }, prominent: primary && action.Variant != "destructive", icon: action.Icon);
    }
}

/// <summary>Creates or edits any record from its definition; documents get positions and live totals.</summary>
public sealed class RecordFormView : UserControl
{
    private readonly JsonObject _values = [];
    private Labels _labels = [];
    private readonly StackPanel _page = new() { Spacing = 16 };
    private readonly StackPanel _totals = new() { Spacing = 4 };
    private readonly TextBlock _message = Ui.Body("");
    private CancellationTokenSource? _recalc;

    public RecordFormView(string resource, int? id, JsonObject? prefill)
    {
        var state = AppState.Current;
        var res = state.Bootstrap?.Resource(resource);
        if (res is null) { Content = Ui.Empty(L("This module is not available to your role.")); return; }
        _message.Foreground = Ui.Brush("BzDestructiveBrush");
        Content = Ui.Load(async () =>
        {
            if (id is { } existing)
            {
                var s = await state.Api.GetAsync<RecordScreen>($"/app/records/{resource}/{existing}");
                _labels = s.Labels ?? [];
                return s.Record;
            }
            var fresh = await state.Api.GetAsync<NewRecord>($"/app/records/{resource}/new");
            foreach (var (k, v) in prefill ?? []) fresh.Values[k] = v?.DeepClone();
            return fresh.Values;
        }, (values, _) =>
        {
            foreach (var (k, v) in values) _values[k] = v?.DeepClone();
            Build(res, id);
            return Ui.Page(_page);
        });
    }

    private void Build(ResourceSchema res, int? id)
    {
        var state = AppState.Current;
        var editable = res.Fields.Where(f => f.IsEditable && !(id is not null && f.CreateOnly == true) && f.Name != "id").ToList();
        _page.Children.Clear();
        var save = Ui.Button(L("Save"), async () =>
        {
            var payload = new JsonObject();
            foreach (var f in editable) if (_values.ContainsKey(f.Name)) payload[f.Name] = _values[f.Name]?.DeepClone();
            foreach (var c in res.Children ?? []) if (_values.ContainsKey(c.Name)) payload[c.Name] = _values[c.Name]?.DeepClone();
            try
            {
                var saved = id is { } existing
                    ? await state.Api.SendAsync<JsonObject>("PATCH", $"/{res.Name}/{existing}", payload)
                    : await state.Api.SendAsync<JsonObject>("POST", $"/{res.Name}", payload);
                state.Toast(L("Saved."));
                state.Pop();
                if (id is null && saved["id"].Int() is { } newId) state.Push(new Route.Record(res.Name, newId));
            }
            catch (ApiException e) { _message.Text = e.Message + (e.Fields.Count > 0 ? "\n" + string.Join("\n", e.Fields.Select(kv => $"{kv.Key}: {kv.Value}")) : ""); }
        }, prominent: true);
        var title = id is null ? L("New {label}", ("label", res.Label)) : L("Edit {label}", ("label", res.Label));
        _page.Children.Add(Ui.Row(16, Ui.H1(title), save));
        _page.Children.Add(_message);
        foreach (var (section, fields) in FieldText.Sections(editable))
        {
            var card = Ui.Stack(10);
            if (section is not null) card.Children.Add(Ui.Section(section));
            foreach (var f in fields) card.Children.Add(FieldEditor.Create(f, _values[f.Name], v => { _values[f.Name] = v; Changed(res); }, _labels.GetValueOrDefault(f.Name)));
            _page.Children.Add(Ui.Card(card));
        }
        foreach (var child in res.Children ?? []) _page.Children.Add(Children(res, child));
        if (res.IsDocument) _page.Children.Add(Ui.Card(_totals));
        Changed(res);
    }

    private void Changed(ResourceSchema res)
    {
        if (!res.IsDocument) return;
        _recalc?.Cancel();
        var cts = _recalc = new CancellationTokenSource();
        _ = Task.Run(async () =>
        {
            try { await Task.Delay(250, cts.Token); } catch (TaskCanceledException) { return; }
            DocumentTotals? t = null;
            try
            {
                t = await AppState.Current.Api.SendAsync<DocumentTotals>("POST", "/app/documents/totals", Json.Obj(
                    ("positions", _values["positions"]?.DeepClone() ?? new JsonArray()),
                    ("vat_mode", _values["vat_mode"]?.DeepClone() ?? "excl"),
                    ("currency_code", _values["currency_code"]?.DeepClone() ?? "CHF")));
            }
            catch (ApiException) { }
            if (t is null || cts.IsCancellationRequested) return;
            DispatcherQueue.TryEnqueue(() =>
            {
                _totals.Children.Clear();
                _totals.Children.Add(Ui.Section(L("Totals")));
                void Line(string label, string value, bool bold = false)
                {
                    var g = new Grid();
                    g.Children.Add(bold ? Ui.Strong(label) : Ui.Body(label));
                    g.Children.Add(Ui.Number(value, bold ? 16 : 14, bold));
                    _totals.Children.Add(g);
                }
                Line(L("Net"), Fmt.Amount(t.TotalNet));
                foreach (var v in t.Vat) Line(L("VAT {rate}%", ("rate", Fmt.Number(v.Rate))), Fmt.Amount(v.Vat));
                if (t.Rounding != 0) Line(L("Rounding"), Fmt.Amount(t.Rounding));
                Line(L("Total"), Fmt.Money(t.Total, _values["currency_code"].Str() ?? "CHF"), true);
            });
        });
    }

    /// <summary>Positions and other child rows: add, edit, remove.</summary>
    private UIElement Children(ResourceSchema res, ChildDef child)
    {
        var rowsPanel = Ui.Stack(8);
        var editable = child.Fields.Where(f => f.IsEditable && f.Name is not ("id" or "sort")).ToList();
        var typeField = child.Fields.FirstOrDefault(f => f.Name == "type" && f.Type == "enum");
        var purchase = res.Name is "purchase_orders" or "bills";
        JsonArray Rows() => _values[child.Name] as JsonArray ?? (JsonArray)(_values[child.Name] = new JsonArray());

        void Render()
        {
            rowsPanel.Children.Clear();
            var rows = Rows();
            for (var i = 0; i < rows.Count; i++)
            {
                var index = i;
                var row = rows[i] as JsonObject ?? [];
                var main = (row["text"] ?? row["description"] ?? row["name"]).Str() ?? row["type"].Str() ?? $"#{i + 1}";
                var detail = row["quantity"].Num() is { } q && row["unit_price"].Num() is { } p ? $"{Fmt.Number(q)} × {Fmt.Amount(p)}" : row["amount"].Num() is { } a ? Fmt.Amount(a) : "";
                var edit = Ui.Button(main.Split('\n')[0], () => EditRow(index), compact: true);
                var remove = Ui.Button("✕", () => { Rows().RemoveAt(index); Render(); Changed(res); }, compact: true);
                rowsPanel.Children.Add(Ui.Row(10, edit, Ui.Muted(detail), remove));
            }
        }

        void Add(string? type)
        {
            var row = new JsonObject();
            foreach (var f in editable) if (f.Default is { } d) row[f.Name] = d.DeepClone();
            if (type is not null) row["type"] = type;
            if (child.Fields.Any(f => f.Name == "quantity") && !row.ContainsKey("quantity")) row["quantity"] = 1;
            Rows().Add(row);
            Render();
            EditRow(Rows().Count - 1);
        }

        async void EditRow(int index)
        {
            if (Rows()[index] is not JsonObject row) return;
            var form = Ui.Stack(10);
            foreach (var f in editable)
            {
                var labelKey = $"{child.Name}.{f.Name}";
                form.Children.Add(FieldEditor.Create(f, row[f.Name], async v =>
                {
                    row[f.Name] = v?.DeepClone();
                    if (f.Name == "item_id" && v.Int() is { } item)
                    {
                        try
                        {
                            var d = await AppState.Current.Api.GetAsync<ItemDefaults>($"/app/items/{item}/defaults", new Dictionary<string, string?> { ["purchase"] = purchase ? "1" : null });
                            row["text"] = d.Text;
                            row["unit_price"] = d.UnitPrice;
                            if (d.UnitName is { } u) row["unit_name"] = u;
                            if (d.TaxId is { } tax) row["tax_id"] = tax;
                            if (row["type"].Str() is null or "custom") row["type"] = "item";
                        }
                        catch (ApiException) { }
                    }
                }, _labels.GetValueOrDefault(labelKey)));
            }
            var dialog = new ContentDialog { Title = child.Label, Content = new ScrollViewer { Content = form, MaxHeight = 560 }, PrimaryButtonText = L("Done"), XamlRoot = XamlRoot };
            await dialog.ShowAsync();
            Render();
            Changed(res);
        }

        var add = new DropDownButton { Content = L("Add {label}", ("label", child.Label)) };
        var menu = new MenuFlyout();
        if (typeField?.Options is { } options)
        {
            foreach (var o in options) { var item = new MenuFlyoutItem { Text = o.Label }; item.Click += (_, _) => Add(o.Value); menu.Items.Add(item); }
        }
        else { var item = new MenuFlyoutItem { Text = child.Label }; item.Click += (_, _) => Add(null); menu.Items.Add(item); }
        add.Flyout = menu;
        Render();
        return Ui.Card(Ui.Stack(10, Ui.Section(child.Label), rowsPanel, add));
    }
}

/// <summary>The right WinUI control for a field type, bound to a JSON value. Plain fields, no neumorphism.</summary>
public static class FieldEditor
{
    public static UIElement Create(FieldDef f, JsonNode? value, Action<JsonNode?> onChange, Dictionary<string, string>? labels = null)
    {
        var header = f.Label + (f.Required == true ? " *" : "");
        UIElement control;
        switch (f.Type)
        {
            case "boolean":
                var toggle = new ToggleSwitch { Header = header, IsOn = value.Bool() == true };
                toggle.Toggled += (_, _) => onChange(toggle.IsOn);
                control = toggle;
                break;
            case "enum":
                var combo = new ComboBox { Header = header, MinWidth = 240 };
                if (f.Required != true) combo.Items.Add(new ComboBoxItem { Content = "—", Tag = null });
                foreach (var o in f.Options ?? []) combo.Items.Add(new ComboBoxItem { Content = o.Label, Tag = o.Value });
                combo.SelectedItem = combo.Items.OfType<ComboBoxItem>().FirstOrDefault(i => (string?)i.Tag == value.Str());
                combo.SelectionChanged += (_, _) => onChange((combo.SelectedItem as ComboBoxItem)?.Tag is string s ? JsonValue.Create(s) : null);
                control = combo;
                break;
            case "date":
            case "datetime":
                var date = new CalendarDatePicker { Header = header, DateFormat = "{day.integer(2)}.{month.integer(2)}.{year.full}" };
                if (Fmt.ParseDate(value.Str()) is { } d) date.Date = new DateTimeOffset(d.ToDateTime(TimeOnly.MinValue));
                date.DateChanged += (_, e) => onChange(e.NewDate is { } nd ? JsonValue.Create(nd.ToString("yyyy-MM-dd")) : null);
                control = date;
                break;
            case "int":
            case "decimal":
            case "money":
            case "percent":
                var number = new NumberBox { Header = header, Value = value.Num() ?? double.NaN, SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Hidden, MinWidth = 200 };
                number.ValueChanged += (_, e) => onChange(double.IsNaN(e.NewValue) ? null : JsonValue.Create(e.NewValue));
                control = number;
                break;
            case "ref":
                var current = value.Str() is { } id ? labels?.GetValueOrDefault(id) ?? $"#{id}" : L("Choose…");
                var pick = new Button { Content = current, MinWidth = 240, HorizontalContentAlignment = HorizontalAlignment.Left };
                pick.Click += async (_, _) =>
                {
                    var chosen = await RefPicker.ShowAsync(pick.XamlRoot, f.Ref ?? "", f.RefFilter, f.Required != true);
                    if (chosen is null) return;
                    pick.Content = chosen.Value.Option?.Label ?? L("Choose…");
                    onChange(chosen.Value.Option is { } o ? JsonValue.Create(o.Id) : null);
                };
                control = Ui.Stack(4, Ui.Muted(header), pick);
                break;
            case "json":
                return new StackPanel();
            default:
                var text = new TextBox { Header = header, Text = value.Display(), PlaceholderText = f.Placeholder ?? "", AcceptsReturn = f.Type == "text", TextWrapping = f.Type == "text" ? TextWrapping.Wrap : TextWrapping.NoWrap, MinHeight = f.Type == "text" ? 80 : 0 };
                text.TextChanged += (_, _) => onChange(text.Text.Length == 0 ? null : JsonValue.Create(text.Text));
                control = text;
                break;
        }
        var stack = Ui.Stack(4, control);
        if (AppState.Current.Bootstrap?.Explain(f.Term) is not null) stack.Children.Insert(0, Ui.TermLabel("", f.Term));
        if (f.Description is { } desc && f.Type != "boolean") stack.Children.Add(Ui.Muted(desc, 12));
        return stack;
    }
}

/// <summary>Picks a referenced record (contact, account, VAT code…).</summary>
public static class RefPicker
{
    /// <summary>Returns null when cancelled; Option is null for “None”.</summary>
    public static async Task<(RefOption? Option, bool _)?> ShowAsync(XamlRoot root, string resource, Dictionary<string, JsonNode?>? filter, bool allowsNone)
    {
        var state = AppState.Current;
        var search = new AutoSuggestBox { PlaceholderText = L("Search"), QueryIcon = new SymbolIcon(Symbol.Find) };
        var list = new ListView { Height = 360, SelectionMode = ListViewSelectionMode.Single };
        async Task Load(string q)
        {
            var query = new Dictionary<string, string?> { ["q"] = q };
            foreach (var (k, v) in filter ?? []) query[k] = v.Str();
            try
            {
                var options = await state.Api.GetAsync<List<RefOption>>($"/app/options/{resource}", query);
                list.ItemsSource = options.Select(o => new ListViewItem { Content = o.Label, Tag = o }).ToList();
            }
            catch (ApiException e) { state.Report(e); }
        }
        search.TextChanged += async (s, e) => { if (e.Reason == AutoSuggestionBoxTextChangeReason.UserInput) await Load(search.Text); };
        await Load("");
        var dialog = new ContentDialog
        {
            Title = state.Bootstrap?.Resource(resource)?.LabelPlural ?? resource,
            Content = Ui.Stack(10, search, list),
            PrimaryButtonText = L("Choose…"),
            SecondaryButtonText = allowsNone ? L("None") : "",
            CloseButtonText = L("Cancel"),
            XamlRoot = root,
        };
        list.DoubleTapped += (_, _) => dialog.Hide();
        var result = await dialog.ShowAsync();
        if (result == ContentDialogResult.Secondary) return (null, true);
        if ((list.SelectedItem as ListViewItem)?.Tag is RefOption chosen) return (chosen, true);
        return null;
    }
}
