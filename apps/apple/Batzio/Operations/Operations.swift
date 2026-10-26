import BatzioKit
import SwiftUI
import UniformTypeIdentifiers

/// Imports camt.053/054 or CSV bank statements.
struct BankImportView: View {
    @Environment(AppModel.self) private var app
    @State private var importing = false
    @State private var autoBook = true
    @State private var result: BankImportResult?
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(L("Bank statements")).font(.bzDisplay(24))
                    Text(L("Import camt.053/054 files from your e-banking or a simple CSV. Batzio skips duplicates and matches payments to open invoices.")).foregroundStyle(.secondary)
                    Toggle(L("Book exact QR-reference matches automatically"), isOn: $autoBook)
                    Button { importing = true } label: {
                        HStack { if busy { ProgressView().controlSize(.small) }; Label(L("Choose statement…"), systemImage: "doc.badge.arrow.up") }
                    }
                    .buttonStyle(.metal)
                    .disabled(busy)
                    Text(L("Tip: you can also just drop the file anywhere in Batzio.")).font(.bzBody(13)).foregroundStyle(.secondary)
                }
                .neuCard()
                if let result {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(L("Imported {n} transactions", ["n": result.imported])).font(.bzDisplay(20))
                        Text(L("{d} duplicates skipped · {s} matches suggested · {b} booked", ["d": result.duplicates, "s": result.suggested, "b": result.booked])).foregroundStyle(.secondary)
                        Button(L("Review transactions")) { app.go(.resource("bank_transactions", id: nil, create: false)) }.buttonStyle(.neu)
                    }
                    .neuCard()
                }
            }
            .padding(24)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .bzPage()
        .navigationTitle(L("Import & export"))
        .fileImporter(isPresented: $importing, allowedContentTypes: [.xml, .commaSeparatedText, .plainText, .data]) { r in
            guard case .success(let url) = r, let file = ItemLoader.uploads(from: [url]).first else { return }
            Task {
                busy = true
                defer { busy = false }
                do {
                    let type = file.name.lowercased().hasSuffix(".xml") ? "application/xml" : "text/csv"
                    result = try await app.api.sendRaw("/banking/import", body: file.data, contentType: type, query: ["auto_book": autoBook ? "true" : "false"])
                    app.changed()
                } catch { app.report(error) }
            }
        }
    }
}

/// Creates the month's payslips for every active employee.
struct PayrollRunView: View {
    @Environment(AppModel.self) private var app
    @State private var year = Calendar.current.component(.year, from: .now)
    @State private var month = Calendar.current.component(.month, from: .now)
    @State private var busy = false
    @State private var done: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(L("Payroll run")).font(.bzDisplay(24))
                Text(L("Creates draft payslips with AHV/IV/EO, ALV, BVG, accident and daily-allowance insurance for everyone employed that month. Check them, then finalise.")).foregroundStyle(.secondary)
                HStack {
                    Picker(L("Month"), selection: $month) {
                        ForEach(1...12, id: \.self) { m in Text(Calendar.current.monthSymbols[m - 1]).tag(m) }
                    }
                    .fixedSize()
                    Stepper(String(year), value: $year, in: 2000...2100).fixedSize()
                }
                Button {
                    Task {
                        busy = true
                        defer { busy = false }
                        do {
                            let result: JSONValue = try await app.api.send("POST", "/payroll/run", body: ["year": .number(Double(year)), "month": .number(Double(month))] as [String: JSONValue])
                            let created = result["created"]?.int ?? result.array?.count ?? 0
                            done = L("{n} payslips ready for review.", ["n": created])
                            app.changed()
                        } catch { app.report(error) }
                    }
                } label: {
                    HStack { if busy { ProgressView().controlSize(.small) }; Text(L("Run payroll")) }
                }
                .buttonStyle(.metal)
                .disabled(busy)
                if let done {
                    Text(done).font(.bzBody(15, weight: .semibold))
                    Button(L("Open payslips")) { app.go(.resource("payslips", id: nil, create: false)) }.buttonStyle(.neu)
                }
            }
            .neuCard()
            .padding(24)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .bzPage()
        .navigationTitle(L("Payroll run"))
    }
}
