import BatzioKit
import SwiftUI

/// Any module's list: search, status filter, sorting, paging, totals, export.
struct ResourceListView: View {
    @Environment(AppModel.self) private var app
    let initial: String
    var tabs: [NavTab] = []
    var title: String?
    @State private var current: String
    @State private var query = ""
    @State private var status: String?
    @State private var sort: String?
    @State private var descending = true
    @State private var archived = false
    @State private var rows: [Record] = []
    @State private var labels: Labels = [:]
    @State private var titles: [String: String] = [:]
    @State private var total = 0
    @State private var totals: [String: Double] = [:]
    @State private var loading = false
    @State private var error: String?

    init(resource: String, tabs: [NavTab] = [], title: String? = nil) {
        self.initial = resource
        self.tabs = tabs
        self.title = title
        _current = State(initialValue: resource)
    }

    private var res: ResourceSchema? { app.bootstrap?.resource(current) }
    private var resourceTabs: [(String, String)] {
        tabs.compactMap { tab in
            if case .resource(let name, nil, false) = tab.target { return (name, tab.title) }
            return nil
        }
    }

    var body: some View {
        Group {
            if let res {
                list(res)
            } else {
                EmptyState(title: L("This module is not available to your role."))
            }
        }
        .bzPage()
        .navigationTitle(res?.labelPlural ?? title ?? "")
        .inlineTitle()
        .searchable(text: $query, prompt: L("Search"))
        .task(id: "\(current)|\(query)|\(status ?? "")|\(sort ?? "")|\(descending)|\(archived)|\(app.revision)") {
            if !query.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
            await load(reset: true)
        }
    }

    @ViewBuilder private func list(_ res: ResourceSchema) -> some View {
        List {
            if resourceTabs.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(resourceTabs, id: \.0) { tab in
                            Button(tab.1) { current = tab.0 }
                                .buttonStyle(NeuButtonStyle(prominent: current == tab.0, compact: true))
                        }
                    }
                    .padding(.vertical, 6)
                    .padding(.horizontal, 4)
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
            if !totals.isEmpty, let money = res.listFields.first(where: { $0.type == .money }), let sum = totals[money.name] {
                HStack {
                    Text(L("{n} records", ["n": total])).foregroundStyle(.secondary)
                    Spacer()
                    Text("\(money.label): \(Fmt.money(sum))").font(.bzNumber(14, weight: .semibold))
                }
                .font(.bzBody(13))
                .listRowBackground(Color.clear)
            }
            ForEach(rows.indices, id: \.self) { i in
                let row = rows[i]
                NavigationLink(value: Route.record(res.name, row.id ?? 0)) {
                    RecordRow(res: res, row: row, title: titles[String(row.id ?? 0)], labels: labels)
                }
                .onAppear { if i == rows.count - 1, rows.count < total { Task { await load(reset: false) } } }
            }
            if loading { HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear) }
            if !loading && rows.isEmpty {
                Group {
                    if let error { ErrorState(message: error) { await load(reset: true) } } else if let empty = res.empty, query.isEmpty, status == nil {
                        EmptyState(title: empty.title, text: empty.text)
                    } else {
                        EmptyState(title: L("Nothing found"))
                    }
                }
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .refreshable { await load(reset: true) }
        .toolbar {
            ToolbarItemGroup(placement: .bzTrailing) {
                Menu {
                    if let statusField = res.statusDef, let options = statusField.options {
                        Picker(statusField.label, selection: $status) {
                            Text(L("All")).tag(String?.none)
                            ForEach(options) { Text($0.label).tag(String?.some($0.value)) }
                        }
                    }
                    Picker(L("Sort by"), selection: $sort) {
                        Text(L("Default")).tag(String?.none)
                        ForEach(res.fields.filter { $0.sortable ?? false }) { Text($0.label).tag(String?.some($0.name)) }
                    }
                    Toggle(L("Descending"), isOn: $descending)
                    if res.softDelete { Toggle(L("Show archived"), isOn: $archived) }
                    Divider()
                    DownloadButton(path: "/\(res.name)", query: exportQuery(res)) { Label(L("Export to Excel"), systemImage: "tablecells") }
                } label: {
                    Label(L("Filter"), systemImage: status == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }
                if res.canCreate {
                    Button { app.push(.create(res.name, prefill: nil)) } label: { Label(res.label, systemImage: "plus") }
                        .keyboardShortcut("n", modifiers: .command)
                }
            }
        }
    }

    private func params(_ res: ResourceSchema) -> [String: String?] {
        var q: [String: String?] = ["q": query.isEmpty ? nil : query, "limit": "40"]
        if let status, let field = res.statusField { q[field] = status }
        if let sort { q["sort"] = sort; q["dir"] = descending ? "desc" : "asc" }
        if archived { q["archived"] = "include" }
        return q
    }

    private func exportQuery(_ res: ResourceSchema) -> [String: String?] {
        var q = params(res)
        q["format"] = "xlsx"
        q["limit"] = nil
        return q
    }

    private func load(reset: Bool) async {
        guard let res else { return }
        loading = true
        defer { loading = false }
        var q = params(res)
        q["offset"] = reset ? "0" : String(rows.count)
        do {
            let page: RecordList = try await app.api.get("/app/records/\(res.name)", query: q)
            if reset { rows = page.rows; labels = page.labels; titles = page.titles } else {
                rows += page.rows
                labels.merge(page.labels) { a, b in a.merging(b) { $1 } }
                titles.merge(page.titles) { $1 }
            }
            total = page.total
            totals = page.totals
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct RecordRow: View {
    let res: ResourceSchema
    let row: Record
    let title: String?
    let labels: Labels

    var body: some View {
        let fields = res.listFields
        let money = fields.first { $0.type == .money }
        let details = fields.filter { $0.name != money?.name && $0.name != res.statusField && $0.type != .boolean }.prefix(3)
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title ?? "#\(row.id ?? 0)").font(.bzBody(15, weight: .semibold)).lineLimit(1)
                let text = details.map { FieldText.text($0, row[$0.name], labels: labels) }.filter { !$0.isEmpty && $0 != title }.joined(separator: " · ")
                if !text.isEmpty { Text(text).font(.bzBody(13)).foregroundStyle(.secondary).lineLimit(1) }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                if let money { Text(FieldText.text(money, row[money.name])).font(.bzNumber(15, weight: .semibold)) }
                StatusBadge(field: res.statusDef, value: row[res.statusField ?? ""])
            }
        }
        .padding(.vertical, 4)
    }
}
