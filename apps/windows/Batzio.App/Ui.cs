using System.Numerics;
using Batzio.Core.Design;
using Microsoft.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.UI;

namespace Batzio.App;

/// <summary>
/// Small builders for Batzio's look: neumorphic cards and buttons on the page surface,
/// display headings, badges in the web's tones. Fields keep WinUI's plain controls.
/// </summary>
public static class Ui
{
    private static bool IsDark => AppState.Current.Prefs.Appearance switch
    {
        "dark" => true,
        "light" => false,
        _ => Application.Current.RequestedTheme == ApplicationTheme.Dark,
    };

    /// <summary>A token resource for the current appearance (Tokens.xaml theme dictionaries).</summary>
    public static object? Resource(string key)
    {
        var theme = IsDark ? "Dark" : "Light";
        foreach (var dict in Application.Current.Resources.MergedDictionaries)
        {
            if (dict.ThemeDictionaries.TryGetValue(theme, out var t) && t is ResourceDictionary rd && rd.TryGetValue(key, out var v)) return v;
            if (dict.TryGetValue(key, out var direct)) return direct;
        }
        return Application.Current.Resources.TryGetValue(key, out var any) ? any : null;
    }

    public static Brush Brush(string key) => Resource(key) as Brush ?? new SolidColorBrush(Colors.Gray);
    public static Color Color(string key) => Resource(key) is Color c ? c : Colors.Gray;
    public static FontFamily Display => Resource("BzDisplayFont") as FontFamily ?? new FontFamily("Segoe UI Variable Display");
    public static FontFamily Sans => Resource("BzSansFont") as FontFamily ?? new FontFamily("Segoe UI Variable Text");

    public static TextBlock H1(string text, double size = 30) => new() { Text = text, FontFamily = Display, FontWeight = FontWeights.Bold, FontSize = size, TextWrapping = TextWrapping.Wrap, Foreground = Brush("BzForegroundBrush") };
    public static TextBlock Title(string text) => H1(text, 20);
    public static TextBlock Body(string text, double size = 14) => new() { Text = text, FontFamily = Sans, FontSize = size, TextWrapping = TextWrapping.Wrap, Foreground = Brush("BzForegroundBrush") };
    public static TextBlock Muted(string text, double size = 13) => new() { Text = text, FontFamily = Sans, FontSize = size, TextWrapping = TextWrapping.Wrap, Foreground = Brush("BzMutedForegroundBrush") };
    public static TextBlock Strong(string text, double size = 14) => new() { Text = text, FontFamily = Sans, FontSize = size, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap, Foreground = Brush("BzForegroundBrush") };
    public static TextBlock Number(string text, double size = 14, bool bold = false) => new() { Text = text, FontFamily = Sans, FontSize = size, FontWeight = bold ? FontWeights.Bold : FontWeights.Medium, HorizontalAlignment = HorizontalAlignment.Right, Foreground = Brush("BzForegroundBrush") };

    public static TextBlock Section(string text) => new()
    {
        Text = text.ToUpperInvariant(), FontFamily = Sans, FontSize = 12, FontWeight = FontWeights.SemiBold, CharacterSpacing = 60, Foreground = Brush("BzMutedForegroundBrush"),
    };

    public static StackPanel Stack(double spacing = 12, params UIElement[] children)
    {
        var s = new StackPanel { Spacing = spacing };
        foreach (var c in children) s.Children.Add(c);
        return s;
    }

    public static StackPanel Row(double spacing = 8, params UIElement[] children)
    {
        var s = new StackPanel { Orientation = Orientation.Horizontal, Spacing = spacing };
        foreach (var c in children) s.Children.Add(c);
        return s;
    }

    /// <summary>Wraps chips and buttons onto new lines.</summary>
    public static WrapPanel Flow(IEnumerable<UIElement> children, double spacing = 8)
    {
        var p = new WrapPanel { Spacing = spacing };
        foreach (var c in children) p.Children.Add(c);
        return p;
    }

    /// <summary>A raised, softly extruded card: lit edge at the top left, shadow at the bottom right.</summary>
    public static Border Card(UIElement child, double padding = 18, double radius = 18) => new()
    {
        Child = child,
        Padding = new Thickness(padding),
        CornerRadius = new CornerRadius(radius),
        Background = Brush("BzNeuSurfaceBrush"),
        BorderThickness = new Thickness(1.5),
        BorderBrush = new LinearGradientBrush(new GradientStopCollection
        {
            new GradientStop { Color = Color("BzNeuLightColor"), Offset = 0 },
            new GradientStop { Color = Microsoft.UI.ColorHelper.FromArgb(0, 0, 0, 0), Offset = 0.5 },
            new GradientStop { Color = Color("BzNeuDarkColor"), Offset = 1 },
        }, 45),
        Shadow = new ThemeShadow(),
        Translation = new Vector3(0, 0, 14),
    };

    /// <summary>Soft raised button; <paramref name="prominent"/> gets the minted-metal gradient.</summary>
    public static Button Button(string text, Action onClick, bool prominent = false, bool compact = false, string? icon = null)
    {
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        if (icon is not null) content.Children.Add(new FontIcon { Glyph = BzIcons.Glyph(icon), FontSize = compact ? 12 : 14 });
        content.Children.Add(new TextBlock { Text = text, FontFamily = Sans, FontWeight = FontWeights.SemiBold, FontSize = compact ? 12 : 14 });
        var b = new Button { Content = content, Padding = compact ? new Thickness(12, 5, 12, 5) : new Thickness(18, 9, 18, 9) };
        if (prominent && Application.Current.Resources.TryGetValue("BzMetalButtonStyle", out var style)) b.Style = (Style)style;
        b.Click += (_, _) => onClick();
        return b;
    }

