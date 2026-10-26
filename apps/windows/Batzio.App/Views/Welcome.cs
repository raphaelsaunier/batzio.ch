using System.Diagnostics;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using static Batzio.App.Localization;

namespace Batzio.App.Views;

/// <summary>The Batzio coin: tossed, spinning a few times, landing flat with a soft shadow. Click to flip.</summary>
public sealed class CoinControl : UserControl
{
    private readonly Image _face;
    private readonly ScaleTransform _scale = new();
    private readonly TranslateTransform _lift = new();
    private readonly Border _shadow;
    private readonly double _size;
    private readonly ImageSource? _front;
    private readonly ImageSource? _backSide;
    private double _angle;

    public CoinControl(double size = 180, bool autoplay = true)
    {
        _size = size;
        _face = Ui.Coin(size);
        _front = _face.Source;
        _backSide = Ui.Coin(size, back: true).Source;
        _face.RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5);
        _face.RenderTransform = new TransformGroup { Children = { _scale, _lift } };
        _shadow = new Border
        {
            Width = size * 0.8, Height = size * 0.09, CornerRadius = new CornerRadius(size),
            Background = new SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(70, 0, 0, 0)),
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        var grid = new Grid { Width = size, Height = size * 1.25 };
        grid.Children.Add(_shadow);
        grid.Children.Add(_face);
        _face.VerticalAlignment = VerticalAlignment.Top;
        Content = grid;
        Tapped += (_, _) => Animate(_angle, _angle + 180, 600, toss: false);
        if (autoplay) Loaded += (_, _) => Animate(0, 360 * 5, 2400, toss: true);
    }

    private void Animate(double from, double to, double ms, bool toss)
    {
        var clock = Stopwatch.StartNew();
        void Frame(object? sender, object e)
        {
            var t = Math.Min(1, clock.ElapsedMilliseconds / ms);
            var eased = 1 - Math.Pow(1 - t, 3);
            _angle = from + (to - from) * eased;
            var c = Math.Cos(_angle * Math.PI / 180);
            _scale.ScaleX = Math.Max(Math.Abs(c), 0.03);
            var source = c < 0 ? _backSide : _front;
            if (_face.Source != source) _face.Source = source;
            // Up and back down, with a little bounce at the end.
            var lift = toss ? Math.Sin(Math.Min(1, t * 1.25) * Math.PI) * (t < 0.8 ? 1 : 0.15 * Math.Sin((t - 0.8) * 5 * Math.PI)) : 0;
            _lift.Y = -lift * _size * 0.45;
            _shadow.Opacity = 1 - 0.6 * Math.Abs(lift);
            _shadow.Width = _size * (0.8 - 0.3 * Math.Abs(lift));
            if (t >= 1) CompositionTarget.Rendering -= Frame;
        }
        CompositionTarget.Rendering += Frame;
    }
}

/// <summary>“Accounting Suite” gets crossed out and becomes “Accounting, Sweet!”.</summary>
public sealed class CoinTagline : UserControl
{
    public CoinTagline()
    {
        var suite = new TextBlock { Text = "Accounting Suite", FontFamily = Ui.Display, FontSize = 26, Foreground = Ui.Brush("BzMutedForegroundBrush"), Opacity = 0, HorizontalAlignment = HorizontalAlignment.Center };
        var sweet = new TextBlock { Text = "Accounting, Sweet!", FontFamily = Ui.Display, FontWeight = FontWeights.Bold, FontSize = 30, Foreground = Ui.Brush("BzMetalBrush"), Opacity = 0, HorizontalAlignment = HorizontalAlignment.Center };
        var grid = new Grid { Height = 44 };
        grid.Children.Add(suite);
        grid.Children.Add(sweet);
        Content = grid;
        Loaded += async (_, _) =>
        {
            await Task.Delay(2600);
            suite.Opacity = 1;
            await Task.Delay(900);
            suite.TextDecorations = Windows.UI.Text.TextDecorations.Strikethrough;
            await Task.Delay(650);
            suite.Opacity = 0;
            sweet.Opacity = 1;
        };
    }
}

