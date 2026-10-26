using Batzio.Core;
using Batzio.Core.Format;
using Batzio.Core.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using static Batzio.App.Localization;

namespace Batzio.App.Views;

public sealed class TodayView : UserControl
{
    public TodayView()
    {
        var state = AppState.Current;
        Content = Ui.Load(() => state.Api.GetAsync<TodayScreen>("/app/today"), (today, refresh) =>
        {
            var page = Ui.Stack(20);
            page.Children.Add(Ui.Row(14, Ui.Coin(60), Ui.Stack(2, Ui.H1($"{today.Greeting}, {today.Name}"), Ui.Muted(state.Bootstrap?.Tenant.Name ?? "", 14))));
            page.Children.Add(new QuickComposer());
            if (today.Weather is { } w) page.Children.Add(Weather(w));
            if (today.Nudges.Count == 0) page.Children.Add(Ui.Empty(L("All clear"), L("Nothing needs you right now. Go outside.")));
            else
            {
                page.Children.Add(Ui.Stack(2, Ui.Section(L("Needs you")), Ui.Muted(L("Only what Batzi can’t decide for you."))));
                foreach (var n in today.Nudges) page.Children.Add(NudgeCard(n, refresh));
            }
            page.Children.Add(Inbox());
            return Ui.Page(page);
        });
    }

    private static UIElement Weather(MoneyWeather w)
    {
        var mood = w.Mood switch
        {
            "sunny" => L("Sunny: you are covered for the next 8 weeks."),
            "cloudy" => L("Cloudy: it gets tight around {date}.", ("date", Fmt.Date(w.Low.Week))),
            _ => L("Rain ahead: money runs short around {date}.", ("date", Fmt.Date(w.Low.Week))),
        };
        var stack = Ui.Stack(10, Ui.Section(L("Money weather")), Ui.H1(Fmt.Money(w.Cash), 32), Ui.Muted(mood, 14));
        if (w.Weeks.Count > 1)
        {
            double lo = w.Weeks.Min(x => x.Balance), hi = w.Weeks.Max(x => x.Balance);
            var pad = Math.Max(Math.Max((hi - lo) * 0.25, Math.Abs(hi) * 0.02), 1);
            const double width = 600, height = 110;
            var line = new Polyline { Stroke = Ui.Brush("BzPrimaryBrush"), StrokeThickness = 2.5, StrokeLineJoin = PenLineJoin.Round };
            for (var i = 0; i < w.Weeks.Count; i++)
                line.Points.Add(new Windows.Foundation.Point(width * i / (w.Weeks.Count - 1), height * (1 - (w.Weeks[i].Balance - (lo - pad)) / (hi - lo + 2 * pad))));
            stack.Children.Add(new Viewbox { Child = new Canvas { Width = width, Height = height, Children = { line } }, Stretch = Stretch.Fill, Height = height });
        }
        var totals = new Grid();
        totals.ColumnDefinitions.Add(new ColumnDefinition());
        totals.ColumnDefinitions.Add(new ColumnDefinition());
        totals.ColumnDefinitions.Add(new ColumnDefinition());
        var inc = Ui.Body("+ " + Fmt.Money(w.Incoming)); inc.Foreground = Ui.Brush("BzSuccessBrush");
        var mid = Ui.Muted(L("8 weeks ahead")); mid.HorizontalAlignment = HorizontalAlignment.Center;
        var outg = Ui.Body("− " + Fmt.Money(w.Outgoing)); outg.Foreground = Ui.Brush("BzDestructiveBrush"); outg.HorizontalAlignment = HorizontalAlignment.Right;
        totals.Children.Add(inc);
        Grid.SetColumn(mid, 1); totals.Children.Add(mid);
        Grid.SetColumn(outg, 2); totals.Children.Add(outg);
        stack.Children.Add(totals);
        return Ui.Card(stack);
    }

