import CoreText
import SwiftUI

public enum BZFonts {
    /// Registers the bundled brand fonts (Bricolage Grotesque, Inter) once.
    @MainActor public static func register(in bundle: Bundle = .main) {
        guard !registered else { return }
        registered = true
        for name in ["bricolage_grotesque", "inter"] {
            if let url = bundle.url(forResource: name, withExtension: "ttf") {
                CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            }
        }
    }
    @MainActor private static var registered = false
}

public extension Font {
    /// Headlines in the playful display face.
    static func bzDisplay(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        .custom(BZFontFamily.display, size: size).weight(weight)
    }

    /// Body text in Inter.
    static func bzBody(_ size: CGFloat = BZTypeScale.body, weight: Font.Weight = .regular) -> Font {
        .custom(BZFontFamily.sans, size: size).weight(weight)
    }

    /// Tabular figures for amounts.
    static func bzNumber(_ size: CGFloat = BZTypeScale.body, weight: Font.Weight = .medium) -> Font {
        .custom(BZFontFamily.sans, size: size).weight(weight).monospacedDigit()
    }
}
