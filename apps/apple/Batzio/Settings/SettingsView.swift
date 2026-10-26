import BatzioKit
import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    var section: String?

    var body: some View {
        Loader(id: "settings") { api in
            try await api.get("/app/settings") as SettingsScreen
        } content: { settings, refresh in
            Form {
                AccountSection()
                Section(L("Batzi & inbox")) {
                    Text(L("Everything here can also be set up by talking to Batzi or dropping a file.")).font(.bzBody(13)).foregroundStyle(.secondary)
                    if let inbox = settings.inbox {
                        LabeledContent(L("Inbox address")) {
                            HStack {
                                Text(inbox).textSelection(.enabled).lineLimit(1).truncationMode(.middle)
                                Button { Clipboard.copy(inbox); app.toast(L("Copied")) } label: { Image(systemName: "doc.on.doc") }.buttonStyle(.plain)
                            }
                        }
                        if settings.canWrite {
                            Button(L("Get a new address")) {
                                Task {
                                    do {
                                        let _: JSONValue = try await app.api.send("POST", "/app/inbox-address")
                                        app.toast(L("New address ready. The old one no longer works."))
                                        await refresh()
                                        await app.reload()
                                    } catch { app.report(error) }
                                }
                            }
                        }
                    }
                    LabeledContent(L("Batzi"), value: settings.agent ? L("Ready") : L("Needs an Anthropic API key on the server"))
                }
                Section(L("Company")) {
                    NavigationLink(L("Company profile")) { SettingsFormView(group: "company", form: settings.forms.company, canWrite: settings.canWrite, refresh: refresh) }
                    NavigationLink(L("Accounting")) { SettingsFormView(group: "accounting", form: settings.forms.accounting, canWrite: settings.canWrite, refresh: refresh) }
                    NavigationLink(L("Document texts")) { SettingsFormView(group: "texts", form: settings.forms.texts, canWrite: settings.canWrite, refresh: refresh) }
                    NavigationLink(L("Number formats")) { NumberingView(formats: settings.numbering, canWrite: settings.canWrite, refresh: refresh) }
                    if app.bootstrap?.can("users") ?? false { NavigationLink(L("Users & roles")) { TeamView() } }
                    NavigationLink(L("API & MCP")) { ApiKeysView() }
                }
                Section(L("Master data")) {
                    ForEach((app.bootstrap?.resources ?? []).filter { $0.nav?.group == "settings" }.sorted { ($0.nav?.order ?? 0) < ($1.nav?.order ?? 0) }) { r in
                        NavigationLink(value: Route.list(r.name)) { Label { Text(r.labelPlural) } icon: { BZImage(name: r.icon) } }
                    }
                    if app.bootstrap?.resource("audit_log") != nil {
                        NavigationLink(value: Route.list("audit_log")) { Label(L("Audit log"), systemImage: "checkmark.shield") }
                    }
                }
                Section {
                    LabeledContent(L("Server"), value: app.prefs.serverURL)
                    LabeledContent(L("Version"), value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
        }
        .bzPage()
        .navigationTitle(L("Settings"))
    }
}

private struct AccountSection: View {
    @Environment(AppModel.self) private var app
    @State private var changingPassword = false
    @State private var creatingCompany = false

    var body: some View {
        Section(L("You")) {
            if let user = app.prefs.user {
                LabeledContent(user.name, value: user.email)
            }
            Picker(L("Language"), selection: Binding(get: { app.prefs.locale ?? "" }, set: { v in Task { await app.setLocale(v.isEmpty ? nil : v) } })) {
                Text(L("Same as device")).tag("")
                Text("English").tag("en")
                Text("Deutsch").tag("de")
                Text("Français").tag("fr")
                Text("Italiano").tag("it")
            }
            Picker(L("Appearance"), selection: Binding(get: { app.prefs.appearance }, set: { app.prefs.appearance = $0 })) {
                Text(L("System")).tag("system")
                Text(L("Light")).tag("light")
                Text(L("Dark")).tag("dark")
            }
            Toggle(isOn: Binding(get: { app.isAccountant }, set: { on in Task { await app.setMode(on ? "accountant" : "simple") } })) {
                VStack(alignment: .leading) {
                    Text(L("Accountant goggles"))
                    Text(L("Classic terms, every module")).font(.caption).foregroundStyle(.secondary)
                }
            }
            if app.prefs.companies.count > 1 {
                Picker(L("Company"), selection: Binding(get: { app.tenantSlug }, set: { slug in
                    if let c = app.prefs.companies.first(where: { $0.slug == slug }) { Task { await app.choose(c) } }
                })) {
                    ForEach(app.prefs.companies) { Text($0.name).tag($0.slug) }
                }
            }
            Button(L("New company…")) { creatingCompany = true }
            Button(L("Change password…")) { changingPassword = true }
            Button(L("Sign out"), role: .destructive) { Task { await app.signOut() } }
        }
        .sheet(isPresented: $changingPassword) { PasswordSheet() }
        .sheet(isPresented: $creatingCompany) { NewCompanySheet() }
    }
}

private struct PasswordSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var next = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                SecureField(L("Current password"), text: $current).textContentType(.password)
                SecureField(L("New password (at least 10 characters)"), text: $next).textContentType(.newPassword)
                if let error { Text(error).foregroundStyle(Color.bzDestructive) }
            }
            .formStyle(.grouped)
            .navigationTitle(L("Change password"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) {
                        Task {
                            do {
                                let body: [String: JSONValue] = ["password": .object(["current": .string(current), "next": .string(next)])]
                                let _: JSONValue = try await app.api.send("PATCH", "/auth/me", body: body)
                                app.toast(L("Password changed."))
                                dismiss()
                            } catch { self.error = error.localizedDescription }
                        }
                    }
                    .disabled(next.count < 10 || current.isEmpty)
                }
            }
        }
        .sheetFrame()
    }
}

