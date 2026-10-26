import BatzioKit
import SwiftUI

struct MainView: View {
    @Environment(AppModel.self) private var app
    @State private var dropTargeted = false
    #if os(visionOS)
    @Environment(\.openWindow) private var openWindow
    #endif

    var body: some View {
        @Bindable var app = app
        NavigationSplitView {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 220, ideal: 260)
        } detail: {
            NavigationStack(path: $app.path) {
                DestinationView(item: app.selectedItem)
                    .navigationDestination(for: Route.self) { RouteView(route: $0) }
            }
        }
        #if os(visionOS)
        // Batzi floats in its own window next to the books.
        .onChange(of: app.showBatzi) {
            if app.showBatzi {
                openWindow(id: "batzi")
                app.showBatzi = false
            }
        }
        #else
        .inspector(isPresented: $app.showBatzi) {
            BatziPanel()
                .inspectorColumnWidth(min: 320, ideal: 380, max: 520)
        }
        #endif
        .toolbar {
            ToolbarItem(placement: .bzTrailing) {
                Button {
                    app.showBatzi.toggle()
                } label: {
                    Label(L("Ask Batzi"), systemImage: "sparkles")
                }
                .keyboardShortcut("j", modifiers: .command)
            }
        }
        .overlay(alignment: .bottom) { ToastStack() }
        .overlay {
            if dropTargeted {
                VStack(spacing: 10) {
                    Image(systemName: "tray.and.arrow.down.fill").font(.system(size: 44)).foregroundStyle(Color.bzPrimary)
                    Text(L("Drop it — Batzi takes care of it")).font(.bzDisplay(22))
                    Text(L("Receipts, bills, bank statements, spreadsheets, screenshots…")).font(.bzBody(14)).foregroundStyle(.secondary)
                }
                .padding(40)
                .neuCard()
                .padding(40)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.bzBackground.opacity(0.6))
                .allowsHitTesting(false)
            }
        }
        .onDrop(of: dropTypes, isTargeted: $dropTargeted) { providers in
            Task {
                let files = await ItemLoader.uploads(from: providers)
                await app.drop(files.uploads)
            }
            return true
        }
        #if os(macOS)
        .onPasteCommand(of: [.fileURL, .image, .pdf]) { providers in
            Task {
                let files = await ItemLoader.uploads(from: providers)
                await app.drop(files.uploads)
            }
        }
        #endif
    }
}

/// The root screen of the selected sidebar item.
struct DestinationView: View {
    @Environment(AppModel.self) private var app
    let item: NavItem?

    var body: some View {
        if let item {
            TargetView(target: item.target, tabs: item.tabs, title: item.title)
                .id(item.id)
        } else {
            TodayView()
        }
    }
}

struct TargetView: View {
    let target: AppTarget
    var tabs: [NavTab] = []
    var title: String?

    var body: some View {
        switch target {
        case .today:
            TodayView()
        case .reports(let id):
            if let id { ReportView(id: id) } else { ReportsView() }
        case .resource(let name, let id, let create):
            if let id {
                RecordDetailView(resource: name, id: id)
            } else if create {
                RecordFormView(resource: name, id: nil)
            } else {
                ResourceListView(resource: name, tabs: tabs, title: title)
            }
        case .bankImport:
            BankImportView()
        case .payroll:
            PayrollRunView()
        case .settings(let section):
            SettingsView(section: section)
        case .file(let id):
            FileView(id: id, name: nil)
        case .url(let href):
            EmptyState(title: href)
        }
    }
}

struct RouteView: View {
    let route: Route

    var body: some View {
        switch route {
        case .list(let name): ResourceListView(resource: name)
        case .record(let name, let id): RecordDetailView(resource: name, id: id)
        case .create(let name, let prefill): RecordFormView(resource: name, id: nil, prefill: prefill)
        case .edit(let name, let id): RecordFormView(resource: name, id: id)
        case .report(let id): ReportView(id: id)
        case .file(let id, let name): FileView(id: id, name: name)
        case .target(let target): TargetView(target: target)
        }
    }
}

/// Shows an attachment from the server.
struct FileView: View {
    @Environment(AppModel.self) private var app
    let id: Int
    let name: String?
    @State private var file: LocalFile?
    @State private var error: String?

    var body: some View {
        Group {
            if let file {
                if file.isPDF { PDFKitView(url: file.url) } else {
                    #if os(macOS)
                    EmptyState(title: file.url.lastPathComponent)
                    #else
                    QuickLookView(url: file.url)
                    #endif
                }
            } else if let error {
                ErrorState(message: error)
            } else {
                ProgressView()
            }
        }
        .navigationTitle(name ?? L("File"))
        .toolbar { if let file { ToolbarItem(placement: .bzTrailing) { ShareLink(item: file.url) } } }
        .task {
            do {
                let d = try await app.api.download("/files/\(id)/download", query: ["inline": "1"])
                file = try LocalFile.write(d.data, name: d.filename)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