public sealed partial class WelcomeView : UserControl
{
    public WelcomeView()
    {
        var form = new ContentControl { HorizontalContentAlignment = HorizontalAlignment.Stretch };
        var tabs = new SelectorBar();
        var signIn = new SelectorBarItem { Text = L("Sign in"), IsSelected = true };
        var signUp = new SelectorBarItem { Text = L("Create account") };
        var device = new SelectorBarItem { Text = L("On this device") };
        tabs.Items.Add(signIn);
        tabs.Items.Add(signUp);
        tabs.Items.Add(device);
        form.Content = SignInForm();

        var server = new HyperlinkButton { Content = AppState.Current.Prefs.ServerUrl, HorizontalAlignment = HorizontalAlignment.Center };
        server.Click += async (_, _) =>
        {
            var box = new TextBox { Text = AppState.Current.Prefs.ServerUrl, Header = L("Server address") };
            var dialog = new ContentDialog { Title = L("Server address"), Content = box, PrimaryButtonText = L("Save"), CloseButtonText = L("Cancel"), XamlRoot = XamlRoot };
            if (await dialog.ShowAsync() == ContentDialogResult.Primary)
            {
                AppState.Current.Update(p => p with { ServerUrl = box.Text.Trim() });
                server.Content = box.Text.Trim();
            }
        };

        tabs.SelectionChanged += (_, _) =>
        {
            form.Content = tabs.SelectedItem == signUp ? SignUpForm() : tabs.SelectedItem == device ? DeviceForm() : SignInForm();
            server.Visibility = tabs.SelectedItem == device ? Visibility.Collapsed : Visibility.Visible;
        };

        var column = Ui.Stack(18,
            new CoinControl(170) { HorizontalAlignment = HorizontalAlignment.Center },
            new CoinTagline(),
            Ui.Muted(L("For people who would rather spend their time on something other than accounting. Drop a receipt, say what happened, Batzi does the books."), 15),
            ExperimentNotice(),
            Ui.Card(Ui.Stack(12, tabs, form), 22),
            server);
        column.MaxWidth = 440;
        column.HorizontalAlignment = HorizontalAlignment.Center;
        Content = new ScrollViewer { Content = new Border { Child = column, Padding = new Thickness(24, 48, 24, 24) } };
    }

    /// <summary>Batzio is an experiment, not a product to trust with real books.</summary>
    private static UIElement ExperimentNotice()
    {
        var text = new TextBlock { TextWrapping = TextWrapping.Wrap, FontSize = 12, FontFamily = Ui.Sans, Foreground = Ui.Brush("BzForegroundBrush") };
        text.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = "🧪 " + L("Batzio is a vibe-coding experiment.") + " ", FontWeight = FontWeights.SemiBold });
        text.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = L("Don’t use it for real data — and please don’t sue us.") });
        var warning = Ui.Brush("BzWarningBrush") is SolidColorBrush b ? b.Color : Microsoft.UI.Colors.Orange;
        return new Border
        {
            Child = text,
            Padding = new Thickness(14, 8, 14, 8),
            CornerRadius = new CornerRadius(12),
            Background = new SolidColorBrush(warning) { Opacity = 0.16 },
        };
    }

    private static UIElement SignInForm()
    {
        var email = new TextBox { Header = L("Email"), InputScope = new InputScope { Names = { new InputScopeName(InputScopeNameValue.EmailSmtpAddress) } } };
        var password = new PasswordBox { Header = L("Password") };
        var error = Ui.Body("");
        error.Foreground = Ui.Brush("BzDestructiveBrush");
        var submit = Ui.Button(L("Sign in"), async () =>
        {
            try { await AppState.Current.SignInAsync(email.Text.Trim(), password.Password); }
            catch (Core.Api.ApiException e) { error.Text = e.Message; }
        }, prominent: true);
        submit.HorizontalAlignment = HorizontalAlignment.Stretch;
        return Ui.Stack(12, email, password, error, submit);
    }

    private static UIElement SignUpForm()
    {
        var name = new TextBox { Header = L("Your name") };
        var email = new TextBox { Header = L("Email") };
        var password = new PasswordBox { Header = L("Password (at least 10 characters)") };
        var company = new TextBox { Header = L("Company name") };
        var language = new ComboBox { Header = L("Document language"), ItemsSource = new[] { "Deutsch", "Français", "Italiano", "English" }, SelectedIndex = 0 };
        var demo = new CheckBox { Content = L("Start with demo data"), IsChecked = true };
        var error = Ui.Body("");
        error.Foreground = Ui.Brush("BzDestructiveBrush");
        var submit = Ui.Button(L("Create account"), async () =>
        {
            var lang = new[] { "de", "fr", "it", "en" }[Math.Max(0, language.SelectedIndex)];
            try { await AppState.Current.SignUpAsync(name.Text, email.Text.Trim(), password.Password, company.Text, lang, demo.IsChecked == true); }
            catch (Core.Api.ApiException e) { error.Text = e.Message; }
        }, prominent: true);
        submit.HorizontalAlignment = HorizontalAlignment.Stretch;
        return Ui.Stack(12, name, email, password, company, language, demo, error, submit);
    }
}

