import BatzioKit
import SwiftUI

struct RecordDetailView: View {
    @Environment(AppModel.self) private var app
    let resource: String
    let id: Int

    var body: some View {
        Loader(id: "\(resource)/\(id)") { api in
            try await api.get("/app/records/\(resource)/\(id)", query: ["mode": api.mode]) as RecordScreen
        } content: { screen, refresh in
            if let res = app.bootstrap?.resource(resource) {
                RecordDetailContent(res: res, id: id, screen: screen, refresh: refresh)
            } else {
                EmptyState(title: L("This module is not available to your role."))
            }
        }
        .bzPage()
    }
}

private struct RecordDetailContent: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let res: ResourceSchema
    let id: Int
    let screen: RecordScreen
    let refresh: () async -> Void
    @State private var attaching = false
    @State private var confirmDelete = false

    private var record: Record { screen.record }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                actions
                ForEach(Array(res.sections(visibleFields).enumerated()), id: \.offset) { _, section in
                    VStack(alignment: .leading, spacing: 10) {
                        if let title = section.title { SectionTitle(text: title) }
                        ForEach(section.fields) { field in
                            if field.type == .text {
                                VStack(alignment: .leading, spacing: 4) {
                                    TermLabel(text: field.label, term: field.term).font(.bzBody(13)).foregroundStyle(.secondary)
                                    Text(FieldText.text(field, record[field.name], labels: screen.labels)).textSelection(.enabled)
                                }
                            } else {
                                LabeledContent {
                                    if field.name == res.statusField {
                                        StatusBadge(field: field, value: record[field.name])
                                    } else if field.type == .ref, let target = field.ref, let refId = record[field.name]?.int {
                                        Button(FieldText.text(field, record[field.name], labels: screen.labels)) { app.push(.record(target, refId)) }
                                            .buttonStyle(.plain)
                                            .foregroundStyle(Color.bzPrimary)
                                    } else {
                                        Text(FieldText.text(field, record[field.name], labels: screen.labels))
                                            .font(field.type == .money ? .bzNumber() : .bzBody())
                                            .textSelection(.enabled)
                                            .multilineTextAlignment(.trailing)
                                    }
                                } label: {
                                    TermLabel(text: field.label, term: field.term).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    .neuCard()
                }
                ForEach(res.children) { child in
                    if let rows = record[child.name]?.array, !rows.isEmpty {
                        ChildTable(child: child, rows: rows.compactMap(\.object), labels: screen.labels)
                    }
                }
                ForEach(screen.related) { related in
                    if related.total > 0 {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionTitle(text: "\(related.label) (\(related.total))")
                            ForEach(related.rows) { row in
                                Button { app.push(.record(related.resource, row.id)) } label: {
                                    HStack {
                                        Text(row.title)
                                        Spacer()
                                        if let rel = app.bootstrap?.resource(related.resource) {
                                            StatusBadge(field: rel.statusDef, value: row.status)
                                        }
                                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .neuCard()
                    }
                }
                attachments
                if !screen.history.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionTitle(text: L("History"))
                        ForEach(screen.history) { h in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(h.summary ?? h.action).font(.bzBody(14))
                                Text("\(h.actor_name ?? "") · \(Fmt.dateTime(h.at))").font(.bzBody(12)).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .neuCard()
                }
            }
            .padding(24)
            .frame(maxWidth: 900)
            .frame(maxWidth: .infinity)
        }
        .refreshable { await refresh() }
        .navigationTitle(screen.title)
        .inlineTitle()
        .toolbar {
            ToolbarItemGroup(placement: .bzTrailing) {
                if screen.canEdit && !res.readOnly {
                    Button { app.push(.edit(res.name, id)) } label: { Label(L("Edit"), systemImage: "pencil") }
                        .keyboardShortcut("e", modifiers: .command)
                }
                Menu {
                    Button(L("Ask Batzi about this"), systemImage: "sparkles") {
                        app.showBatzi = true
                        Task { await app.batzi.send(L("About {label} {title}: ", ["label": res.label, "title": screen.title])) }
                    }
                    if screen.archived {
                        Button(L("Restore"), systemImage: "arrow.uturn.backward") { Task { await restore() } }
                    } else if screen.canDelete {
                        Button(res.softDelete ? L("Archive") : L("Delete"), systemImage: res.softDelete ? "archivebox" : "trash", role: .destructive) { confirmDelete = true }
                    }
                } label: { Label(L("More"), systemImage: "ellipsis.circle") }
            }
        }
        .confirmationDialog(res.softDelete ? L("Archive this record?") : L("Delete this record?"), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(res.softDelete ? L("Archive") : L("Delete"), role: .destructive) { Task { await delete() } }
        }
        .fileImporter(isPresented: $attaching, allowedContentTypes: dropTypes, allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            let files = ItemLoader.uploads(from: urls)
            Task {
                for f in files {
                    do {
                        let _: JSONValue = try await app.api.upload("/files/upload", files: [f.upload], fileField: "file", fields: ["ref_type": res.name, "ref_id": String(id)])
                    } catch { app.report(error) }
                }
                await refresh()
            }
        }
    }

    private var visibleFields: [FieldDef] {
        res.fields.filter { f in
            !(f.hidden ?? false) && f.type != .json && f.name != "id" && !FieldText.isEmpty(record[f.name])
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(screen.title).font(.bzDisplay(28)).lineLimit(1).minimumScaleFactor(0.6)
            HStack(spacing: 8) {
                Text(res.label).font(.bzBody(14)).foregroundStyle(.secondary)
                StatusBadge(field: res.statusDef, value: record[res.statusField ?? ""])
                if screen.archived { ToneBadge(L("Archived"), tone: .muted) }
            }
            let figures = res.fields.filter { $0.type == .money && ($0.list ?? false) && !FieldText.isEmpty(record[$0.name]) }.prefix(3)
            if !figures.isEmpty {
                HStack(spacing: 24) {
                    ForEach(Array(figures)) { f in
                        VStack(alignment: .leading, spacing: 2) {
                            TermLabel(text: f.label, term: f.term).font(.bzBody(12)).foregroundStyle(.secondary)
                            Text(Fmt.amount(record[f.name]?.double)).font(.bzDisplay(24)).monospacedDigit()
                        }
                    }
                }
            }
            if let locked = screen.locked {
                Label(locked, systemImage: "lock").font(.bzBody(13)).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .neuCard()
    }

    private var actions: some View {
        FlowLayout(spacing: 10) {
            if let pdf = screen.pdf {
                DownloadButton(path: pdf) { Label("PDF", systemImage: "doc.richtext") }.buttonStyle(.neu)
            }
            ForEach(screen.actions, id: \.self) { name in
                if let action = res.action(name) {
                    ActionButton(res: res, id: id, action: action, primary: name == screen.actions.first) { await refresh() }
                }
            }
        }
    }

    private var attachments: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                SectionTitle(text: L("Attachments"))
                Button { attaching = true } label: { Image(systemName: "plus") }.buttonStyle(.neuCompact)
            }
            ForEach(screen.files) { f in
                Button { app.push(.file(f.id, f.name)) } label: {
                    HStack {
                        Image(systemName: "paperclip")
                        Text(f.name).lineLimit(1)
                        Spacer()
                        Text(Fmt.bytes(f.size)).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
            }
            if screen.files.isEmpty {
                Text(L("Drop receipts or documents here to keep them with this record.")).font(.bzBody(13)).foregroundStyle(.secondary)
            }
        }
        .neuCard()
    }

    private func delete() async {
        do {
            let _: JSONValue = try await app.api.send("DELETE", "/\(res.name)/\(id)")
            app.toast(res.softDelete ? L("Archived") : L("Deleted"))
            app.changed()
            dismiss()
        } catch { app.report(error) }
    }

    private func restore() async {
        do {
            let _: JSONValue = try await app.api.send("POST", "/\(res.name)/\(id)/restore")
            await refresh()
            app.changed()
        } catch { app.report(error) }
    }
}

/// Positions, lines and other child rows as a compact table.
private struct ChildTable: View {
    let child: ChildDef
    let rows: [Record]
    let labels: Labels

    var body: some View {
        let columns = child.fields.filter { !($0.hidden ?? false) && $0.type != .json && $0.name != "id" && $0.name != "sort" }
        let shown = columns.filter { f in rows.contains { !FieldText.isEmpty($0[f.name]) } }.prefix(6)
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(text: child.label)
            ScrollView(.horizontal, showsIndicators: false) {
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                    GridRow {
                        ForEach(Array(shown)) { f in
                            Text(f.label).font(.bzBody(12, weight: .semibold)).foregroundStyle(.secondary)
                                .gridColumnAlignment(isNumeric(f) ? .trailing : .leading)
                        }
                    }
                    Divider()
                    ForEach(rows.indices, id: \.self) { i in
                        GridRow {
                            ForEach(Array(shown)) { f in
                                Text(FieldText.text(f, rows[i][f.name], labels: childLabels(f)))
                                    .font(isNumeric(f) ? .bzNumber(14) : .bzBody(14))
                                    .lineLimit(3)
                                    .frame(maxWidth: f.type == .text || f.type == .string ? 280 : nil, alignment: .leading)
                            }
                        }
                    }
                }
            }
        }
        .neuCard()
    }

    private func isNumeric(_ f: FieldDef) -> Bool { [.money, .decimal, .percent, .int].contains(f.type) }
    private func childLabels(_ f: FieldDef) -> Labels { labels["\(child.name).\(f.name)"].map { [f.name: $0] } ?? [:] }
}

/// A workflow step on a record (issue, record payment, book…), with confirmation or inputs.
struct ActionButton: View {
    @Environment(AppModel.self) private var app
    let res: ResourceSchema
    let id: Int
    let action: ActionDef
    var primary = false
    let done: () async -> Void
    @State private var confirming = false
    @State private var inputting = false
    @State private var busy = false

    var body: some View {
        Button {
            if !(action.input ?? []).isEmpty { inputting = true } else if action.confirm != nil { confirming = true } else { Task { await run([:]) } }
        } label: {
            HStack(spacing: 6) {
                if busy { ProgressView().controlSize(.small) } else if let icon = action.icon { BZImage(name: icon) }
                Text(action.label)
            }
        }
        .buttonStyle(NeuButtonStyle(prominent: primary && !action.isDestructive))
        .disabled(busy)
        .help(action.description)
        .confirmationDialog(action.confirm ?? action.label, isPresented: $confirming, titleVisibility: .visible) {
            Button(action.label, role: action.isDestructive ? .destructive : nil) { Task { await run([:]) } }
        } message: {
            Text(action.description)
        }
        .sheet(isPresented: $inputting) {
            ActionInputSheet(action: action) { values in Task { await run(values) } }
        }
    }

    private func run(_ input: Record) async {
        busy = true
        defer { busy = false }
        do {
            let r: ActionResponse = try await app.api.send("POST", "/\(res.name)/\(id)/\(action.name)", body: input)
            if let m = r.message { app.toast(m) }
            app.changed()
            if let redirect = r.redirect { app.push(.record(redirect.resource, redirect.id)) } else { await done() }
        } catch {
            app.report(error)
        }
    }
}

private struct ActionInputSheet: View {
    @Environment(\.dismiss) private var dismiss
    let action: ActionDef
    let submit: (Record) -> Void
    @State private var values: Record = [:]

    var body: some View {
        NavigationStack {
            Form {
                Section { Text(action.description).foregroundStyle(.secondary) }
                Section {
                    ForEach(action.input ?? []) { field in
                        FieldEditor(field: field, value: Binding(get: { values[field.name] }, set: { values[field.name] = $0 }))
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(action.label)
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action.label) {
                        submit(values)
                        dismiss()
                    }
                }
            }
            .onAppear {
                for f in action.input ?? [] where values[f.name] == nil {
                    if let d = f.default { values[f.name] = d } else if f.type == .date { values[f.name] = .string(Fmt.isoString(Date())) }
                }
            }
        }
        .sheetFrame()
    }
}
