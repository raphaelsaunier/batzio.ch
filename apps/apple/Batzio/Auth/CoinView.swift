import BatzioKit
import SwiftUI

/// The Batzio coin: tossed with a thick reeded edge, it spins a few times,
/// lands flat with a soft shadow, and can be flipped with a tap.
struct CoinView: View {
    var size: CGFloat = 220
    var autoplay = true
    var onLanded: (() -> Void)?

    @State private var angle: Double = 0
    @State private var lift: CGFloat = 0
    @State private var tilt: Double = 0
    @State private var landed = false

    var body: some View {
        ZStack {
            Ellipse()
                .fill(Color.black.opacity(landed ? 0.22 : 0.08))
                .frame(width: size * (landed ? 0.8 : 0.5), height: size * 0.12)
                .blur(radius: landed ? 8 : 14)
                .offset(y: size * 0.56)
            CoinFace(angle: angle, size: size)
                .rotation3DEffect(.degrees(tilt), axis: (x: 1, y: 0, z: 0), perspective: 0.6)
                .offset(y: -lift)
        }
        .frame(width: size, height: size * 1.25)
        .contentShape(Rectangle())
        .onTapGesture { flip() }
        .accessibilityLabel("Batzio")
        .task {
            guard autoplay else { landed = true; return }
            try? await Task.sleep(for: .milliseconds(250))
            withAnimation(.timingCurve(0.15, 0.7, 0.25, 1, duration: 2.4)) { angle = 360 * 5 }
            withAnimation(.easeOut(duration: 0.9)) { lift = size * 0.45; tilt = 18 }
            try? await Task.sleep(for: .milliseconds(900))
            withAnimation(.interpolatingSpring(stiffness: 120, damping: 11)) { lift = 0; tilt = 0 }
            try? await Task.sleep(for: .milliseconds(1500))
            withAnimation(.easeOut(duration: 0.3)) { landed = true }
            onLanded?()
        }
    }

    private func flip() {
        withAnimation(.spring(duration: 0.8, bounce: 0.3)) { angle += 180 }
    }
}

/// Picks the visible face from the animated angle and draws the coin's edge.
private struct CoinFace: View, Animatable {
    var angle: Double
    let size: CGFloat

    nonisolated var animatableData: Double {
        get { angle }
        set { angle = newValue }
    }

    var body: some View {
        let radians = angle * .pi / 180
        let cosine = cos(radians)
        let front = cosine >= 0
        let thickness = size * 0.07
        let edgeOffset = CGFloat(sin(radians)) * thickness
        ZStack {
            // The reeded edge: stacked discs that show as the coin turns.
            ForEach(0..<8, id: \.self) { i in
                Circle()
                    .fill(LinearGradient(colors: [Color(white: 0.55), Color(white: 0.78), Color(white: 0.45)], startPoint: .top, endPoint: .bottom))
                    .overlay(Circle().strokeBorder(Color.black.opacity(0.15), style: StrokeStyle(lineWidth: 1, dash: [1.5, 1.5])))
                    .frame(width: size, height: size)
                    .scaleEffect(x: max(abs(cosine), 0.02), y: 1)
                    .offset(x: edgeOffset * CGFloat(i) / 8)
            }
            Image(front ? "CoinFront" : "CoinBack")
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
                .clipShape(Circle())
                .overlay(
                    Circle().fill(LinearGradient(colors: [.white.opacity(0.35), .clear, .black.opacity(0.18)], startPoint: .topLeading, endPoint: .bottomTrailing))
                        .blendMode(.overlay)
                )
                .scaleEffect(x: max(abs(cosine), 0.02), y: 1)
                .offset(x: edgeOffset)
        }
    }
}

/// “Accounting Suite” gets crossed out and becomes “Accounting, Sweet!”.
struct CoinTagline: View {
    @State private var phase = 0

    var body: some View {
        ZStack {
            Text(verbatim: "Accounting Suite")
                .font(.bzDisplay(28, weight: .semibold))
                .foregroundStyle(.secondary)
                .overlay(alignment: .leading) {
                    GeometryReader { g in
                        Capsule().fill(Color.bzCoral).frame(width: phase >= 2 ? g.size.width : 0, height: 3).position(x: (phase >= 2 ? g.size.width : 0) / 2, y: g.size.height / 2)
                    }
                }
                .opacity(phase >= 1 && phase < 3 ? 1 : 0)
                .offset(y: phase >= 3 ? -14 : 0)
            Text(verbatim: "Accounting, Sweet!")
                .font(.bzDisplay(30))
                .foregroundStyle(LinearGradient(colors: BZGradient.metal, startPoint: .leading, endPoint: .trailing))
                .opacity(phase >= 3 ? 1 : 0)
                .scaleEffect(phase >= 3 ? 1 : 0.8)
        }
        .task {
            try? await Task.sleep(for: .milliseconds(2600))
            withAnimation(.easeOut(duration: 0.5)) { phase = 1 }
            try? await Task.sleep(for: .milliseconds(900))
            withAnimation(.easeInOut(duration: 0.45)) { phase = 2 }
            try? await Task.sleep(for: .milliseconds(650))
            withAnimation(.spring(duration: 0.6, bounce: 0.45)) { phase = 3 }
        }
        .accessibilityLabel("Accounting, Sweet!")
    }
}
