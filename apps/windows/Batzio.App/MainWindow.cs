using Batzio.App.Views;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.ApplicationModel.DataTransfer;

namespace Batzio.App;

/// <summary>The one window: whatever <see cref="AppState"/> shows, toasts on top, files dropped anywhere go to the inbox.</summary>
public sealed class MainWindow : Window
{
    private readonly Grid _root = new() { AllowDrop = true };
    private readonly ContentControl _host = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch, VerticalContentAlignment = VerticalAlignment.Stretch };
    private readonly StackPanel _toasts = new() { Spacing = 8, Margin = new Thickness(16), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom, MaxWidth = 520 };

    public MainWindow()
    {
        Title = "Batzio";
        ExtendsContentIntoTitleBar = true;
        AppWindow.SetIcon("Assets/Square44x44Logo.targetsize-24_altform-unplated.png");
        _root.Children.Add(_host);
        _root.Children.Add(_toasts);
        _root.DragOver += (_, e) =>
        {
            e.AcceptedOperation = DataPackageOperation.Copy;
            e.DragUIOverride.Caption = Localization.L("Drop it — Batzi takes care of it");
        };
        _root.Drop += async (_, e) =>
        {
            if (!e.DataView.Contains(StandardDataFormats.StorageItems)) return;
            await AppState.Current.DropAsync(await Files.ReadAsync(await e.DataView.GetStorageItemsAsync()));
        };
        Content = _root;
        AppState.Current.Changed += Render;
        AppState.Current.Toasted += ShowToast;
        Render();
    }

    /// <summary>Signed out, picking a company, loading, or the app itself.</summary>
    private void Render()
    {
        var state = AppState.Current;
        _root.RequestedTheme = state.Prefs.Appearance switch { "light" => ElementTheme.Light, "dark" => ElementTheme.Dark, _ => ElementTheme.Default };
        _root.Background = Ui.Brush("BzBackgroundBrush");
        _host.Content = state.Phase switch
        {
            AppState.PhaseKind.SignedOut => new WelcomeView(),
            AppState.PhaseKind.ChoosingCompany => new CompanyView(),
            AppState.PhaseKind.Ready => _host.Content as ShellView ?? new ShellView(),
            AppState.PhaseKind.Failed => Ui.Error(state.Failure ?? "", async () => await state.StartAsync()),
            _ => new ProgressRing { IsActive = true, Width = 48, Height = 48 },
        };
        if (state.Phase == AppState.PhaseKind.Ready && _host.Content is ShellView shell) shell.Refresh();
    }

    private void ShowToast(string text, string tone)
    {
        var bar = new InfoBar
        {
            Message = text,
            IsOpen = true,
            Severity = tone switch { "danger" => InfoBarSeverity.Error, "info" => InfoBarSeverity.Informational, _ => InfoBarSeverity.Success },
        };
        _toasts.Children.Add(bar);
        var timer = DispatcherQueue.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(4);
        timer.IsRepeating = false;
        timer.Tick += (_, _) => _toasts.Children.Remove(bar);
        timer.Start();
    }
}
