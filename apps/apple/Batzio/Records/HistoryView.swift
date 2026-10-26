import BatzioKit
import SwiftUI

/// A record's history in words: who (a person or software), from where, before → after, and undo.
struct HistorySection: View {
    @Environment(AppModel.self) private var app
    let entries: [HistoryEntry]
    let refresh: () async -> Void
    @State private var undoing: HistoryEntry?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle(text: L("History"))
            ForEach(entries) { entry in
                HistoryRow(entry: entry) { undoing = entry }
            }
        }
        .neuCard()
        .confirmationDialog(L("Undo this change?"), isPresented: Binding(get: { undoing != nil }, set: { if !$0 { undoing = nil } }), titleVisibility: .visible, presenting: undoing) { entry in
            Button(L("Undo")) { Task { await undo(entry) } }
            Button(L("Cancel"), role: .cancel) {}
        } message: { _ in
            Text(L("Puts the record back the way it was before this change (or removes what it created, or brings back what it deleted). Booked, issued or paid records are never rewritten."))
        }
    }

    private func undo(_ entry: HistoryEntry) async {
        do {
            let _: ActionResponse = try await app.api.send("POST", "/audit_log/\(entry.id)/undo")
            app.toast(L("Change undone."))
            app.changed()
            await refresh()
        } catch {
            app.report(error)
        }
    }
}

private struct HistoryRow: View {
    let entry: HistoryEntry
    let onUndo: () -> Void

    private var automated: Bool { entry.actor?.automated ?? (entry.source != "ui" && entry.source != "app") }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: automated ? "cpu" : "person.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(automated ? Color.bzPrimary : .secondary)
                .frame(width: 28, height: 28)
                .background(Circle().fill(automated ? Color.bzPrimary.opacity(0.12) : Color.secondary.opacity(0.1)))
                .accessibilityLabel(automated ? L("Software") : L("Person"))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(entry.title ?? entry.summary ?? entry.action).font(.bzBody(14, weight: .semibold))
                    if let name = entry.actor?.name ?? entry.actor_name { Text(name).font(.bzBody(13)).foregroundStyle(.secondary) }
                    if let source = entry.actor?.sourceLabel { ToneBadge(source, tone: .muted) }
                }
                Text([entry.when ?? Fmt.dateTime(entry.at), entry.device].compactMap { $0 }.joined(separator: " · "))
                    .font(.bzBody(12))
                    .foregroundStyle(.secondary)
                ForEach(entry.provenance ?? [], id: \.self) { p in
                    Text(p.detail.map { "\(p.label): \($0)" } ?? p.label).font(.bzBody(12)).foregroundStyle(.secondary)
                }
                if let undoneBy = entry.undo?.undoneBy {
                    Text(L("Undone in entry #{id}", ["id": undoneBy])).font(.bzBody(12)).foregroundStyle(.secondary)
                }
                ForEach(Array((entry.changes ?? []).prefix(6).enumerated()), id: \.offset) { _, change in
                    ChangeLine(change: change)
                }
                if (entry.changes?.count ?? 0) > 6 {
                    Text(L("Show all {n} changes", ["n": entry.changes?.count ?? 0])).font(.bzBody(12)).foregroundStyle(.secondary)
                }
                if entry.undo?.possible == true {
                    Button(L("Undo"), systemImage: "arrow.uturn.backward", action: onUndo)
                        .buttonStyle(.neuCompact)
                        .padding(.top, 2)
                }
            }
        }
    }
}

private struct ChangeLine: View {
    let change: HistoryChange

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(change.label).foregroundStyle(.secondary).frame(minWidth: 90, alignment: .leading)
            switch change.kind {
            case "added":
                Text("+ \(change.to ?? "")").foregroundStyle(Color.bzSuccess)
            case "removed":
                Text("− \(change.from ?? "")").strikethrough().foregroundStyle(Color.bzDestructive)
            default:
                if let from = change.from { Text(from).strikethrough().foregroundStyle(Color.bzDestructive.opacity(0.8)) }
                Text("→ \(change.to ?? "–")").foregroundStyle(Color.bzSuccess)
            }
        }
        .font(.bzBody(12))
        .lineLimit(2)
    }
}
