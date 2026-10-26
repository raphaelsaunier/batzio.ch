import SwiftUI

// Neumorphism is for pages, cards and buttons only. Text fields and wells keep
// the platform's plain look, like on the web.

private struct NeuShadows: ViewModifier {
    let set: BZShadowSet
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let layers = set.layers(scheme)
        return layers.reduce(AnyView(content)) { view, l in
            AnyView(view.shadow(color: l.color, radius: l.blur / 2, x: l.x, y: l.y))
        }
    }
}

public extension View {
    /// A raised, softly extruded card on the page surface.
    func neuCard(cornerRadius: CGFloat = BZRadius.xl, padding: CGFloat? = BZSpace.lg) -> some View {
        modifier(NeuCardModifier(cornerRadius: cornerRadius, padding: padding))
    }

    /// The app's page background.
    func bzPage() -> some View {
        frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.bzBackground.ignoresSafeArea())
    }
}

struct NeuCardModifier: ViewModifier {
    let cornerRadius: CGFloat
    let padding: CGFloat?

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        #if os(visionOS)
        content
            .padding(padding ?? 0)
            .glassBackgroundEffect(in: shape)
        #else
        content
            .padding(padding ?? 0)
            .background(shape.fill(Color.bzNeuSurface).modifier(NeuShadows(set: BZShadow.neuRaised)))
        #endif
    }
}

/// Soft, raised buttons that sink in when pressed.
public struct NeuButtonStyle: ButtonStyle {
    var prominent: Bool
    var compact: Bool
    public init(prominent: Bool = false, compact: Bool = false) {
        self.prominent = prominent
        self.compact = compact
    }

    public func makeBody(configuration: Configuration) -> some View {
        NeuButton(configuration: configuration, prominent: prominent, compact: compact)
    }

    private struct NeuButton: View {
        let configuration: ButtonStyleConfiguration
        let prominent: Bool
        let compact: Bool
        @Environment(\.isEnabled) private var enabled
        @Environment(\.colorScheme) private var scheme

        var body: some View {
            let shape = Capsule(style: .continuous)
            let pressed = configuration.isPressed
            configuration.label
                .font(.bzBody(compact ? 13 : 15, weight: .semibold))
                .foregroundStyle(prominent ? Color.bzPrimaryForeground : Color.bzForeground)
                .padding(.horizontal, compact ? 12 : 18)
                .padding(.vertical, compact ? 6 : 10)
                .background {
                    if prominent {
                        shape
                            .fill(LinearGradient(colors: BZGradient.metal, startPoint: .topLeading, endPoint: .bottomTrailing))
                            .overlay(shape.strokeBorder(Color.white.opacity(pressed ? 0.05 : 0.35), lineWidth: 1).blendMode(.overlay))
                            .shadow(color: Color.black.opacity(pressed ? 0.05 : 0.18), radius: pressed ? 1 : 4, x: 0, y: pressed ? 0 : 3)
                    } else if pressed {
                        shape.fill(Color.bzNeuSurface.shadow(.inner(color: .bzNeuDark, radius: 3, x: 3, y: 3)).shadow(.inner(color: .bzNeuLight, radius: 3, x: -3, y: -3)))
                    } else {
                        shape.fill(Color.bzNeuSurface).modifier(NeuShadows(set: BZShadow.neuRaisedSm))
                    }
                }
                .scaleEffect(pressed ? 0.98 : 1)
                .opacity(enabled ? 1 : 0.5)
                .animation(.spring(duration: 0.18), value: pressed)
                .contentShape(shape)
        }
    }
}

public extension ButtonStyle where Self == NeuButtonStyle {
    static var neu: NeuButtonStyle { NeuButtonStyle() }
    static var metal: NeuButtonStyle { NeuButtonStyle(prominent: true) }
    static var neuCompact: NeuButtonStyle { NeuButtonStyle(compact: true) }
}

/// A small coloured label for statuses (tones match the web badges).
public struct ToneBadge: View {
    let text: String
    let tone: Tone
    public init(_ text: String, tone: Tone) {
        self.text = text
        self.tone = tone
    }

    public var body: some View {
        Text(text)
            .font(.bzBody(12, weight: .semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(tone.foreground)
            .background(Capsule().fill(tone.background))
    }
}

public extension Tone {
    var foreground: Color {
        switch self {
        case .success: .bzSuccess
        case .warning: .bzWarning
        case .danger: .bzDestructive
        case .info: .bzInfo
        case .primary: .bzPrimary
        case .muted, .neutral: .bzMutedForeground
        }
    }
    var background: Color { foreground.opacity(0.14) }

    init(name: String?) { self = Tone(rawValue: name ?? "") ?? .neutral }
}
