import Foundation

/// What the app remembers between launches (the token lives in the keychain).
public struct Preferences: Codable, Sendable, Equatable {
    public var serverURL: String
    public var tenant: String?
    public var user: UserInfo?
    public var companies: [Company]
    /// nil follows the device language.
    public var locale: String?
    /// "simple" (plain words) or "accountant" (classic terms, every module).
    public var mode: String
    /// "system", "light" or "dark".
    public var appearance: String

    public static let defaultServer = "https://www.batzio.ch"

    /// Working without a server: the engine runs on this device (``LocalEngine``).
    public var isOnDevice: Bool { serverURL == LocalEngine.origin.absoluteString }

    public init(serverURL: String = Preferences.defaultServer, tenant: String? = nil, user: UserInfo? = nil, companies: [Company] = [], locale: String? = nil, mode: String = "simple", appearance: String = "system") {
        self.serverURL = serverURL
        self.tenant = tenant
        self.user = user
        self.companies = companies
        self.locale = locale
        self.mode = mode
        self.appearance = appearance
    }

    private static let key = "batzio.preferences"

    public static func load(_ defaults: UserDefaults = .standard) -> Preferences {
        guard let data = defaults.data(forKey: key), let prefs = try? JSONDecoder().decode(Preferences.self, from: data) else { return Preferences() }
        return prefs
    }

    public func save(_ defaults: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.key) }
    }
}
