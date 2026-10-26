using Batzio.Core.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using static Batzio.App.Localization;

namespace Batzio.App.Views;

/// <summary>Navigation pane from the server's sections, the current screen, and Batzi on the side.</summary>
public sealed class ShellView : UserControl
{
    private readonly NavigationView _nav = new()
    {
        IsSettingsVisible = false,
        PaneDisplayMode = NavigationViewPaneDisplayMode.Auto,
        IsBackButtonVisible = NavigationViewBackButtonVisible.Visible,
        OpenPaneLength = 280,
    };
    private readonly ContentControl _content = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch, VerticalContentAlignment = VerticalAlignment.Stretch };
    private readonly Grid _layout = new();
    private readonly ColumnDefinition _batziColumn = new() { Width = new GridLength(0) };
    private readonly BatziPanel _batzi = new();
    private Route? _shown;
    private int _depth;
    private int _revision = -1;
    private bool _syncing;

    public ShellView()
    {
        _layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _layout.ColumnDefinitions.Add(_batziColumn);
        _nav.Content = _content;
        _layout.Children.Add(_nav);
        Grid.SetColumn(_batzi, 1);
        _layout.Children.Add(_batzi);
        Content = _layout;

        _nav.SelectionChanged += (_, e) =>
        {
            if (_syncing || e.SelectedItem is not NavigationViewItem { Tag: NavItem item }) return;
            AppState.Current.Select(item);
        };
        _nav.BackRequested += (_, _) => AppState.Current.Pop();
        Refresh();
    }

    public bool BatziOpen
    {
        get => _batziColumn.Width.Value > 0;
        set => _batziColumn.Width = new GridLength(value ? 400 : 0);
    }

    /// <summary>Rebuilds the menu after a (re)load and shows the top of the back stack.</summary>
    public void Refresh()
    {
        var state = AppState.Current;
        var b = state.Bootstrap;
        if (b is null) return;
        _syncing = true;
        _nav.MenuItems.Clear();
        foreach (var section in b.Navigation)
        {
            if (!string.IsNullOrEmpty(section.Label)) _nav.MenuItems.Add(new NavigationViewItemHeader { Content = section.Label });
            foreach (var item in section.Items)
            {
                var nvi = new NavigationViewItem { Content = item.Title, Icon = Ui.Icon(item.Icon), Tag = item };
                _nav.MenuItems.Add(nvi);
                if (item.Key == state.Selected) _nav.SelectedItem = nvi;
            }
        }
        _nav.PaneHeader = Ui.Row(10, Ui.Coin(30), Ui.Strong(b.Tenant.Name, 15));
        _nav.PaneFooter = Footer();
        _nav.IsBackEnabled = state.Stack.Count > 1;
        _syncing = false;

        var top = state.Stack[^1];
        if (top is Route.Batzi) { BatziOpen = true; state.Stack.RemoveAt(state.Stack.Count - 1); top = state.Stack[^1]; }
        if (!Equals(top, _shown) || state.Stack.Count != _depth || state.Revision != _revision)
        {
            _shown = top;
            _depth = state.Stack.Count;
            _revision = state.Revision;
            _content.Content = Screen(top);
        }
        _batzi.Render();
    }

    private UIElement Footer()
    {
        var state = AppState.Current;
        var goggles = new ToggleSwitch { Header = L("Accountant goggles"), IsOn = state.IsAccountant, OnContent = L("Classic terms, every module"), OffContent = L("Classic terms, every module") };
        goggles.Toggled += async (_, _) => await state.SetModeAsync(goggles.IsOn ? "accountant" : "simple");
        var ask = Ui.Button(L("Ask Batzi"), () => { BatziOpen = !BatziOpen; }, prominent: true, icon: "Sparkles");
        ask.HorizontalAlignment = HorizontalAlignment.Stretch;
        var stack = Ui.Stack(10, ask, goggles);
        if (state.Prefs.User is { } u) stack.Children.Add(Ui.Stack(0, Ui.Strong(u.Name, 13), Ui.Muted(u.Email, 12)));
        stack.Margin = new Thickness(12);
        return stack;
    }

    /// <summary>Every screen, by route.</summary>
    private static UIElement Screen(Route route) => route switch
    {
        Route.Home h => Target(h.Target),
        Route.List l => new ResourceListView(l.Resource),
        Route.Record r => new RecordView(r.Resource, r.Id),
        Route.Form f => new RecordFormView(f.Resource, f.Id, f.Prefill),
        Route.Report r => new ReportView(r.Id),
        Route.File f => new FileView(f.Id, f.Name),
        Route.SettingsPage s => SettingsView.Page(s.Page),
        _ => new TodayView(),
    };

    private static UIElement Target(AppTarget t) => t.Kind switch
    {
        "today" => new TodayView(),
        "reports" when t.Report is { } id => new ReportView(id),
        "reports" => new ReportsView(),
        "resource" => new ResourceListView(t.Resource ?? "", AppState.Current.Bootstrap?.Navigation.SelectMany(s => s.Items).FirstOrDefault(i => i.Target == t)?.Tabs),
        "bank_import" => new BankImportView(),
        "payroll" => new PayrollView(),
        "settings" => new SettingsView(),
        _ => Ui.Empty(t.Href ?? ""),
    };
}

