using System.Text.Json.Nodes;
using Batzio.Core;
using Batzio.Core.Format;
using Batzio.Core.Models;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using static Batzio.App.Localization;

namespace Batzio.App.Views;

public sealed class ReportsView : UserControl
{
    public ReportsView()
    {
        var state = AppState.Current;
        var cards = (state.Bootstrap?.Reports ?? []).Select(r =>
        {
            var card = Ui.Card(Ui.Stack(8, Ui.Icon(r.Icon, 22), Ui.Title(r.Title), Ui.Muted(r.Text)));
            card.Width = 300;
            var button = new Button { Content = card, Padding = new Thickness(0), Background = null, BorderThickness = new Thickness(0) };
            button.Click += (_, _) => state.Push(new Route.Report(r.Id));
            return (UIElement)button;
        });
        Content = Ui.Page(Ui.Stack(18, Ui.H1(L("Insights")), Ui.Flow(cards, 18)), 1100);
    }
}

/// <summary>Any report as tables: parameters, key figures, PDF and Excel.</summary>
public sealed class ReportView : UserControl
{
    private readonly string _id;
    private readonly ContentControl _body = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private DateOnly _from = new(DateTime.Today.Year, 1, 1), _to = new(DateTime.Today.Year, 12, 31), _date = DateOnly.FromDateTime(DateTime.Today);
    private int _year = DateTime.Today.Year;
    private RefOption? _account;

    public ReportView(string id)
    {
        _id = id;
        Content = _body;
        _ = LoadAsync();
    }

    private ReportInfo? Info => AppState.Current.Bootstrap?.Reports.FirstOrDefault(r => r.Id == _id);

    private Dictionary<string, string?> Query() => Info?.Params switch
    {
        "date" => new() { ["date"] = _date.ToString("yyyy-MM-dd") },
        "period" => new() { ["from"] = _from.ToString("yyyy-MM-dd"), ["to"] = _to.ToString("yyyy-MM-dd") },
        "ledger" => new() { ["from"] = _from.ToString("yyyy-MM-dd"), ["to"] = _to.ToString("yyyy-MM-dd"), ["account_id"] = _account?.Id.ToString() },
        "year" => new() { ["year"] = _year.ToString() },
        _ => new(),
    };

    private async Task LoadAsync()
    {
        var state = AppState.Current;
        _body.Content = Ui.Loading();
        try
        {
            var report = await state.Api.GetAsync<ReportScreen>($"/app/reports/{_id}", Query());
            var page = Ui.Stack(16, Ui.H1(report.Title), Controls(report), Ui.Muted(report.Subtitle, 14));
            if (report.Balanced == false) { var w = Ui.Body(L("Assets and liabilities do not balance yet.")); w.Foreground = Ui.Brush("BzWarningBrush"); page.Children.Add(w); }
            if (report.Summary.Count > 0)
            {
                page.Children.Add(Ui.Flow(report.Summary.Select(s =>
                {
                    var value = Ui.H1(Fmt.Amount(s.Value), 22);
                    if (s.Tone == "danger") value.Foreground = Ui.Brush("BzDestructiveBrush");
                    if (s.Tone == "success") value.Foreground = Ui.Brush("BzSuccessBrush");
                    return (UIElement)Ui.Card(Ui.Stack(2, Ui.Muted(s.Label, 12), value), 14, 16);
                }), 12));
            }
            foreach (var t in report.Tables) page.Children.Add(Table(t));
            _body.Content = Ui.Page(page, 1100);
        }
        catch (Core.Api.ApiException e) { _body.Content = Ui.Error(e.Message, LoadAsync); }
    }

