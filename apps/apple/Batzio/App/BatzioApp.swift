import BatzioKit
import SwiftUI

@main
struct BatzioApp: App {
    @State private var model = AppModel()

    init() {
        BZFonts.register()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(model.colorScheme)
                .tint(.bzPrimary)
                .onOpenURL { url in Task { await model.open(url: url) } }
        }
        #if os(macOS)
        .defaultSize(width: 1280, height: 820)
        .commands { BatzioCommands(model: model) }
        #endif

        #if os(visionOS)
        WindowGroup(id: "batzi") {
            BatziPanel()
                .environment(model)
                .font(.bzBody())
        }
        .defaultSize(width: 460, height: 760)
        #endif

        #if os(macOS)
        Settings {
            NavigationStack { SettingsView() }
                .environment(model)
                .frame(minWidth: 620, minHeight: 520)
                .preferredColorScheme(model.colorScheme)
        }
        #endif
    }
}

#if os(macOS)
struct BatzioCommands: Commands {
    let model: AppModel

    var body: some Commands {
        CommandGroup(after: .newItem) {
            Button(L("Ask Batzi")) { model.showBatzi.toggle() }
                .keyboardShortcut("j", modifiers: .command)
            Button(L("Today")) { model.go(.today) }
                .keyboardShortcut("0", modifiers: .command)
            Button(L("Reload")) { Task { await model.reload() } }
                .keyboardShortcut("r", modifiers: .command)
        }
    }
}
#endif
