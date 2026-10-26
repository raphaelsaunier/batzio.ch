import BatzioKit
import SwiftUI

struct ReportsView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 18)], spacing: 18) {
                ForEach(app.bootstrap?.reports ?? []) { report in
                    NavigationLink(value: Route.report(report.id)) {
                        VStack(alignment: .leading, spacing: 10) {
                            BZImage(name: report.icon).font(.title2).foregroundStyle(Color.bzPrimary)
                            TermLabel(text: report.title, term: report.id == "vat" ? "vat" : nil).font(.bzDisplay(19))
                            Text(report.text).font(.bzBody(14)).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
                        .neuCard()
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(24)
        }
        .bzPage()
        .navigationTitle(L("Insights"))
    }
}

struct ReportView: View {
    @Environment(AppModel.self) private var app
    let id: String
    @State private var date = Date()
    @State private var from = Calendar.current.date(from: DateComponents(year: Calendar.current.component(.year, from: .now), month: 1, day: 1)) ?? .now
    @State private var to = Calendar.current.date(from: DateComponents(year: Calendar.current.component(.year, from: .now), month: 12, day: 31)) ?? .now
    @State private var year = Calendar.current.component(.year, from: .now)
    @State private var accountId: Int?
    @State private var accountLabel: String?
    @State private var pickingAccount = false

    private var info: ReportInfo? { app.bootstrap?.reports.first { $0.id == id } }

    private var query: [String: String?] {
        switch info?.params {
        case "date": ["date": Fmt.isoString(date)]
        case "period": ["from": Fmt.isoString(from), "to": Fmt.isoString(to)]
        case "ledger": ["from": Fmt.isoString(from), "to": Fmt.isoString(to), "account_id": accountId.map(String.init)]
        case "year": ["year": String(year)]
        default: [:]
        }
    }

    var body: some View {
        Loader(id: "report/\(id)/\(query.description)") { api in
            try await api.get("/app/reports/\(id)", query: query) as ReportScreen
        } content: { report, refresh in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    controls
                    Text(report.subtitle).font(.bzBody(14)).foregroundStyle(.secondary)
                    if let balanced = report.balanced, !balanced {
                        Label(L("Assets and liabilities do not balance yet."), systemImage: "exclamationmark.triangle").foregroundStyle(Color.bzWarning)
                    }
                    if !report.summary.isEmpty {
                        FlowLayout(spacing: 12) {
                            ForEach(report.summary, id: \.label) { s in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(s.label).font(.bzBody(12)).foregroundStyle(.secondary)
                                    Text(Fmt.amount(s.value)).font(.bzDisplay(22)).monospacedDigit().foregroundStyle(Tone(name: s.tone).foreground == Color.bzMutedForeground ? Color.primary : Tone(name: s.tone).foreground)
                                }
                                .padding(14)
                                .neuCard(cornerRadius: 16, padding: 0)
                            }
                        }
                    }
                    ForEach(Array(report.tables.enumerated()), id: \.offset) { _, table in
                        ReportTableView(table: table)
                    }
                }
                .padding(24)
            }
            .refreshable { await refresh() }
            .navigationTitle(report.title)
            .toolbar {
                ToolbarItemGroup(placement: .bzTrailing) {
                    if let pdf = report.pdf {
                        DownloadButton(path: pdf, query: query.merging(["format": "pdf"]) { $1 }) { Label("PDF", systemImage: "doc.richtext") }
                    }
                    DownloadButton(path: "/app/reports/\(id)", query: query.merging(["format": "xlsx"]) { $1 }) { Label("Excel", systemImage: "tablecells") }
                }
            }
        }
        .bzPage()
        .sheet(isPresented: $pickingAccount) {
            RefPicker(resource: "accounts", allowsNone: false) { o in
                accountId = o?.id
                accountLabel = o?.label
            }
        }
    }

    @ViewBuilder private var controls: some View {
        switch info?.params {
        case "date":
            DatePicker(L("As of"), selection: $date, displayedComponents: .date).fixedSize()
        case "period", "ledger":
            FlowLayout(spacing: 12) {
                DatePicker(L("From"), selection: $from, displayedComponents: .date).fixedSize()
                DatePicker(L("To"), selection: $to, displayedComponents: .date).fixedSize()
                if info?.params == "ledger" {
                    Button(accountLabel ?? L("Choose account")) { pickingAccount = true }.buttonStyle(.neuCompact)
                }
            }
        case "year":
            Stepper(value: $year, in: 2000...2100) { Text(L("Year {year}", ["year": String(year)])) }.fixedSize()
        default:
            EmptyView()
        }
    }
}

