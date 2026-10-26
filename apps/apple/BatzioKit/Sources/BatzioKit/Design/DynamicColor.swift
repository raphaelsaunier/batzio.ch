import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

public typealias RGBA = (Double, Double, Double, Double)

public extension Color {
    /// A colour that follows light/dark appearance; components are Display P3.
    static func bzDynamic(light: RGBA, dark: RGBA) -> Color {
        #if canImport(UIKit)
        return Color(uiColor: UIColor { traits in
            let c = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(displayP3Red: c.0, green: c.1, blue: c.2, alpha: c.3)
        })
        #elseif canImport(AppKit)
        return Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            let c = isDark ? dark : light
            return NSColor(displayP3Red: c.0, green: c.1, blue: c.2, alpha: c.3)
        })
        #endif
    }
}

public struct BZShadowLayer: Sendable {
    public let x: CGFloat
    public let y: CGFloat
    /// CSS blur radius; SwiftUI's radius is roughly half of it.
    public let blur: CGFloat
    public let color: Color
    public init(x: CGFloat, y: CGFloat, blur: CGFloat, color: Color) {
        self.x = x
        self.y = y
        self.blur = blur
        self.color = color
    }
}

public struct BZShadowSet: Sendable {
    public let inset: Bool
    public let light: [BZShadowLayer]
    public let dark: [BZShadowLayer]
    public func layers(_ scheme: ColorScheme) -> [BZShadowLayer] { scheme == .dark ? dark : light }
}