private struct NewCompanySheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var language = I18n.locale == "en" ? "de" : I18n.locale
    @State private var demo = false
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                TextField(L("Company name"), text: $name)
                Picker(L("Document language"), selection: $language) {
                    Text("Deutsch").tag("de")
                    Text("Français").tag("fr")
                    Text("Italiano").tag("it")
                    Text("English").tag("en")
                }
                Toggle(L("Start with demo data"), isOn: $demo)
            }
            .formStyle(.grouped)
            .navigationTitle(L("New company"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Create")) {
                        Task {
                            busy = true
                            defer { busy = false }
                            do {
                                let created: [String: String] = try await app.api.send("POST", "/auth/companies", body: ["name": .string(name), "language": .string(language), "demo": .bool(demo)] as [String: JSONValue])
                                let account: AccountInfo = try await app.api.get("/auth/me")
                                app.prefs.companies = account.companies
                                dismiss()
                                if let c = account.companies.first(where: { $0.slug == created["slug"] }) { await app.choose(c) }
                            } catch { app.report(error) }
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                }
            }
        }
        .sheetFrame()
    }
}

struct SettingsFormView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let group: String
    let form: SettingsForm
    let canWrite: Bool
    let refresh: () async -> Void
    @State private var values: Record = [:]
    @State private var logoPicking = false

    var body: some View {
        Form {
            if group == "company" {
                Section(L("Logo")) {
                    Button(L("Upload logo…")) { logoPicking = true }.disabled(!canWrite)
                }
            }
            Section {
                ForEach(form.fields) { field in
                    FieldEditor(field: field, value: Binding(get: { values[field.name] }, set: { values[field.name] = $0 }))
                        .disabled(!canWrite)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(group == "company" ? L("Company profile") : group == "accounting" ? L("Accounting") : L("Document texts"))
        .onAppear { values = form.values }
        .toolbar {
            if canWrite {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) {
                        Task {
                            do {
                                let r: MessageResult = try await app.api.send("PATCH", "/app/settings/\(group)", body: values)
                                app.toast(r.message)
                                await refresh()
                                await app.reload()
                                dismiss()
                            } catch { app.report(error) }
                        }
                    }
                }
            }
        }
        .fileImporter(isPresented: $logoPicking, allowedContentTypes: [.png, .jpeg]) { r in
            guard case .success(let url) = r, let file = ItemLoader.uploads(from: [url]).first else { return }
            Task {
                do {
                    let stored: JSONValue = try await app.api.upload("/files/upload", files: [file.upload], fileField: "file", fields: ["description": "Logo"])
                    if let id = stored["id"]?.int {
                        let _: MessageResult = try await app.api.send("PATCH", "/app/settings/company", body: ["logo_file_id": .number(Double(id))] as [String: JSONValue])
                        app.toast(L("Logo saved. It is printed on your documents."))
                    }
                } catch { app.report(error) }
            }
        }
    }
}