struct ReportTableView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    let table: ReportTable

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title = table.title { Text(title).font(.bzDisplay(18)) }
            if sizeClass == .compact { compact } else { grid }
        }
        .neuCard()
    }

    /// Phones: label on the left, the figures stacked on the right.
    private var compact: some View {
        let numeric = table.columns.indices.filter { table.columns[$0].isNumeric }
        let texts = table.columns.indices.filter { !table.columns[$0].isNumeric }
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
                let bold = row.style == "total" || row.style == "section"
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        let parts = texts.map { text(row, $0) }.filter { !$0.isEmpty }
                        Text(parts.joined(separator: " · "))
                            .font(.bzBody(14, weight: bold ? .semibold : .regular))
                            .foregroundStyle(row.style == "muted" ? Color.secondary : (row.link != nil ? Color.bzPrimary : Color.primary))
                            .padding(.leading, CGFloat(row.indent ?? 0) * 10)
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 2) {
                        ForEach(numeric, id: \.self) { i in
                            let value = text(row, i)
                            if !value.isEmpty {
                                HStack(spacing: 6) {
                                    if numeric.count > 1 { Text(table.columns[i].label).font(.bzBody(11)).foregroundStyle(.secondary) }
                                    Text(value).font(.bzNumber(14, weight: bold ? .bold : .regular))
                                }
                            }
                        }
                    }
                }
                .padding(.vertical, 7)
                .contentShape(Rectangle())
                .onTapGesture { if let link = row.link { app.push(.record(link.resource, link.id)) } }
                if row.style == "total" { Divider() }
            }
        }
    }

    private func text(_ row: ReportRow, _ i: Int) -> String {
        let value = row.cells[safe: i] ?? .null
        return switch table.columns[i].type {
        case "money": value.double.map { Fmt.amount($0) } ?? ""
        case "number": value.double.map { Fmt.number($0) } ?? ""
        case "date": value.string.map { Fmt.date($0) } ?? ""
        default: value.displayText
        }
    }

    private var grid: some View {
            ScrollView(.horizontal, showsIndicators: false) {
                Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 7) {
                    GridRow {
                        ForEach(Array(table.columns.enumerated()), id: \.offset) { _, c in
                            TermLabel(text: c.label, term: c.term)
                                .font(.bzBody(12, weight: .semibold))
                                .foregroundStyle(.secondary)
                                .gridColumnAlignment(c.isNumeric ? .trailing : .leading)
                        }
                    }
                    Divider()
                    ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
                        GridRow {
                            ForEach(Array(table.columns.enumerated()), id: \.offset) { i, c in
                                cell(row, i, c)
                            }
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { if let link = row.link { app.push(.record(link.resource, link.id)) } }
                        if row.style == "total" { Divider() }
                    }
                }
            }
    }

    private func cell(_ row: ReportRow, _ i: Int, _ c: ReportColumn) -> some View {
        let value = row.cells[safe: i] ?? .null
        let text: String = switch c.type {
        case "money": value.double.map { Fmt.amount($0) } ?? ""
        case "number": value.double.map { Fmt.number($0) } ?? ""
        case "date": value.string.map { Fmt.date($0) } ?? ""
        default: value.displayText
        }
        let bold = row.style == "total" || row.style == "section"
        return Text(text)
            .font(c.isNumeric ? .bzNumber(14, weight: bold ? .bold : .regular) : .bzBody(14, weight: bold ? .semibold : .regular))
            .foregroundStyle(row.style == "muted" ? Color.secondary : (row.link != nil && i == 1 ? Color.bzPrimary : Color.primary))
            .padding(.leading, i == 1 ? CGFloat(row.indent ?? 0) * 14 : 0)
            .lineLimit(2)
            .frame(maxWidth: c.type == "text" ? 340 : nil, alignment: c.isNumeric ? .trailing : .leading)
    }
}