/// <summary>Batzi, streamed live, beside whatever is on screen.</summary>
public sealed class BatziPanel : UserControl
{
    private readonly StackPanel _messages = new() { Spacing = 12 };
    private readonly ScrollViewer _scroll = new();
    private readonly TextBox _input = new() { PlaceholderText = L("Ask Batzi anything…"), AcceptsReturn = false, TextWrapping = TextWrapping.Wrap };
    private readonly StackPanel _attachments = new() { Orientation = Orientation.Horizontal, Spacing = 6 };

    public BatziPanel()
    {
        var model = AppState.Current.Batzi;
        model.Changed += () => DispatcherQueue.TryEnqueue(Render);
        _scroll.Content = new Border { Child = _messages, Padding = new Thickness(16) };
        _input.KeyDown += async (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) await SendAsync(); };
        var history = new DropDownButton { Content = new FontIcon { Glyph = "" } };
        history.Click += async (_, _) =>
        {
            var menu = new MenuFlyout();
            var fresh = new MenuFlyoutItem { Text = L("New chat") };
            fresh.Click += (_, _) => model.Reset();
            menu.Items.Add(fresh);
            foreach (var t in (await model.ThreadsAsync()).Take(12))
            {
                var item = new MenuFlyoutItem { Text = t.Title };
                item.Click += async (_, _) => await model.LoadAsync(t.Id);
                menu.Items.Add(item);
            }
            menu.ShowAt(history);
        };
        var attach = new Button { Content = new FontIcon { Glyph = "" } };
        ToolTipService.SetToolTip(attach, L("Choose files"));
        attach.Click += async (_, _) => await model.AttachAsync(await Files.PickAsync());
        var send = new Button { Content = new FontIcon { Glyph = "" }, Style = (Style)Application.Current.Resources["BzMetalButtonStyle"] };
        send.Click += async (_, _) => await SendAsync();

        var header = new Grid { Padding = new Thickness(16, 12, 16, 12) };
        header.Children.Add(Ui.Row(8, Ui.Coin(28), Ui.Title("Batzi")));
        history.HorizontalAlignment = HorizontalAlignment.Right;
        header.Children.Add(history);

        var composer = new Grid { ColumnSpacing = 8, Padding = new Thickness(12) };
        composer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        composer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        composer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        composer.Children.Add(attach);
        Grid.SetColumn(_input, 1);
        composer.Children.Add(_input);
        Grid.SetColumn(send, 2);
        composer.Children.Add(send);