/// <summary>Works without a server: SQLite files on this device, no account, no internet.</summary>
public sealed partial class WelcomeView
{
    private static UIElement DeviceForm()
    {
        var note = Ui.Muted(L("Everything stays on this device: no account and no internet needed. Batzi, the assistant, needs a connection and is off here."), 13);
        var error = Ui.Body("");
        error.Foreground = Ui.Brush("BzDestructiveBrush");
        if (AppState.Current.HasDeviceData)
        {
            var resume = Ui.Button(L("Continue on this device"), async () =>
            {
                try { await AppState.Current.ContinueOnDeviceAsync(); }
                catch (Core.Api.ApiException e) { error.Text = e.Message; }
            }, prominent: true);
            resume.HorizontalAlignment = HorizontalAlignment.Stretch;
            return Ui.Stack(12, note, error, resume);
        }
        var name = new TextBox { Header = L("Your name") };
        var company = new TextBox { Header = L("Company name") };
        var language = new ComboBox { Header = L("Document language"), ItemsSource = new[] { "Deutsch", "Français", "Italiano", "English" }, SelectedIndex = 0 };
        var demo = new CheckBox { Content = L("Start with demo data"), IsChecked = true };
        var submit = Ui.Button(L("Start on this device"), async () =>
        {
            if (string.IsNullOrWhiteSpace(name.Text) || string.IsNullOrWhiteSpace(company.Text)) return;
            var lang = new[] { "de", "fr", "it", "en" }[Math.Max(0, language.SelectedIndex)];
            try { await AppState.Current.StartOnDeviceAsync(name.Text.Trim(), company.Text.Trim(), lang, demo.IsChecked == true); }
            catch (Core.Api.ApiException e) { error.Text = e.Message; }
        }, prominent: true);
        submit.HorizontalAlignment = HorizontalAlignment.Stretch;
        return Ui.Stack(12, note, name, company, language, demo, error, submit);
    }
}

public sealed class CompanyView : UserControl
{
    public CompanyView()
    {
        var list = Ui.Stack(12, Ui.Coin(90), Ui.H1(L("Which company today?"), 26));
        var companies = AppState.Current.Prefs.Companies ?? [];
        foreach (var c in companies)
        {
            var b = Ui.Button(c.Name, async () => await AppState.Current.ChooseAsync(c));
            b.HorizontalAlignment = HorizontalAlignment.Stretch;
            list.Children.Add(b);
        }
        if (companies.Count == 0) list.Children.Add(Ui.Muted(L("You are not part of any company yet.")));
        var signOut = new HyperlinkButton { Content = L("Sign out"), HorizontalAlignment = HorizontalAlignment.Center };
        signOut.Click += (_, _) => AppState.Current.SignOut();
        list.Children.Add(signOut);
        list.MaxWidth = 420;
        list.HorizontalAlignment = HorizontalAlignment.Center;
        list.VerticalAlignment = VerticalAlignment.Center;
        Content = list;
    }
}