struct NumberingView: View {
    @Environment(AppModel.self) private var app
    let formats: [NumberFormat]
    let canWrite: Bool
    let refresh: () async -> Void
    @State private var editing: NumberFormat?

    var body: some View {
        List(formats) { f in
            Button { if canWrite { editing = f } } label: {
                HStack {
                    VStack(alignment: .leading) {
                        Text(f.label)
                        Text(f.format).font(.bzBody(12)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(f.preview).font(.bzNumber(14)).foregroundStyle(Color.bzPrimary)
                }
            }
            .buttonStyle(.plain)
        }
        .navigationTitle(L("Number formats"))
        .sheet(item: $editing) { f in NumberFormatSheet(format: f, refresh: refresh) }
    }
}

private struct NumberFormatSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let format: NumberFormat
    let refresh: () async -> Void
    @State private var pattern = ""
    @State private var next = 1

    var body: some View {
        NavigationStack {
            Form {
                TextField(L("Format"), text: $pattern).plainInput()
                Stepper(L("Next number: {nr}", ["nr": String(next)]), value: $next, in: 1...999_999)
                Text(L("Use {YYYY}, {YY}, {MM} and #### for the counter.")).font(.caption).foregroundStyle(.secondary)
            }
            .formStyle(.grouped)
            .navigationTitle(format.label)
            .onAppear { pattern = format.format; next = format.next_value }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) {
                        Task {
                            do {
                                let r: MessageResult = try await app.api.send("PATCH", "/app/numbering/\(format.key)", body: ["format": .string(pattern), "next_value": .number(Double(next))] as [String: JSONValue])
                                app.toast(r.message)
                                await refresh()
                                dismiss()
                            } catch { app.report(error) }
                        }
                    }
                }
            }
        }
        .sheetFrame()
    }
}

struct TeamView: View {
    @Environment(AppModel.self) private var app
    @State private var inviting = false
    static let roles = ["owner", "admin", "accountant", "member", "viewer"]

