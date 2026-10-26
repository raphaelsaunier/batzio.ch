import BatzioKit
import SwiftUI

struct WelcomeView: View {
    enum Tab: Hashable { case signIn, signUp, device }

    @Environment(AppModel.self) private var app
    @State private var tab: Tab = .signIn

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 10) {
                    CoinView(size: 180)
                    CoinTagline()
                    Text(L("Born from a deep aversion to accounting. Drop a receipt, say what happened, Batzi does the books."))
                        .font(.bzBody(16))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 440)
                    ExperimentNotice()
                        .frame(maxWidth: 440)
                }
                .padding(.top, 24)

                VStack(spacing: 16) {
                    Picker("", selection: $tab) {
                        Text(L("Sign in")).tag(Tab.signIn)
                        Text(L("Create account")).tag(Tab.signUp)
                        Text(L("On this device")).tag(Tab.device)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    switch tab {
                    case .signIn: SignInForm()
                    case .signUp: SignUpForm()
                    case .device: DeviceForm()
                    }
                }
                .padding(24)
                .neuCard(padding: 0)
                .frame(maxWidth: 440)

                if tab != .device {
                    ServerField()
                        .frame(maxWidth: 440)
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        .bzPage()
    }
}

private struct SignInForm: View {
    @Environment(AppModel.self) private var app
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField(L("Email"), text: $email)
                .textContentType(.username)
                .emailKeyboard()
                .textFieldStyle(.roundedBorder)
            SecureField(L("Password"), text: $password)
                .textContentType(.password)
                .textFieldStyle(.roundedBorder)
                .onSubmit(submit)
            if let error { Text(error).font(.bzBody(13)).foregroundStyle(Color.bzDestructive) }
            Button(action: submit) {
                HStack { if busy { ProgressView().controlSize(.small) }; Text(L("Sign in")) }.frame(maxWidth: .infinity)
            }
            .buttonStyle(.metal)
            .disabled(busy || email.isEmpty || password.isEmpty)
        }
    }

    private func submit() {
        Task {
            busy = true
            defer { busy = false }
            do { try await app.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password) } catch { self.error = error.localizedDescription }
        }
    }
}

private struct SignUpForm: View {
    @Environment(AppModel.self) private var app
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var company = ""
    @State private var language = I18n.locale == "en" ? "de" : I18n.locale
    @State private var demo = true
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField(L("Your name"), text: $name).textContentType(.name).textFieldStyle(.roundedBorder)
            TextField(L("Email"), text: $email).textContentType(.emailAddress).emailKeyboard().textFieldStyle(.roundedBorder)
            SecureField(L("Password (at least 10 characters)"), text: $password).textContentType(.newPassword).textFieldStyle(.roundedBorder)
            TextField(L("Company name"), text: $company).textContentType(.organizationName).textFieldStyle(.roundedBorder)
            Picker(L("Document language"), selection: $language) {
                Text("Deutsch").tag("de")
                Text("Français").tag("fr")
                Text("Italiano").tag("it")
                Text("English").tag("en")
            }
            Toggle(L("Start with demo data"), isOn: $demo)
            if let error { Text(error).font(.bzBody(13)).foregroundStyle(Color.bzDestructive) }
            Button {
                Task {
                    busy = true
                    defer { busy = false }
                    do { try await app.signUp(name: name, email: email, password: password, company: company, language: language, demo: demo) } catch { self.error = error.localizedDescription }
                }
            } label: {
                HStack { if busy { ProgressView().controlSize(.small) }; Text(L("Create account")) }.frame(maxWidth: .infinity)
            }
            .buttonStyle(.metal)
            .disabled(busy || name.isEmpty || email.isEmpty || password.count < 10 || company.isEmpty)
        }
    }
}