    public static Button Button(string text, Func<Task> onClick, bool prominent = false, bool compact = false, string? icon = null)
    {
        Button? b = null;
        b = Button(text, async () =>
        {
            b!.IsEnabled = false;
            try { await onClick(); }
            catch (Core.Api.ApiException e) { AppState.Current.Report(e); }
            finally { b.IsEnabled = true; }
        }, prominent, compact, icon);
        return b;
    }

    /// <summary>A small coloured label for statuses (tones match the web badges).</summary>
    public static Border Badge(string text, string? tone)
    {
        var color = tone switch
        {
            "success" => Color("BzSuccessColor"),
            "warning" => Color("BzWarningColor"),
            "danger" => Color("BzDestructiveColor"),
            "info" => Color("BzInfoColor"),
            "primary" => Color("BzPrimaryColor"),
            _ => Color("BzMutedForegroundColor"),
        };
        return new Border
        {
            CornerRadius = new CornerRadius(999),
            Padding = new Thickness(8, 2, 8, 2),
            Background = new SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(36, color.R, color.G, color.B)),
            Child = new TextBlock { Text = text, FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = new SolidColorBrush(color) },
            VerticalAlignment = VerticalAlignment.Center,
        };
    }

    public static Image Coin(double size, bool back = false) => new()
    {
        Source = new BitmapImage(new Uri($"ms-appx:///Assets/{(back ? "CoinBack" : "CoinFront")}.png")),
        Width = size,
        Height = size,
    };

    public static FontIcon Icon(string? name, double size = 16) => new() { Glyph = BzIcons.Glyph(name), FontSize = size };

    /// <summary>A scrolling page column with the app's background.</summary>
    public static ScrollViewer Page(UIElement content, double maxWidth = 960) => new()
    {
        Content = new Border { Child = content, Padding = new Thickness(24), MaxWidth = maxWidth, HorizontalAlignment = HorizontalAlignment.Stretch },
        HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
    };

    public static UIElement Empty(string title, string? text = null)
    {
        var s = Stack(10, Coin(72), H1(title, 20));
        if (text is not null) s.Children.Add(Muted(text, 14));
        s.HorizontalAlignment = HorizontalAlignment.Center;
        s.Margin = new Thickness(32);
        s.MaxWidth = 460;
        foreach (var c in s.Children.OfType<FrameworkElement>()) c.HorizontalAlignment = HorizontalAlignment.Center;
        return s;
    }

    public static UIElement Error(string message, Func<Task>? retry = null)
    {
        var s = (StackPanel)Empty(Localization.L("Something went wrong"), message);
        if (retry is not null) s.Children.Add(Button(Localization.L("Try again"), retry));
        return s;
    }

    public static UIElement Loading() => new ProgressRing { IsActive = true, Width = 40, Height = 40, Margin = new Thickness(40), HorizontalAlignment = HorizontalAlignment.Center };

    /// <summary>Shows a spinner, loads, then renders; errors become a retry card.</summary>
    public static ContentControl Load<T>(Func<Task<T>> load, Func<T, Func<Task>, UIElement> render)
    {
        var host = new ContentControl { HorizontalContentAlignment = HorizontalAlignment.Stretch, VerticalContentAlignment = VerticalAlignment.Stretch, Content = Loading() };
        async Task Refresh()
        {
            try { host.Content = render(await load(), Refresh); }
            catch (Core.Api.ApiException e) { host.Content = Error(e.Message, Refresh); }
        }
        _ = Refresh();
        return host;
    }

    /// <summary>A label with a jargon explanation when the term is in the glossary.</summary>
    public static UIElement TermLabel(string text, string? term)
    {
        var label = Muted(text);
        var entry = AppState.Current.Bootstrap?.Explain(term);
        if (entry is null) return label;
        var help = new Button
        {
            Content = new FontIcon { Glyph = "", FontSize = 12 },
            Padding = new Thickness(4),
            Background = new SolidColorBrush(Colors.Transparent),
            BorderThickness = new Thickness(0),
            Flyout = new Flyout { Content = Stack(6, Title(entry.Term), Body(entry.Text)) },
        };
        ToolTipService.SetToolTip(help, Localization.L("What does this mean?"));
        return Row(4, label, help);
    }
}

/// <summary>Lays children out left to right and wraps them onto new lines.</summary>
public sealed class WrapPanel : Panel
{
    public double Spacing { get; set; } = 8;

    protected override Windows.Foundation.Size MeasureOverride(Windows.Foundation.Size available)
    {
        double x = 0, y = 0, row = 0, width = 0;
        foreach (var child in Children)
        {
            child.Measure(new Windows.Foundation.Size(available.Width, double.PositiveInfinity));
            var size = child.DesiredSize;
            if (x > 0 && x + size.Width > available.Width) { x = 0; y += row + Spacing; row = 0; }
            x += size.Width + Spacing;
            row = Math.Max(row, size.Height);
            width = Math.Max(width, x - Spacing);
        }
        return new Windows.Foundation.Size(double.IsInfinity(available.Width) ? width : Math.Min(width, available.Width), y + row);
    }

    protected override Windows.Foundation.Size ArrangeOverride(Windows.Foundation.Size final)
    {
        double x = 0, y = 0, row = 0;
        foreach (var child in Children)
        {
            var size = child.DesiredSize;
            if (x > 0 && x + size.Width > final.Width) { x = 0; y += row + Spacing; row = 0; }
            child.Arrange(new Windows.Foundation.Rect(x, y, Math.Min(size.Width, final.Width), size.Height));
            x += size.Width + Spacing;
            row = Math.Max(row, size.Height);
        }
        return final;
    }
}
