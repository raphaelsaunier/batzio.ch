import BatzioKit
import SwiftUI

/// The right control for a field type, bound to a JSON value.
struct FieldEditor: View {
    let field: FieldDef
    @Binding var value: JSONValue?
    var labels: [String: String] = [:]
    var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            control
            if let description = field.description, field.type != .boolean {
                Text(description).font(.bzBody(12)).foregroundStyle(.secondary)
            }
            if let error { Text(error).font(.bzBody(12)).foregroundStyle(Color.bzDestructive) }
        }
    }

    private var title: some View {
        TermLabel(text: field.label + (field.required ?? false ? " *" : ""), term: field.term)
    }

    @ViewBuilder private var control: some View {
        switch field.type {
        case .boolean:
            Toggle(isOn: Binding(get: { value?.bool ?? false }, set: { value = .bool($0) })) { title }
        case .enum:
            Picker(selection: Binding(get: { value?.string ?? "" }, set: { value = $0.isEmpty ? .null : .string($0) })) {
                if !(field.required ?? false) { Text("—").tag("") }
                ForEach(field.options ?? []) { Text($0.label).tag($0.value) }
            } label: { title }
        case .date, .datetime:
            DateField(field: field, value: $value) { title }
        case .ref:
            RefField(field: field, value: $value, initialLabel: value?.string.flatMap { labels[$0] }) { title }
        case .tags:
            TagsField(field: field, value: $value, labels: labels) { title }
        case .text:
            VStack(alignment: .leading, spacing: 4) {
                title.font(.bzBody(13, weight: .medium))
                TextField(field.placeholder ?? "", text: stringBinding, axis: .vertical)
                    .lineLimit(3...10)
                    .textFieldStyle(.roundedBorder)
            }
        case .int, .decimal, .money, .percent:
            LabeledContent {
                NumberField(field: field, value: $value)
            } label: { title }
        case .json:
            EmptyView()
        default:
            LabeledContent {
                TextField(field.placeholder ?? "", text: stringBinding)
                    .multilineTextAlignment(.trailing)
                    .modifier(KeyboardFor(type: field.type))
            } label: { title }
        }
    }

    private var stringBinding: Binding<String> {
        Binding(get: { value?.displayText ?? "" }, set: { value = $0.isEmpty ? .null : .string($0) })
    }
}

private struct KeyboardFor: ViewModifier {
    let type: FieldType
    func body(content: Content) -> some View {
        switch type {
        case .email: content.emailKeyboard()
        case .url, .iban, .color: content.plainInput()
        default: content
        }
    }
}

/// Numbers keep what is typed until it parses.
private struct NumberField: View {
    let field: FieldDef
    @Binding var value: JSONValue?
    @State private var text = ""

    var body: some View {
        TextField("0", text: $text)
            .multilineTextAlignment(.trailing)
            .numericKeyboard()
            .font(.bzNumber())
            .frame(maxWidth: 180)
            .onAppear { text = format(value) }
            .onChange(of: value) { if parse(text) != value?.double { text = format(value) } }
            .onChange(of: text) {
                let t = text.trimmingCharacters(in: .whitespaces)
                if t.isEmpty { value = .null } else if let n = parse(t) { value = .number(n) }
            }
    }

    private func parse(_ s: String) -> Double? {
        Double(s.replacingOccurrences(of: "’", with: "").replacingOccurrences(of: "'", with: "").replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: " ", with: ""))
    }

    private func format(_ v: JSONValue?) -> String {
        guard let d = v?.double else { return "" }
        if field.type == .money { return String(format: "%.2f", d) }
        return d.rounded() == d ? String(Int64(d)) : String(d)
    }
}

private struct DateField<Title: View>: View {
    let field: FieldDef
    @Binding var value: JSONValue?
    @ViewBuilder let title: () -> Title

    var body: some View {
        let date = Fmt.parseDate(value?.string)
        if let date {
            HStack {
                DatePicker(selection: Binding(get: { date }, set: { value = .string(field.type == .datetime ? ISO8601DateFormatter().string(from: $0) : Fmt.isoString($0)) }), displayedComponents: field.type == .datetime ? [.date, .hourAndMinute] : [.date]) {
                    title()
                }
                if !(field.required ?? false) {
                    Button { value = .null } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }.buttonStyle(.plain)
                }
            }
        } else {
            LabeledContent {
                Button(L("Set date")) { value = .string(Fmt.isoString(Date())) }.buttonStyle(.neuCompact)
            } label: { title() }
        }
    }
}

