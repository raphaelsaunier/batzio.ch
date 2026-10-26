import BatzioKit
import SwiftUI

/// Creates or edits any record from its definition. Documents get positions
/// and live totals computed by the server (same maths as the PDF).
struct RecordFormView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let resource: String
    let id: Int?
    var prefill: Record?

    @State private var values: Record = [:]
    @State private var labels: Labels = [:]
    @State private var taxes: [TaxOption] = []
    @State private var totals: DocumentTotals?
    @State private var errors: [String: String] = [:]
    @State private var message: String?
    @State private var loaded = false
    @State private var saving = false

    private var res: ResourceSchema? { app.bootstrap?.resource(resource) }

    var body: some View {
        Group {
            if let res, loaded {
                form(res)
            } else if res == nil {
                EmptyState(title: L("This module is not available to your role."))
            } else {
                ProgressView()
            }
        }
        .bzPage()
        .navigationTitle(id == nil ? L("New {label}", ["label": res?.label ?? ""]) : L("Edit {label}", ["label": res?.label ?? ""]))
        .inlineTitle()
        .task { await load() }
    }

    @ViewBuilder private func form(_ res: ResourceSchema) -> some View {
        let editable = res.fields.filter { $0.isEditable && !(id != nil && ($0.createOnly ?? false)) && $0.name != "id" }
        Form {
            if let message {
                Section { Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(Color.bzDestructive) }
            }
            ForEach(Array(res.sections(editable).enumerated()), id: \.offset) { _, section in
                Section(section.title ?? "") {
                    ForEach(section.fields) { field in
                        FieldEditor(field: field, value: binding(field.name), labels: labels[field.name] ?? [:], error: errors[field.name])
                    }
                }
            }
            ForEach(res.children) { child in
                ChildrenEditor(
                    child: child,
                    rows: Binding(get: { values[child.name]?.array?.compactMap(\.object) ?? [] }, set: { values[child.name] = .array($0.map { .object($0) }) }),
                    labels: labels,
                    totals: res.isDocument && child.name == "positions" ? totals : nil,
                    purchase: ["purchase_orders", "bills"].contains(res.name)
                )
            }
            if let totals, res.isDocument {
                Section(L("Totals")) {
                    LabeledContent(L("Net"), value: Fmt.amount(totals.total_net))
                    ForEach(totals.vat, id: \.rate) { v in
                        LabeledContent(L("VAT {rate}%", ["rate": Fmt.number(v.rate)]), value: Fmt.amount(v.vat))
                    }
                    if totals.rounding != 0 { LabeledContent(L("Rounding"), value: Fmt.amount(totals.rounding)) }
                    LabeledContent { Text(Fmt.money(totals.total, currency: values["currency_code"]?.string ?? "CHF")).font(.bzNumber(17, weight: .bold)) } label: { Text(L("Total")).bold() }
                }
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Task { await save(res, fields: editable) }
                } label: {
                    if saving { ProgressView().controlSize(.small) } else { Text(L("Save")) }
                }
                .disabled(saving)
                .keyboardShortcut("s", modifiers: .command)
            }
        }
        .task(id: totalsKey) { await refreshTotals(res) }
    }

    private func binding(_ name: String) -> Binding<JSONValue?> {
        Binding(get: { values[name] }, set: { values[name] = $0 })
    }

    private var totalsKey: String {
        let data = (try? JSONEncoder().encode([values["positions"] ?? .null, values["vat_mode"] ?? .null, values["currency_code"] ?? .null])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    private func load() async {
        guard !loaded else { return }
        do {
            if let id {
                let screen: RecordScreen = try await app.api.get("/app/records/\(resource)/\(id)")
                values = screen.record
                labels = screen.labels
                taxes = screen.taxes
            } else {
                var query: [String: String?] = [:]
                if let contact = prefill?["contact_id"]?.string { query["contact_id"] = contact }
                let fresh: NewRecord = try await app.api.get("/app/records/\(resource)/new", query: query)
                values = fresh.values.merging(prefill ?? [:]) { $1 }
                taxes = fresh.taxes
            }
            loaded = true
        } catch {
            message = error.localizedDescription
            loaded = true
        }
    }

    private func refreshTotals(_ res: ResourceSchema) async {
        guard res.isDocument, loaded else { return }
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        let body: [String: JSONValue] = [
            "positions": values["positions"] ?? .array([]),
            "vat_mode": values["vat_mode"] ?? "excl",
            "currency_code": values["currency_code"] ?? "CHF",
        ]
        totals = try? await app.api.send("POST", "/app/documents/totals", body: body)
    }

    private func save(_ res: ResourceSchema, fields: [FieldDef]) async {
        saving = true
        defer { saving = false }
        var payload: Record = [:]
        for f in fields { if let v = values[f.name] { payload[f.name] = v } }
        for child in res.children { if let rows = values[child.name] { payload[child.name] = rows } }
        do {
            let saved: Record
            if let id {
                saved = try await app.api.send("PATCH", "/\(res.name)/\(id)", body: payload)
            } else {
                saved = try await app.api.send("POST", "/\(res.name)", body: payload)
            }
            app.toast(L("Saved."))
            app.changed()
            dismiss()
            if id == nil, let newId = saved.id {
                try? await Task.sleep(for: .milliseconds(350))
                app.push(.record(res.name, newId))
            }
        } catch let error as APIError {
            errors = error.fields ?? [:]
            message = error.message
        } catch {
            message = error.localizedDescription
        }
    }
}

/// Positions and other child rows: add, edit, reorder, remove.
struct ChildrenEditor: View {
    @Environment(AppModel.self) private var app
    let child: ChildDef
    @Binding var rows: [Record]
    let labels: Labels
    var totals: DocumentTotals?
    var purchase = false
    @State private var editing: EditingRow?

    struct EditingRow: Identifiable { let index: Int; var id: Int { index } }

    private var typeField: FieldDef? { child.fields.first { $0.name == "type" && $0.type == .enum } }
    private var editable: [FieldDef] { child.fields.filter { $0.isEditable && $0.name != "id" && $0.name != "sort" } }

    var body: some View {
        Section {
            ForEach(rows.indices, id: \.self) { i in
                Button { editing = EditingRow(index: i) } label: { summary(i) }.buttonStyle(.plain)
            }
            .onDelete { rows.remove(atOffsets: $0) }
            .onMove { rows.move(fromOffsets: $0, toOffset: $1) }
            if let typeField, let options = typeField.options {
                Menu {
                    ForEach(options) { o in Button(o.label) { add(type: o.value) } }
                } label: { Label(L("Add {label}", ["label": child.label]), systemImage: "plus") }
            } else {
                Button { add(type: nil) } label: { Label(L("Add {label}", ["label": child.label]), systemImage: "plus") }
            }
        } header: {
            Text(child.label)
        }
        .sheet(item: $editing) { e in
            if rows.indices.contains(e.index) {
                ChildRowEditor(child: child, fields: editable, row: $rows[e.index], labels: labels, purchase: purchase)
            }
        }
    }

    private func add(type: String?) {
        var row: Record = [:]
        for f in editable { if let d = f.default { row[f.name] = d } }
        if let type { row["type"] = .string(type) }
        if row["quantity"] == nil, child.fields.contains(where: { $0.name == "quantity" }) { row["quantity"] = 1 }
        rows.append(row)
        editing = EditingRow(index: rows.count - 1)
    }

    @ViewBuilder private func summary(_ i: Int) -> some View {
        let row = rows[i]
        let textField = child.fields.first { ["text", "description", "name"].contains($0.name) }
        let main = textField.flatMap { row[$0.name]?.string } ?? row["type"]?.string ?? "#\(i + 1)"
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(main.components(separatedBy: "\n").first ?? main).lineLimit(1)
                if let q = row["quantity"]?.double, let p = row["unit_price"]?.double {
                    Text("\(Fmt.number(q)) × \(Fmt.amount(p))").font(.bzBody(12)).foregroundStyle(.secondary)
                } else if let amount = row["amount"]?.double {
                    Text(Fmt.amount(amount)).font(.bzBody(12)).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let line = totals?.lines[safe: i] {
                Text(Fmt.amount(line.subtotal ?? line.total)).font(.bzNumber(14))
            }
        }
        .contentShape(Rectangle())
    }
}

private struct ChildRowEditor: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let child: ChildDef
    let fields: [FieldDef]
    @Binding var row: Record
    let labels: Labels
    let purchase: Bool

    var body: some View {
        NavigationStack {
            Form {
                ForEach(fields) { field in
                    FieldEditor(field: field, value: Binding(get: { row[field.name] }, set: { new in
                        let old = row[field.name]
                        row[field.name] = new
                        if field.name == "item_id", new != old, let id = new?.int { Task { await fillFromItem(id) } }
                    }), labels: labels["\(child.name).\(field.name)"] ?? [:])
                }
            }
            .formStyle(.grouped)
            .navigationTitle(child.label)
            .inlineTitle()
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
        }
        .sheetFrame()
    }

    private func fillFromItem(_ id: Int) async {
        guard let d = try? await app.api.get("/app/items/\(id)/defaults", query: ["purchase": purchase ? "1" : nil]) as ItemDefaults else { return }
        row["text"] = .string(d.text)
        if let unit = d.unit_name { row["unit_name"] = .string(unit) }
        row["unit_price"] = .number(d.unit_price)
        if let tax = d.tax_id { row["tax_id"] = .number(Double(tax)) }
        if row["type"] == nil || row["type"]?.string == "custom" { row["type"] = "item" }
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
