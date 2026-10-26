using Batzio.Core.Api;
using Windows.Storage;
using Windows.Storage.Pickers;

namespace Batzio.App;

/// <summary>Reading dropped, shared and picked files; showing downloaded ones.</summary>
public static class Files
{
    public static async Task<List<UploadFile>> ReadAsync(IEnumerable<IStorageItem> items)
    {
        var files = new List<UploadFile>();
        foreach (var item in items.OfType<StorageFile>())
        {
            var buffer = await FileIO.ReadBufferAsync(item);
            var bytes = new byte[buffer.Length];
            using (var reader = Windows.Storage.Streams.DataReader.FromBuffer(buffer)) reader.ReadBytes(bytes);
            files.Add(new UploadFile(item.Name, string.IsNullOrEmpty(item.ContentType) ? "application/octet-stream" : item.ContentType, bytes));
        }
        return files;
    }

    public static async Task<List<UploadFile>> PickAsync(bool multiple = true, params string[] types)
    {
        var picker = new FileOpenPicker();
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(App.Window!));
        foreach (var t in types.Length > 0 ? types : ["*"]) picker.FileTypeFilter.Add(t);
        if (multiple) return await ReadAsync(await picker.PickMultipleFilesAsync() ?? []);
        var one = await picker.PickSingleFileAsync();
        return one is null ? [] : await ReadAsync([one]);
    }

    /// <summary>Saves a download to the temp folder and opens it with the default app.</summary>
    public static async Task OpenAsync(Download d)
    {
        var folder = await ApplicationData.Current.TemporaryFolder.CreateFolderAsync("downloads", CreationCollisionOption.OpenIfExists);
        var file = await folder.CreateFileAsync(d.FileName.Replace('/', '-'), CreationCollisionOption.ReplaceExisting);
        await FileIO.WriteBytesAsync(file, d.Bytes);
        await Windows.System.Launcher.LaunchFileAsync(file);
    }
}