/// Picks a referenced record (contact, account, VAT code…).
struct RefField<Title: View>: View {
    @Environment(AppModel.self) private var app
    let field: FieldDef
    @Binding var value: JSONValue?
    var initialLabel: String?
    @ViewBuilder let title: () -> Title
    @State private var picking = false
    @State private var label: String?

    var body: some View {
        LabeledContent {
            Button {
                picking = true
            } label: {
                HStack(spacing: 4) {
                    Text(label ?? initialLabel ?? (value?.isNull == false ? "#\(value!.displayText)" : L("Choose…")))
                        .foregroundStyle(value?.isNull == false && value != nil ? Color.primary : Color.secondary)
                        .lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
        } label: { title() }
        .sheet(isPresented: $picking) {
            RefPicker(resource: field.ref ?? "", filter: field.refFilter ?? [:], allowsNone: !(field.required ?? false)) { option in
                value = option.map { .number(Double($0.id)) } ?? .null
                label = option?.label
            }
        }
    }
}

private struct TagsField<Title: View>: View {
    let field: FieldDef
    @Binding var value: JSONValue?
    let labels: [String: String]
    @ViewBuilder let title: () -> Title
    @State private var picking = false
    @State private var known: [String: String] = [:]

    private var ids: [Int] { value?.array?.compactMap(\.int) ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            title().font(.bzBody(13, weight: .medium))
            FlowLayout(spacing: 6) {
                ForEach(ids, id: \.self) { id in
                    HStack(spacing: 4) {
                        Text(known[String(id)] ?? labels[String(id)] ?? "#\(id)")
                        Button { value = .array(ids.filter { $0 != id }.map { .number(Double($0)) }) } label: { Image(systemName: "xmark") }.buttonStyle(.plain)
                    }
                    .font(.bzBody(12))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Capsule().fill(Color.bzSecondary))
                }
                Button { picking = true } label: { Image(systemName: "plus") }.buttonStyle(.neuCompact)
            }
        }
        .sheet(isPresented: $picking) {
            RefPicker(resource: field.ref ?? "", filter: field.refFilter ?? [:], allowsNone: false) { option in
                guard let option, !ids.contains(option.id) else { return }
                known[String(option.id)] = option.label
                value = .array((ids + [option.id]).map { .number(Double($0)) })
            }
        }
    }
}

struct RefPicker: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let resource: String
    var filter: [String: JSONValue] = [:]
    var allowsNone = true
    let onPick: (RefOption?) -> Void
    @State private var query = ""
    @State private var options: [RefOption] = []
    @State private var loading = true

    var body: some View {
        NavigationStack {
            List {
                if allowsNone {
                    Button(L("None")) { onPick(nil); dismiss() }.foregroundStyle(.secondary)
                }
                ForEach(options) { o in
                    Button { onPick(o); dismiss() } label: { Text(o.label).frame(maxWidth: .infinity, alignment: .leading) }
                        .buttonStyle(.plain)
                }
                if !loading && options.isEmpty { Text(L("Nothing found")).foregroundStyle(.secondary) }
            }
            .searchable(text: $query)
            .navigationTitle(app.bootstrap?.resource(resource)?.labelPlural ?? resource)
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                if let res = app.bootstrap?.resource(resource), res.canCreate {
                    ToolbarItem(placement: .bzTrailing) {
                        Button { dismiss(); app.push(.create(resource, prefill: nil)) } label: { Label(L("New"), systemImage: "plus") }
                    }
                }
            }
            .task(id: query) {
                try? await Task.sleep(for: .milliseconds(query.isEmpty ? 0 : 200))
                var q: [String: String?] = ["q": query]
                for (k, v) in filter { q[k] = v.string }
                options = (try? await app.api.get("/app/options/\(resource)", query: q)) ?? []
                loading = false
            }
        }
        .sheetFrame()
    }
}