    private static UIElement NudgeCard(Nudge n, Func<Task> refresh)
    {
        var state = AppState.Current;
        var body = Ui.Stack(6, Ui.Strong(n.Title, 15));
        if (n.Text is { } t) body.Children.Add(Ui.Muted(t, 14));
        body.Children.Add(Ui.Flow(n.Actions.Where(a => a.Agent != true || state.Bootstrap?.Agent == true).Select(a => (UIElement)Ui.Button(a.Label, async () =>
        {
            switch (a.Kind)
            {
                case "link" when a.Target is { } target:
                    if (target.Kind == "file") state.Push(new Route.File(target.Id ?? 0, null)); else state.Go(target);
                    break;
                case "record_action":
                    var r = await state.Api.SendAsync<ActionResponse>("POST", $"/{a.Resource}/{a.Id}/{a.Action}");
                    if (r.Message is { } m) state.Toast(m);
                    await refresh();
                    break;
                case "remind_overdue":
                    var created = await state.Api.SendAsync<int>("POST", "/sales/reminders/run");
                    state.Toast(L("Reminders created: {n}", ("n", created)));
                    await refresh();
                    break;
                case "ask":
                    state.Push(new Route.Batzi());
                    await state.Batzi.SendAsync(a.Prompt ?? a.Label);
                    break;
                case "process_inbox":
                    state.Push(new Route.Batzi());
                    await state.Batzi.ProcessAsync(a.FileId, a.InboxId, a.Prompt);
                    break;
                case "dismiss_inbox":
                    await state.Api.SendAsync<System.Text.Json.Nodes.JsonNode>("PATCH", $"/app/inbox/{a.InboxId}", Json.Obj(("status", "done")));
                    await refresh();
                    break;
            }
        }, prominent: a.Primary == true, compact: true))));
        var grid = new Grid { ColumnSpacing = 14 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var icon = Ui.Icon(n.Icon, 18);
        icon.VerticalAlignment = VerticalAlignment.Top;
        grid.Children.Add(icon);
        Grid.SetColumn(body, 1); grid.Children.Add(body);
        if (n.Amount is { } amount) { var num = Ui.Number(Fmt.Amount(amount), 15, true); Grid.SetColumn(num, 2); grid.Children.Add(num); }
        return Ui.Card(grid);
    }

    private static UIElement Inbox()
    {
        var state = AppState.Current;
        var stack = Ui.Stack(10, Ui.Section(L("Inbox")), Ui.Muted(L("Drop receipts, bills, bank statements or spreadsheets anywhere in Batzio, or forward them by email.")));
        if (state.Bootstrap?.Inbox is { } address)
        {
            stack.Children.Add(Ui.Row(8, Ui.Body(address), Ui.Button(L("Copy"), () =>
            {
                var data = new Windows.ApplicationModel.DataTransfer.DataPackage();
                data.SetText(address);
                Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(data);
                state.Toast(L("Copied"));
            }, compact: true)));
        }
        stack.Children.Add(Ui.Button(L("Choose files"), async () => await state.DropAsync(await Files.PickAsync()), icon: "Upload"));
        return Ui.Card(stack);
    }
}

/// <summary>Type what happened in plain words; Batzi shows what it would do.</summary>
public sealed class QuickComposer : UserControl
{
    private readonly TextBox _input = new() { PlaceholderText = L("Type a quick sentence: “invoice Muster AG 3h consulting at 180”"), BorderThickness = new Thickness(0), Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent) };
    private readonly StackPanel _plan = new() { Spacing = 8 };
    private CancellationTokenSource? _typing;

    public QuickComposer()
    {
        var state = AppState.Current;
        _input.TextChanged += async (_, _) =>
        {
            _typing?.Cancel();
            var cts = _typing = new CancellationTokenSource();
            var text = _input.Text.Trim();
            if (text.Length < 3) { ShowExamples(); return; }
            try { await Task.Delay(300, cts.Token); } catch (TaskCanceledException) { return; }
            QuickPlan? plan = null;
            try { plan = await state.Api.SendAsync<QuickPlan?>("POST", "/app/quick/plan", Json.Obj(("text", text))); } catch (Core.Api.ApiException) { }
            if (!cts.IsCancellationRequested) ShowPlan(plan);
        };
        Content = Ui.Card(Ui.Stack(10, Ui.Row(10, Ui.Icon("Sparkles", 18), _input), _plan));
        _input.MinWidth = 420;
        ShowExamples();
    }

    private void ShowExamples()
    {
        _plan.Children.Clear();
        _plan.Children.Add(Ui.Flow((AppState.Current.Bootstrap?.Examples ?? []).Select(e => (UIElement)Ui.Button(e, () => _input.Text = e, compact: true))));
    }

    private void ShowPlan(QuickPlan? plan)
    {
        var state = AppState.Current;
        _plan.Children.Clear();
        if (plan is null) return;
        _plan.Children.Add(Ui.Strong(plan.Headline, 15));
        foreach (var d in plan.Details) _plan.Children.Add(Ui.Muted("• " + d));
        foreach (var w in plan.Warnings) { var t = Ui.Body("⚠ " + w); t.Foreground = Ui.Brush("BzWarningBrush"); _plan.Children.Add(t); }
        var buttons = plan.Actions.Select(a => (UIElement)Ui.Button(a.Label, async () =>
        {
            var outcome = await state.Api.SendAsync<QuickOutcome>("POST", "/app/quick/run", Json.Obj(("text", _input.Text), ("actionId", a.Id)));
            state.Toast(outcome.Message);
            _input.Text = "";
            state.Touch();
            if (outcome.Record is { } r) state.Open(r);
        }, prominent: a.Primary == true, compact: true)).ToList();
        if (state.Bootstrap?.Agent == true)
        {
            buttons.Add(Ui.Button(L("Ask Batzi instead"), async () =>
            {
                var text = _input.Text;
                _input.Text = "";
                state.Push(new Route.Batzi());
                await state.Batzi.SendAsync(text);
            }, compact: true));
        }
        _plan.Children.Add(Ui.Flow(buttons));
    }
}
