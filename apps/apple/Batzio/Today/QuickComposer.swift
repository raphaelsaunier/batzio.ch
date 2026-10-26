import BatzioKit
import SwiftUI

/// Type what happened in plain words; Batzi shows what it would do.
struct QuickComposer: View {
    @Environment(AppModel.self) private var app
    @State private var text = ""
    @State private var plan: QuickPlan?
    @State private var busy = false
    @FocusState private var focused: Bool


    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "sparkles").foregroundStyle(Color.bzPrimary)
                TextField(L("Type a quick sentence: “invoice Muster AG 3h consulting at 180”"), text: $text, axis: .vertical)
                    .font(.bzBody(16))
                    .lineLimit(1...4)
                    .focused($focused)
                    .onSubmit(primary)
                    .textFieldStyle(.plain)
                if !text.isEmpty {
                    Button(action: primary) { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                        .buttonStyle(.plain)
                        .foregroundStyle(Color.bzPrimary)
                        .disabled(busy)
                }
            }
            if let plan {
                VStack(alignment: .leading, spacing: 8) {
                    Text(plan.headline).font(.bzBody(15, weight: .semibold))
                    ForEach(plan.details, id: \.self) { Text("• \($0)").font(.bzBody(14)).foregroundStyle(.secondary) }
                    ForEach(plan.warnings, id: \.self) { Label($0, systemImage: "exclamationmark.triangle").font(.bzBody(13)).foregroundStyle(Color.bzWarning) }
                    FlowLayout {
                        ForEach(plan.actions) { a in
                            Button(a.label) { run(a.id) }
                                .buttonStyle(NeuButtonStyle(prominent: a.primary ?? false, compact: true))
                                .disabled(busy)
                        }
                        if app.bootstrap?.agent ?? false {
                            Button(L("Ask Batzi instead")) { ask() }.buttonStyle(.neuCompact)
                        }
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            } else if text.isEmpty {
                FlowLayout {
                    ForEach(app.bootstrap?.examples ?? [], id: \.self) { e in
                        Button(e) { text = e; focused = true }.buttonStyle(.neuCompact)
                    }
                }
            }
        }
        .neuCard()
        .animation(.spring(duration: 0.3), value: plan)
        .task(id: text) {
            let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard t.count >= 3 else { plan = nil; return }
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            plan = try? await app.api.send("POST", "/app/quick/plan", body: ["text": t]) as QuickPlan?
        }
    }

    private func primary() {
        if let a = plan?.actions.first(where: { $0.primary ?? false }) ?? plan?.actions.first { run(a.id) } else if !text.isEmpty { ask() }
    }

    private func ask() {
        let t = text
        text = ""
        app.showBatzi = true
        Task { await app.batzi.send(t) }
    }

    private func run(_ action: String) {
        Task {
            busy = true
            defer { busy = false }
            do {
                let outcome: QuickOutcome = try await app.api.send("POST", "/app/quick/run", body: ["text": text, "actionId": action])
                app.toast(outcome.message)
                text = ""
                plan = nil
                app.changed()
                if let record = outcome.record { app.open(record) }
            } catch {
                app.report(error)
            }
        }
    }
}
