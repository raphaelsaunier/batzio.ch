import BatzioKit
import SwiftUI

struct SidebarView: View {
    @Environment(AppModel.self) private var app
    @State private var query = ""
    @State private var hits: [SearchHit] = []

    var body: some View {
        @Bindable var app = app
        List(selection: $app.selection) {
            if !query.isEmpty {
                Section(L("Search")) {
                    if hits.isEmpty { Text(L("Nothing found")).foregroundStyle(.secondary) }
                    ForEach(hits, id: \.key) { hit in
                        Button {
                            app.push(.record(hit.resource, hit.id))
                        } label: {
                            VStack(alignment: .leading) {
                                Text(hit.label)
                                Text(hit.resourceLabel).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            ForEach(app.bootstrap?.navigation ?? []) { section in
                Section {
                    ForEach(section.items) { item in
                        Label { Text(item.title) } icon: { BZImage(name: item.icon) }
                            .tag(item.id)
                    }
                } header: {
                    if !section.label.isEmpty { Text(section.label) }
                }
            }
        }
        .searchable(text: $query, placement: .sidebar, prompt: L("Search everything"))
        .task(id: query) {
            guard query.count >= 2 else { hits = []; return }
            try? await Task.sleep(for: .milliseconds(250))
            hits = (try? await app.api.get("/app/search", query: ["q": query])) ?? []
        }
        .onChange(of: app.selection) { app.path = NavigationPath() }
        .navigationTitle(app.bootstrap?.tenant.name ?? "Batzio")
        .safeAreaInset(edge: .bottom) { SidebarFooter() }
        .toolbar {
            ToolbarItem {
                Menu {
                    ForEach(app.prefs.companies) { c in
                        Button(c.name) { Task { await app.choose(c) } }
                    }
                } label: {
                    Label(L("Switch company"), systemImage: "building.2")
                }
            }
        }
    }
}

private struct SidebarFooter: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: Binding(get: { app.isAccountant }, set: { on in Task { await app.setMode(on ? "accountant" : "simple") } })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Accountant goggles")).font(.bzBody(13, weight: .semibold))
                    Text(L("Classic terms, every module")).font(.bzBody(11)).foregroundStyle(.secondary)
                }
            }
            .toggleStyle(.switch)
            .controlSize(.small)
            if let user = app.prefs.user {
                HStack {
                    Image(systemName: "person.crop.circle.fill").foregroundStyle(Color.bzPrimary)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(user.name).font(.bzBody(13, weight: .medium))
                        Text(user.email).font(.bzBody(11)).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(12)
        .neuCard(cornerRadius: 16, padding: 0)
        .padding(10)
    }
}