        var root = new Grid { Background = Ui.Brush("BzBackgroundBrush"), BorderBrush = Ui.Brush("BzBorderBrush"), BorderThickness = new Thickness(1, 0, 0, 0) };
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.Children.Add(header);
        Grid.SetRow(_scroll, 1);
        root.Children.Add(_scroll);
        Grid.SetRow(_attachments, 2);
        _attachments.Margin = new Thickness(16, 0, 16, 0);
        root.Children.Add(_attachments);
        Grid.SetRow(composer, 3);
        root.Children.Add(composer);
        root.AllowDrop = true;
        root.DragOver += (_, e) => e.AcceptedOperation = Windows.ApplicationModel.DataTransfer.DataPackageOperation.Copy;
        root.Drop += async (_, e) =>
        {
            if (e.DataView.Contains(Windows.ApplicationModel.DataTransfer.StandardDataFormats.StorageItems))
                await model.AttachAsync(await Files.ReadAsync(await e.DataView.GetStorageItemsAsync()));
        };
        Content = root;
        Render();
    }

    private async Task SendAsync()
    {
        var model = AppState.Current.Batzi;
        var text = _input.Text.Trim();
        if ((text.Length == 0 && model.Attachments.Count == 0) || model.Working) return;
        _input.Text = "";
        await model.SendAsync(text);
    }

    public void Render()
    {
        var state = AppState.Current;
        var model = state.Batzi;
        _messages.Children.Clear();
        if (model.Messages.Count == 0)
        {
            var intro = Ui.Stack(10, Ui.Title(L("Hi, I’m Batzi.")), Ui.Muted(L("Tell me what happened, drop a receipt or ask about your numbers. I keep the books, you keep your sanity.")));
            intro.Children.Add(Ui.Flow((state.Bootstrap?.Examples ?? []).Select(e => (UIElement)Ui.Button(e, () => _input.Text = e, compact: true))));
            if (state.Bootstrap?.Agent != true)
            {
                var warn = Ui.Body(L("Batzi needs an Anthropic API key on the server before it can chat. Quick sentences and file drops still work."));
                warn.Foreground = Ui.Brush("BzWarningBrush");
                intro.Children.Add(warn);
            }
            _messages.Children.Add(Ui.Card(intro));
        }
        foreach (var m in model.Messages)
        {
            var mine = m.Role == "user";
            var bubble = Ui.Stack(6);
            bubble.HorizontalAlignment = mine ? HorizontalAlignment.Right : HorizontalAlignment.Left;
            if (m.Streaming && m.Updates.Count > 0) bubble.Children.Add(Ui.Muted(m.Updates[^1], 12));
            foreach (var f in m.Files) bubble.Children.Add(Ui.Muted("📎 " + f.Name, 12));
            if (m.Text.Length > 0)
            {
                bubble.Children.Add(new Border
                {
                    CornerRadius = new CornerRadius(16),
                    Padding = new Thickness(14, 10, 14, 10),
                    Background = Ui.Brush(mine ? "BzAccentBrush" : "BzCardBrush"),
                    Child = new TextBlock { Text = m.Text, TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true, MaxWidth = 340, FontFamily = Ui.Sans },
                });
            }
            else if (m.Streaming) bubble.Children.Add(new ProgressRing { IsActive = true, Width = 18, Height = 18 });
            foreach (var t in m.Tools) bubble.Children.Add(ToolCard(t));
            if (m.Refused) bubble.Children.Add(Ui.Muted(L("Batzi declined this one."), 12));
            _messages.Children.Add(bubble);
        }
        _attachments.Children.Clear();
        foreach (var f in model.Attachments) _attachments.Children.Add(Ui.Badge("📎 " + f.Name, "info"));
        _scroll.UpdateLayout();
        _scroll.ChangeView(null, _scroll.ScrollableHeight, null);
    }

    private static UIElement ToolCard(ToolOutcome t)
    {
        var model = AppState.Current.Batzi;
        var title = Ui.Strong((t.Pending == true ? "✋ " : t.Ok ? "✓ " : "✕ ") + t.Title, 13);
        var stack = Ui.Stack(6, title);
        if (t.Summary is { } s) stack.Children.Add(Ui.Muted(s, 12));
        var actions = Ui.Row(8);
        if (t.Record is { } r) actions.Children.Add(Ui.Button(r.Label ?? L("Open"), () => AppState.Current.Open(r), compact: true));
        if (t.Pending == true)
        {
            actions.Children.Add(Ui.Button(L("Yes, do it"), () => model.ConfirmAsync(t, true), prominent: true, compact: true));
            actions.Children.Add(Ui.Button(L("No"), () => model.ConfirmAsync(t, false), compact: true));
        }
        stack.Children.Add(actions);
        return Ui.Card(stack, 12, 14);
    }
}
