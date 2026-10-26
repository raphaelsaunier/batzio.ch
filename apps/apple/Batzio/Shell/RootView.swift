import BatzioKit
import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            switch app.phase {
            case .signedOut:
                WelcomeView()
            case .choosingCompany:
                CompanyPickerView()
            case .loading:
                VStack(spacing: 16) {
                    CoinView(size: 96, autoplay: true)
                    ProgressView()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .bzPage()
            case .failed(let message):
                ErrorState(message: message) { await app.start() }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .bzPage()
                    .overlay(alignment: .bottom) {
                        Button(L("Sign out")) { Task { await app.signOut() } }.buttonStyle(.neu).padding()
                    }
            case .ready:
                MainView()
            }
        }
        .font(.bzBody())
        .environment(\.locale, I18n.formattingLocale)
        .id(app.locale)
    }
}
