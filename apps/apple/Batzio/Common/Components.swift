import BatzioKit
import SwiftUI

/// SF Symbol for a server icon name.
struct BZImage: View {
    let name: String?
    var body: some View { Image(systemName: BZIcon.symbol(name)) }
}

/// A label with a jargon tooltip when the term is in the glossary.
struct TermLabel: View {
    @Environment(AppModel.self) private var app
    let text: String
    let term: String?
    @State private var showing = false

    var body: some View {
        HStack(spacing: 4) {
            Text(text)
            if let entry = app.bootstrap?.explain(term) {
                Button { showing.toggle() } label: {
                    Image(systemName: "questionmark.circle").font(.caption).foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L("What does this mean?"))
                .popover(isPresented: $showing) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(entry.term).font(.bzDisplay(17))
                        Text(entry.text).font(.bzBody(14)).fixedSize(horizontal: false, vertical: true)
                    }
                    .padding()
                    .frame(maxWidth: 320)
                    .presentationCompactAdaptation(.popover)
                }
            }
        }
    }
}

struct StatusBadge: View {
    let field: FieldDef?
    let value: JSONValue?

    var body: some View {
        if let option = field?.option(for: value) {
            ToneBadge(option.label, tone: option.tone ?? .neutral)
        }
    }
}

/// The coin mascot with a message, for empty and error states.
struct EmptyState: View {
    let title: String
    var text: String?
    var systemImage: String?

    var body: some View {
        VStack(spacing: 12) {
            Image("CoinFront")
                .resizable()
                .scaledToFit()
                .frame(width: 72, height: 72)
                .shadow(color: .black.opacity(0.15), radius: 6, y: 4)
            Text(title).font(.bzDisplay(20)).multilineTextAlignment(.center)
            if let text { Text(text).font(.bzBody(15)).foregroundStyle(.secondary).multilineTextAlignment(.center) }
        }
        .padding(32)
        .frame(maxWidth: 440)
    }
}

struct ErrorState: View {
    let message: String
    var retry: (() async -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            EmptyState(title: L("Something went wrong"), text: message)
            if let retry {
                Button(L("Try again")) { Task { await retry() } }.buttonStyle(.neu)
            }
        }
    }
}

struct ToastStack: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(spacing: 8) {
            ForEach(app.toasts) { t in
                HStack(spacing: 10) {
                    Image(systemName: t.tone == .danger ? "exclamationmark.triangle.fill" : t.tone == .info ? "sparkles" : "checkmark.circle.fill")
                        .foregroundStyle(t.tone.foreground)
                    Text(t.text).font(.bzBody(14, weight: .medium)).multilineTextAlignment(.leading)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .neuCard(cornerRadius: 16, padding: 0)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.bottom, 20)
        .padding(.horizontal)
        .frame(maxWidth: 520)
    }
}

struct SectionTitle: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.bzBody(12, weight: .semibold))
            .foregroundStyle(.secondary)
            .tracking(0.6)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Loads a value and shows loading, error and content states.
struct Loader<Value: Sendable, Content: View>: View {
    @Environment(AppModel.self) private var app
    let id: String
    let load: (APIClient) async throws -> Value
    @ViewBuilder let content: (Value, @escaping () async -> Void) -> Content
    @State private var value: Value?
    @State private var error: String?

    init(id: String, load: @escaping (APIClient) async throws -> Value, @ViewBuilder content: @escaping (Value, @escaping () async -> Void) -> Content) {
        self.id = id
        self.load = load
        self.content = content
    }

    var body: some View {
        Group {
            if let value {
                content(value, refresh)
            } else if let error {
                ErrorState(message: error, retry: refresh)
            } else {
                ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: "\(id)#\(app.revision)#\(app.locale)") { await refresh() }
    }

    func refresh() async {
        do {
            value = try await load(app.api)
            error = nil
        } catch is CancellationError {
        } catch {
            if value == nil { self.error = error.localizedDescription } else { app.report(error) }
        }
    }
}
