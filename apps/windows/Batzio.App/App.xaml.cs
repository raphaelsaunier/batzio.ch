using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using Windows.ApplicationModel.Activation;
using Windows.Storage;

namespace Batzio.App;

public partial class App : Application
{
    public static MainWindow? Window { get; private set; }

    public App()
    {
        InitializeComponent();
    }

    protected override async void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        Window = new MainWindow();
        Window.Activate();
        await AppState.Current.StartAsync();

        // Shared from another app, or a receipt/statement opened with Batzio: straight to the inbox.
        var activation = AppInstance.GetCurrent().GetActivatedEventArgs();
        IReadOnlyList<IStorageItem>? items = null;
        if (activation.Kind == ExtendedActivationKind.ShareTarget && activation.Data is IShareTargetActivatedEventArgs share)
        {
            var op = share.ShareOperation;
            if (op.Data.Contains(Windows.ApplicationModel.DataTransfer.StandardDataFormats.StorageItems)) items = await op.Data.GetStorageItemsAsync();
            op.ReportCompleted();
        }
        else if (activation.Kind == ExtendedActivationKind.File && activation.Data is IFileActivatedEventArgs file)
        {
            items = file.Files;
        }
        if (items is { Count: > 0 }) await AppState.Current.DropAsync(await Files.ReadAsync(items));
    }
}