/// Batzio is an experiment, not a product to trust with real books.
struct ExperimentNotice: View {
    var body: some View {
        Label {
            Text("\(Text(L("Batzio is a vibe-coding experiment.")).bold()) \(L("Don’t use it for real data — and please don’t sue us."))")
        } icon: {
            Image(systemName: "flask").foregroundStyle(Color.bzWarning)
        }
        .font(.bzBody(12))
        .foregroundStyle(.primary.opacity(0.8))
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color.bzWarning.opacity(0.16), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// Works without a server: SQLite files on this device, no account, no internet.
private struct DeviceForm: View {
    @Environment(AppModel.self) private var app
    @State private var name = ""
    @State private var company = ""
    @State private var language = I18n.locale == "en" ? "de" : I18n.locale
    @State private var demo = true
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label {
                Text(L("Everything stays on this device: no account and no internet needed. Batzi, the assistant, needs a connection and is off here."))
            } icon: {
                Image(systemName: "internaldrive")
            }
            .font(.bzBody(13))
            .foregroundStyle(.secondary)
            if app.hasDeviceData {
                Button { run { try await app.continueOnDevice() } } label: {
                    HStack { if busy { ProgressView().controlSize(.small) }; Text(L("Continue on this device")) }.frame(maxWidth: .infinity)
                }
                .buttonStyle(.metal)
                .disabled(busy)
            } else {
                TextField(L("Your name"), text: $name).textContentType(.name).textFieldStyle(.roundedBorder)
                TextField(L("Company name"), text: $company).textContentType(.organizationName).textFieldStyle(.roundedBorder)
                Picker(L("Document language"), selection: $language) {
                    Text("Deutsch").tag("de")
                    Text("Français").tag("fr")
                    Text("Italiano").tag("it")
                    Text("English").tag("en")
                }
                Toggle(L("Start with demo data"), isOn: $demo)
                Button { run { try await app.startOnDevice(name: name, company: company, language: language, demo: demo) } } label: {
                    HStack { if busy { ProgressView().controlSize(.small) }; Text(L("Start on this device")) }.frame(maxWidth: .infinity)
                }
                .buttonStyle(.metal)
                .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty || company.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if let error { Text(error).font(.bzBody(13)).foregroundStyle(Color.bzDestructive) }
        }
    }

    private func run(_ work: @escaping () async throws -> Void) {
        Task {
            busy = true
            defer { busy = false }
            do { try await work() } catch { self.error = error.localizedDescription }
        }
    }
}

private struct ServerField: View {
    @Environment(AppModel.self) private var app
    @State private var editing = false
    @State private var value = ""

    var body: some View {
        VStack(spacing: 8) {
            if editing {
                HStack {
                    TextField(L("Server address"), text: $value).plainInput().textFieldStyle(.roundedBorder)
                    Button(L("Save")) {
                        app.prefs.serverURL = value.trimmingCharacters(in: .whitespacesAndNewlines)
                        editing = false
                    }
                    .buttonStyle(.neuCompact)
                }
            } else {
                Button {
                    value = app.prefs.serverURL
                    editing = true
                } label: {
                    Label(app.prefs.serverURL, systemImage: "server.rack").font(.bzBody(12)).foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct CompanyPickerView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(spacing: 20) {
            CoinView(size: 90, autoplay: false)
            Text(L("Which company today?")).font(.bzDisplay(26))
            VStack(spacing: 12) {
                ForEach(app.prefs.companies) { c in
                    Button { Task { await app.choose(c) } } label: {
                        HStack {
                            Image(systemName: "building.2")
                            VStack(alignment: .leading) {
                                Text(c.name).font(.bzBody(16, weight: .semibold))
                                Text(c.slug).font(.bzBody(12)).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.neu)
                }
                if app.prefs.companies.isEmpty {
                    Text(L("You are not part of any company yet.")).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: 420)
            Button(L("Sign out")) { Task { await app.signOut() } }.buttonStyle(.plain).foregroundStyle(.secondary)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .bzPage()
    }
}