    private UIElement Controls(ReportScreen report)
    {
        var state = AppState.Current;
        var row = new List<UIElement>();
        DateOnly? Pick(CalendarDatePicker p) => p.Date is { } d ? DateOnly.FromDateTime(d.DateTime) : null;
        CalendarDatePicker DatePicker(string header, DateOnly value, Action<DateOnly> set)
        {
            var p = new CalendarDatePicker { Header = header, Date = new DateTimeOffset(value.ToDateTime(TimeOnly.MinValue)), DateFormat = "{day.integer(2)}.{month.integer(2)}.{year.full}" };
            p.DateChanged += async (_, _) => { if (Pick(p) is { } d) { set(d); await LoadAsync(); } };
            return p;
        }
        switch (Info?.Params)
        {
            case "date":
                row.Add(DatePicker(L("As of"), _date, d => _date = d));
                break;
            case "period":
            case "ledger":
                row.Add(DatePicker(L("From"), _from, d => _from = d));
                row.Add(DatePicker(L("To"), _to, d => _to = d));
                if (Info.Params == "ledger")
                {
                    row.Add(Ui.Button(_account?.Label ?? L("Choose account"), async () =>
                    {
                        if (await RefPicker.ShowAsync(XamlRoot, "accounts", null, false) is { Option: { } o }) { _account = o; await LoadAsync(); }
                    }));
                }
                break;
            case "year":
                row.Add(Ui.Button("‹", async () => { _year--; await LoadAsync(); }, compact: true));
                row.Add(Ui.Strong(_year.ToString(), 16));
                row.Add(Ui.Button("›", async () => { _year++; await LoadAsync(); }, compact: true));
                break;
        }
        if (report.Pdf is { } pdf) row.Add(Ui.Button("PDF", async () =>
        {
            var q = Query();
            q["format"] = "pdf";
            await Files.OpenAsync(await state.Api.DownloadAsync(pdf, q));
        }, icon: "FileText"));
        row.Add(Ui.Button("Excel", async () =>
        {
            var q = Query();
            q["format"] = "xlsx";
            await Files.OpenAsync(await state.Api.DownloadAsync($"/app/reports/{_id}", q));
        }, icon: "FileSpreadsheet"));
        return Ui.Flow(row, 10);
    }

    private static UIElement Table(ReportTable table)
    {
        var state = AppState.Current;
        var grid = new Grid { ColumnSpacing = 20, RowSpacing = 6 };
        for (var c = 0; c < table.Columns.Count; c++)
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = table.Columns[c].Type == "text" ? new GridLength(1, GridUnitType.Star) : GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        for (var c = 0; c < table.Columns.Count; c++)
        {
            var head = Ui.TermLabel(table.Columns[c].Label, table.Columns[c].Term);
            if (table.Columns[c].IsNumeric) ((FrameworkElement)head).HorizontalAlignment = HorizontalAlignment.Right;
            Grid.SetColumn((FrameworkElement)head, c);
            grid.Children.Add(head);
        }
        for (var r = 0; r < table.Rows.Count; r++)
        {
            var row = table.Rows[r];
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var bold = row.Style is "total" or "section";
            for (var c = 0; c < table.Columns.Count; c++)
            {
                var col = table.Columns[c];
                var v = c < row.Cells.Count ? row.Cells[c] : null;
                var text = col.Type switch
                {
                    "money" => v.Num() is { } m ? Fmt.Amount(m) : "",
                    "number" => v.Num() is { } n ? Fmt.Number(n) : "",
                    "date" => Fmt.Date(v.Str()),
                    _ => v.Display(),
                };
                FrameworkElement cell;
                if (c == 1 && row.Link is { } link)
                {
                    var b = new HyperlinkButton { Content = text, Padding = new Thickness(0) };
                    b.Click += (_, _) => state.Push(new Route.Record(link.Resource, link.Id));
                    cell = b;
                }
                else
                {
                    var t = col.IsNumeric ? Ui.Number(text, 14, bold) : Ui.Body(text);
                    if (bold) t.FontWeight = FontWeights.SemiBold;
                    if (row.Style == "muted") t.Foreground = Ui.Brush("BzMutedForegroundBrush");
                    cell = t;
                }
                if (c == 1 && row.Indent is { } indent) cell.Margin = new Thickness(indent * 14, 0, 0, 0);
                Grid.SetRow(cell, r + 1);
                Grid.SetColumn(cell, c);
                grid.Children.Add(cell);
            }
        }
        var stack = Ui.Stack(10);
        if (table.Title is { } title) stack.Children.Add(Ui.Title(title));
        stack.Children.Add(new ScrollViewer { Content = grid, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled });
        return Ui.Card(stack);
    }
}
