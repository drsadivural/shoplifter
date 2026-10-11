import SwiftUI

/// Design tokens (design/tokens.json) backed by asset-catalog color sets with
/// light and dark variants.
extension Color {
    static let rgPrimary = Color("RGPrimary")
    static let rgOnPrimary = Color("RGOnPrimary")
    static let rgInk = Color("RGInk")
    static let rgSecondaryText = Color("RGSecondaryText")
    static let rgBackground = Color("RGBackground")
    static let rgSurface = Color("RGSurface")
    static let rgSurfaceMuted = Color("RGSurfaceMuted")
    static let rgBorder = Color("RGBorder")
    static let rgAccent = Color("RGAccent")
    static let rgCritical = Color("RGCritical")
    static let rgWarning = Color("RGWarning")
    static let rgSuccess = Color("RGSuccess")
    static let rgInfo = Color("RGInfo")
}

enum RGMetrics {
    static let cardRadius: CGFloat = 16
    static let buttonRadius: CGFloat = 10
    static let minTapTarget: CGFloat = 44
    static let gutter: CGFloat = 16
}

/// Semantic tone for status badges and banners. Always paired with text and
/// an icon — never conveyed by color alone.
enum Tone {
    case neutral, info, success, warning, critical

    var foreground: Color {
        switch self {
        case .neutral: return .rgSecondaryText
        case .info: return .rgPrimary
        case .success: return .rgSuccess
        case .warning: return .rgWarning
        case .critical: return .rgCritical
        }
    }

    var background: Color {
        foreground.opacity(0.14)
    }
}

struct CardModifier: ViewModifier {
    var padding: CGFloat = 16

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.rgSurface, in: RoundedRectangle(cornerRadius: RGMetrics.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: RGMetrics.cardRadius, style: .continuous)
                    .strokeBorder(Color.rgBorder, lineWidth: 1)
            )
    }
}

extension View {
    func rgCard(padding: CGFloat = 16) -> some View {
        modifier(CardModifier(padding: padding))
    }

    /// Guarantees a 44×44 pt hit area.
    func rgTapTarget() -> some View {
        frame(minWidth: RGMetrics.minTapTarget, minHeight: RGMetrics.minTapTarget)
            .contentShape(Rectangle())
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    var fullWidth = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: RGMetrics.minTapTarget)
            .foregroundStyle(Color.rgOnPrimary)
            .background(Color.rgPrimary.opacity(configuration.isPressed ? 0.8 : 1),
                        in: RoundedRectangle(cornerRadius: RGMetrics.buttonRadius, style: .continuous))
            .opacity(isEnabled ? 1 : 0.5)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    var fullWidth = false
    var tone: Tone = .neutral

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: RGMetrics.minTapTarget)
            .foregroundStyle(tone == .critical ? Color.rgCritical : Color.rgInk)
            .background(Color.rgSurface.opacity(configuration.isPressed ? 0.7 : 1),
                        in: RoundedRectangle(cornerRadius: RGMetrics.buttonRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: RGMetrics.buttonRadius, style: .continuous)
                .strokeBorder(tone == .critical ? Color.rgCritical : Color.rgBorder, lineWidth: 1))
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var rgPrimary: PrimaryButtonStyle { PrimaryButtonStyle() }
    static var rgPrimaryWide: PrimaryButtonStyle { PrimaryButtonStyle(fullWidth: true) }
}

extension ButtonStyle where Self == SecondaryButtonStyle {
    static var rgSecondary: SecondaryButtonStyle { SecondaryButtonStyle() }
    static var rgSecondaryWide: SecondaryButtonStyle { SecondaryButtonStyle(fullWidth: true) }
    static var rgDestructive: SecondaryButtonStyle { SecondaryButtonStyle(fullWidth: true, tone: .critical) }
}

/// Animation that respects Reduce Motion.
extension Animation {
    static func rgDefault(reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .easeInOut(duration: 0.2)
    }
}
