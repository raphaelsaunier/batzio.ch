import Foundation
import Synchronization

/// The shared EN/DE/FR/IT catalog (generated from packages/i18n by `pnpm gen`).
/// Keys are the English text, exactly as on the web, so one translation serves
/// every surface.
public enum I18n {
    public static let supported = ["en", "de", "fr", "it"]

    private static let current = Mutex<String>(I18n.preferred())
    private static let table: [String: [String: String]] = {
        guard let url = Bundle.module.url(forResource: "strings", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode([String: [String: String]].self, from: data) else { return [:] }
        return decoded
    }()

    /// The language the app speaks (`en`, `de`, `fr` or `it`).
    public static var locale: String {
        get { current.withLock { $0 } }
        set { current.withLock { $0 = supported.contains(newValue) ? newValue : "en" } }
    }

    /// The device's preferred language among the supported ones.
    public static func preferred(_ languages: [String] = Locale.preferredLanguages) -> String {
        for language in languages {
            let code = String(language.prefix(2)).lowercased()
            if supported.contains(code) { return code }
        }
        return "en"
    }

    public static func translate(_ key: String, locale: String? = nil) -> String {
        let lang = locale ?? self.locale
        if lang == "en" { return key }
        return table[lang]?[key] ?? key
    }

    /// Fills `{name}` placeholders.
    public static func interpolate(_ text: String, _ vars: [String: CustomStringConvertible]) -> String {
        guard !vars.isEmpty else { return text }
        var out = text
        for (k, v) in vars { out = out.replacingOccurrences(of: "{\(k)}", with: v.description) }
        return out
    }

    /// Swiss formatting locale for the current language (`de-CH`, `fr-CH`, …).
    public static var formattingLocale: Locale { Locale(identifier: "\(locale)_CH") }
}

/// Translates an English UI string: `L("Today")`, `L("{n} records", ["n": 3])`.
public func L(_ key: String, _ vars: [String: CustomStringConvertible] = [:]) -> String {
    I18n.interpolate(I18n.translate(key), vars)
}
