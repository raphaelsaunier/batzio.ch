using Batzio.Core;
using Batzio.Core.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using static Batzio.App.Localization;

namespace Batzio.App.Views;

/// <summary>Imports camt.053/054 or CSV bank statements.</summary>
public sealed class BankImportView : UserControl
{
    public BankImportView()
    {
        var state = AppState.Current;
        var autoBook = new ToggleSwitch { Header = L("Book exact QR-reference matches automatically"), IsOn = true };
        var result = Ui.Stack(8);
        var choose = Ui.Button(L("Choose statement…"), async () =>
        {
            var files = await Files.PickAsync(false, ".xml", ".csv", ".txt");
            if (files.Count == 0) return;
            var f = files[0];
            var r = await state.Api.SendRawAsync<BankImportResult>("/banking/import", f.Bytes, f.Name.EndsWith(".xml", StringComparison.OrdinalIgnoreCase) ? "application/xml" : "text/csv",
                new Dictionary<string, string?> { ["auto_book"] = autoBook.IsOn ? "true" : "false" });
            result.Children.Clear();
            result.Children.Add(Ui.Title(L("Imported {n} transactions", ("n", r.Imported))));
            result.Children.Add(Ui.Muted(L("{d} duplicates skipped · {s} matches suggested · {b} booked", ("d", r.Duplicates), ("s", r.Suggested), ("b", r.Booked))));
            result.Children.Add(Ui.Button(L("Review transactions"), () => state.Go(new AppTarget("resource", Resource: "bank_transactions"))));
        }, prominent: true, icon: "Upload");
        Content = Ui.Page(Ui.Stack(16,
            Ui.Card(Ui.Stack(12,
                Ui.H1(L("Bank statements"), 24),
                Ui.Muted(L("Import camt.053/054 files from your e-banking or a simple CSV. Batzio skips duplicates and matches payments to open invoices."), 14),
                autoBook, choose,
                Ui.Muted(L("Tip: you can also just drop the file anywhere in Batzio.")))),
            result), 760);
    }
}

/// <summary>Creates the month's payslips for every active employee.</summary>
public sealed class PayrollView : UserControl
{
    public PayrollView()
    {
        var state = AppState.Current;
        var month = new ComboBox { Header = L("Month"), ItemsSource = Enumerable.Range(1, 12).Select(m => Core.Localization.Loc.Culture.DateTimeFormat.GetMonthName(m)).ToList(), SelectedIndex = DateTime.Today.Month - 1, MinWidth = 180 };
        var year = new NumberBox { Header = L("Year {year}", ("year", "")).Trim(), Value = DateTime.Today.Year, SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Inline };
        var done = Ui.Stack(8);
        var run = Ui.Button(L("Run payroll"), async () =>
        {
            var r = await state.Api.SendAsync<PayrollResult>("POST", "/payroll/run", Json.Obj(("year", (int)year.Value), ("month", month.SelectedIndex + 1)));
            done.Children.Clear();
            done.Children.Add(Ui.Strong(L("{n} payslips ready for review.", ("n", r.Created)), 15));
            done.Children.Add(Ui.Button(L("Open payslips"), () => state.Go(new AppTarget("resource", Resource: "payslips"))));
            state.Touch();
        }, prominent: true);
        Content = Ui.Page(Ui.Card(Ui.Stack(14,
            Ui.H1(L("Payroll run"), 24),
            Ui.Muted(L("Creates draft payslips with AHV/IV/EO, ALV, BVG, accident and daily-allowance insurance for everyone employed that month. Check them, then finalise."), 14),
            Ui.Row(12, month, year), run, done)), 760);
    }
}
