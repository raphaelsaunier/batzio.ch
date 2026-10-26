import BatzioKit
import SwiftUI
#if os(macOS) && DEBUG
import AppKit
#endif

/// Session, company, navigation and the bits every screen shares.
@Observable @MainActor
final class AppModel {
    enum Phase: Equatable {
        case signedOut
        case choosingCompany
        case loading
        case ready
        case failed(String)
    }

    struct Toast: Identifiable, Equatable {
        let id = UUID()
        let text: String
        var tone: Tone = .success
    }

    var prefs = Preferences.load() {
        didSet {
            prefs.save()
            I18n.locale = locale
        }
    }

    private(set) var token: String? = Keychain.get("token")
    var phase: Phase = .signedOut
    var bootstrap: Bootstrap?
    var selection: String?
    var path = NavigationPath()
    var showBatzi = false
    var toasts: [Toast] = []
    /// Bumped after changes so open screens reload.
    var revision = 0
    let batzi = BatziModel()

    var locale: String { prefs.locale ?? I18n.preferred() }
    var isAccountant: Bool { prefs.mode == "accountant" }
    var tenantSlug: String { prefs.tenant ?? "" }

    var colorScheme: ColorScheme? {
        switch prefs.appearance {
        case "light": .light
        case "dark": .dark
        default: nil
        }
    }

    var api: APIClient {
        APIClient(baseURL: URL(string: prefs.serverURL) ?? URL(string: Preferences.defaultServer)!, token: token, tenant: prefs.tenant, locale: locale, mode: prefs.mode)
    }

    init() {
        #if DEBUG
        applyDebugArguments()
        #endif
        I18n.locale = locale
        batzi.app = self
        if token != nil {
            phase = prefs.tenant == nil ? .choosingCompany : .loading
            Task { await start() }
        }
    }

    #if DEBUG
    /// Launch arguments for automated screenshots and UI checks, e.g.
    /// `-batzioToken <session> -batzioTenant acme -batzioLocale de -batzioOpen invoices`.
    /// On macOS, `-batzioSnapshot <name.png>` writes the window to the app's
    /// temporary folder (it is sandboxed) and quits.
    private var debugOpen: String?
    private var debugSnapshot: String?

    private func applyDebugArguments() {
        let d = UserDefaults.standard
        if let server = d.string(forKey: "batzioServer") { prefs.serverURL = server }
        if let t = d.string(forKey: "batzioToken") {
            token = t
            Keychain.set(t, for: "token")
        }
        if let slug = d.string(forKey: "batzioTenant") { prefs.tenant = slug }
        if let l = d.string(forKey: "batzioLocale") { prefs.locale = l }
        if let m = d.string(forKey: "batzioMode") { prefs.mode = m }
        debugOpen = d.string(forKey: "batzioOpen")
        debugSnapshot = d.string(forKey: "batzioSnapshot")
    }