    var body: some View {
        Loader(id: "team") { api in try await api.get("/app/team") as TeamScreen } content: { team, refresh in
            List {
                Section(L("Members")) {
                    ForEach(team.members) { m in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(m.name)
                                Text(m.email).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if team.canWrite && m.user_id != team.me {
                                Menu(roleLabel(m.role)) {
                                    ForEach(Self.roles, id: \.self) { role in
                                        Button(roleLabel(role)) { Task { await setRole(m, role, refresh) } }
                                    }
                                    Divider()
                                    Button(L("Remove"), role: .destructive) { Task { await remove(m, refresh) } }
                                }
                                .fixedSize()
                            } else {
                                Text(roleLabel(m.role)).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                if !team.invitations.isEmpty {
                    Section(L("Invitations")) {
                        ForEach(team.invitations) { i in LabeledContent(i.email, value: roleLabel(i.role)) }
                    }
                }
            }
            .toolbar {
                if team.canWrite {
                    ToolbarItem(placement: .bzTrailing) { Button { inviting = true } label: { Label(L("Invite"), systemImage: "person.badge.plus") } }
                }
            }
            .sheet(isPresented: $inviting) { InviteSheet(refresh: refresh) }
        }
        .navigationTitle(L("Users & roles"))
    }

    func roleLabel(_ role: String) -> String {
        switch role {
        case "owner": L("Owner")
        case "admin": L("Administrator")
        case "accountant": L("Accountant")
        case "member": L("Member")
        default: L("Viewer")
        }
    }

    private func setRole(_ m: Member, _ role: String, _ refresh: () async -> Void) async {
        do {
            let _: JSONValue = try await app.api.send("PATCH", "/app/team/\(m.user_id)", body: ["role": role])
            app.toast(L("Role updated."))
            await refresh()
        } catch { app.report(error) }
    }

    private func remove(_ m: Member, _ refresh: () async -> Void) async {
        do {
            let _: JSONValue = try await app.api.send("DELETE", "/app/team/\(m.user_id)")
            app.toast(L("Member removed."))
            await refresh()
        } catch { app.report(error) }
    }
}

private struct InviteSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let refresh: () async -> Void
    @State private var email = ""
    @State private var role = "member"
    @State private var link: String?

    var body: some View {
        NavigationStack {
            Form {
                TextField(L("Email"), text: $email).emailKeyboard()
                Picker(L("Role"), selection: $role) {
                    ForEach(TeamView.roles, id: \.self) { Text(TeamView().roleLabel($0)).tag($0) }
                }
                if let link {
                    Section(L("Share this link with your colleague")) {
                        Text(link).textSelection(.enabled).font(.caption)
                        Button(L("Copy")) { Clipboard.copy(link); app.toast(L("Copied")) }
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(L("Invite"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(link == nil ? L("Cancel") : L("Done")) { dismiss() } }
                if link == nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(L("Invite")) {
                            Task {
                                do {
                                    let r: InviteResult = try await app.api.send("POST", "/app/team", body: ["email": email, "role": role])
                                    app.toast(r.message)
                                    await refresh()
                                    if let l = r.link { link = l } else { dismiss() }
                                } catch { app.report(error) }
                            }
                        }
                        .disabled(!email.contains("@"))
                    }
                }
            }
        }
        .sheetFrame()
    }
}

struct ApiKeysView: View {
    @Environment(AppModel.self) private var app
    @State private var creating = false

    var body: some View {
        Loader(id: "api-keys") { api in try await api.get("/app/api-keys") as [ApiKeyInfo] } content: { keys, refresh in
            List {
                Section {
                    Text(L("Connect scripts, other software and AI assistants (MCP) with an API key.")).font(.bzBody(13)).foregroundStyle(.secondary)
                    LabeledContent("MCP", value: "\(app.prefs.serverURL)/api/mcp").textSelection(.enabled)
                }
                ForEach(keys) { k in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(k.name)
                            Text("\(k.prefix)… · \(k.scope) · \(k.user_name)").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if k.revoked_at != nil {
                            ToneBadge(L("Revoked"), tone: .muted)
                        } else {
                            Button(L("Revoke"), role: .destructive) {
                                Task {
                                    do {
                                        let _: JSONValue = try await app.api.send("DELETE", "/app/api-keys/\(k.id)")
                                        app.toast(L("API key revoked."))
                                        await refresh()
                                    } catch { app.report(error) }
                                }
                            }
                            .buttonStyle(.neuCompact)
                        }
                    }
                }
            }
            .toolbar { ToolbarItem(placement: .bzTrailing) { Button { creating = true } label: { Label(L("New API key"), systemImage: "plus") } } }
            .sheet(isPresented: $creating) { NewKeySheet(refresh: refresh) }
        }
        .navigationTitle(L("API & MCP"))
    }
}

private struct NewKeySheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let refresh: () async -> Void
    @State private var name = ""
    @State private var write = false
    @State private var key: String?

    var body: some View {
        NavigationStack {
            Form {
                if let key {
                    Section(L("API key created. Copy it now — it will not be shown again.")) {
                        Text(key).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                        Button(L("Copy")) { Clipboard.copy(key); app.toast(L("Copied")) }
                    }
                } else {
                    TextField(L("Name"), text: $name)
                    Toggle(L("Allow changes (not just reading)"), isOn: $write)
                }
            }
            .formStyle(.grouped)
            .navigationTitle(L("New API key"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(key == nil ? L("Cancel") : L("Done")) { dismiss() } }
                if key == nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(L("Create")) {
                            Task {
                                do {
                                    let r: CreatedApiKey = try await app.api.send("POST", "/app/api-keys", body: ["name": name, "scope": write ? "write" : "read", "role": app.bootstrap?.role ?? "viewer"])
                                    key = r.key
                                    await refresh()
                                } catch { app.report(error) }
                            }
                        }
                    }
                }
            }
        }
        .sheetFrame()
    }
}