    private func openDebugTarget() {
        guard let target = debugOpen else { return }
        debugOpen = nil
        let parts = target.split(separator: ":").map(String.init)
        switch parts.first {
        case "today": go(.today)
        case "batzi": showBatzi = true
        case "reports": parts.count > 1 ? push(.report(parts[1])) : go(.reports(nil))
        case "settings": go(.settings(nil))
        case "record" where parts.count == 3: push(.record(parts[1], Int(parts[2]) ?? 0))
        case "new" where parts.count == 2: push(.create(parts[1], prefill: nil))
        case let name?: go(.resource(name, id: nil, create: false))
        default: break
        }
        #if os(macOS)
        if let name = debugSnapshot {
            debugSnapshot = nil
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(5))
                Self.snapshotWindow(to: name)
                NSApp.terminate(nil)
            }
        }
        #endif
    }

    #if os(macOS)
    /// The main window as the window server shows it (an app may capture its
    /// own windows without screen-recording permission).
    private static func snapshotWindow(to name: String) {
        guard let window = NSApp.windows.first(where: { $0.isVisible && !($0 is NSPanel) }),
              let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImage") else { return }
        typealias CreateImage = @convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?
        let create = unsafeBitCast(symbol, to: CreateImage.self)
        // Including window · bounds ignore framing | best resolution.
        guard let image = create(.null, 1 << 3, UInt32(window.windowNumber), (1 << 0) | (1 << 3))?.takeRetainedValue() else { return }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(URL(fileURLWithPath: name).lastPathComponent)
        try? NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])?.write(to: file)
    }
    #endif
    #endif

    // MARK: Session

    func start() async {
        guard token != nil else { phase = .signedOut; return }
        do {
            let account: AccountInfo = try await api.get("/auth/me")
            prefs.user = account.user
            prefs.companies = account.companies
            if prefs.tenant == nil || !account.companies.contains(where: { $0.slug == prefs.tenant }) {
                if account.companies.count == 1 {
                    prefs.tenant = account.companies[0].slug
                } else {
                    phase = .choosingCompany
                    return
                }
            }
            await reload()
        } catch let error as APIError where error.isUnauthorized {
            await signOut()
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    func signedIn(_ result: AuthResult) async {
        token = result.token
        Keychain.set(result.token, for: "token")
        prefs.user = result.user
        prefs.companies = result.companies
        if prefs.locale == nil, let l = result.user.locale, I18n.supported.contains(l) { prefs.locale = l }
        prefs.tenant = result.companies.count == 1 ? result.companies[0].slug : nil
        if prefs.tenant == nil { phase = .choosingCompany } else { phase = .loading; await reload() }
    }

    func signIn(email: String, password: String) async throws {
        let result: AuthResult = try await api.send("POST", "/auth/login", body: ["email": email, "password": password])
        await signedIn(result)
    }

    func signUp(name: String, email: String, password: String, company: String, language: String, demo: Bool) async throws {
        let body: [String: JSONValue] = ["name": .string(name), "email": .string(email), "password": .string(password), "company": .string(company), "language": .string(language), "demo": .bool(demo)]
        let result: AuthResult = try await api.send("POST", "/auth/signup", body: body)
        await signedIn(result)
    }

    func signOut() async {
        if token != nil { let _: JSONValue? = try? await api.send("POST", "/auth/logout") }
        token = nil
        Keychain.set(nil, for: "token")
        prefs.tenant = nil
        prefs.user = nil
        prefs.companies = []
        bootstrap = nil
        selection = nil
        path = NavigationPath()
        batzi.reset()
        phase = .signedOut
    }

    func choose(_ company: Company) async {
        prefs.tenant = company.slug
        bootstrap = nil
        selection = nil
        path = NavigationPath()
        batzi.reset()
        phase = .loading
        await reload()
    }

    /// Loads (or reloads) navigation and every module definition.
    func reload() async {
        do {
            let b: Bootstrap = try await api.get("/app/bootstrap", query: ["mode": prefs.mode])
            bootstrap = b
            if selection == nil || !b.navigation.flatMap(\.items).contains(where: { $0.id == selection }) {
                selection = b.navigation.first?.items.first?.id
            }
            phase = .ready
            revision += 1
            #if DEBUG
            Task {
                try? await Task.sleep(for: .milliseconds(700))
                openDebugTarget()
            }
            #endif
        } catch let error as APIError where error.isUnauthorized {
            await signOut()
        } catch {
            phase = bootstrap == nil ? .failed(error.localizedDescription) : .ready
            if bootstrap != nil { toast(error.localizedDescription, tone: .danger) }
        }
    }

    func setLocale(_ value: String?) async {
        prefs.locale = value
        if let value { let _: JSONValue? = try? await api.send("PATCH", "/auth/me", body: ["locale": value]) }
        await reload()
    }

    func setMode(_ mode: String) async {
        prefs.mode = mode
        await reload()
    }

    // MARK: Navigation

    var selectedItem: NavItem? {
        bootstrap?.navigation.flatMap(\.items).first { $0.id == selection }
    }

    /// Opens a destination: top-level ones select the sidebar, the rest push.
    func go(_ target: AppTarget) {
        if let item = bootstrap?.navigation.flatMap(\.items).first(where: { $0.target == target || $0.tabs.contains { $0.target == target } }),
           case .resource(_, nil, false) = target {
            selection = item.id
            path = NavigationPath()
            return
        }
        if let item = bootstrap?.navigation.flatMap(\.items).first(where: { $0.target == target }) {
            selection = item.id
            path = NavigationPath()
            return
        }
        path.append(target.route)
    }

    func push(_ route: Route) { path.append(route) }

    func open(_ ref: RecordRef) { push(.record(ref.resource, ref.id)) }

    /// The web path of what is on screen, so Batzi knows the context.
    var currentPage: String {
        "/\(tenantSlug)"
    }

    // MARK: Feedback

    func toast(_ text: String, tone: Tone = .success) {
        let t = Toast(text: text, tone: tone)
        withAnimation(.spring) { toasts.append(t) }
        Task {
            try? await Task.sleep(for: .seconds(4))
            withAnimation(.easeOut) { toasts.removeAll { $0.id == t.id } }
        }
    }

    func report(_ error: Error) {
        toast(error.localizedDescription, tone: .danger)
    }

    func changed() { revision += 1 }

    // MARK: Drops

    /// Files dropped, shared or opened with Batzio: handled at once where possible, else queued for Batzi.
    func drop(_ files: [UploadFile]) async {
        guard !files.isEmpty, phase == .ready else { return }
        toast(L("Got it — reading {n} file(s)…", ["n": files.count]), tone: .info)
        do {
            let outcomes: [DropOutcome] = try await api.upload("/api/drop", files: files)
            for o in outcomes { toast(o.text ?? o.file.name, tone: o.handled ? .success : .info) }
            changed()
        } catch {
            report(error)
        }
    }

    func open(url: URL) async {
        if url.isFileURL {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { return }
            await drop([UploadFile(name: url.lastPathComponent, mimeType: url.mimeType, data: data)])
        }
    }
}
