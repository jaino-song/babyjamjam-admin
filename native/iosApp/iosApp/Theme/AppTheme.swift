import Foundation
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct AppTheme {
    struct Colors {
        static let background = ThemeColor(light: "F9FAFB", dark: "14181F")
        static let foreground = ThemeColor(light: "14181F", dark: "F8FAFC")
        static let card = ThemeColor(light: "FFFFFF", dark: "1D212B")
        static let cardForeground = ThemeColor(light: "14181F", dark: "F8FAFC")
        static let primary = ThemeColor(light: "004BAD", dark: "0063E6")
        static let primaryForeground = ThemeColor(light: "F8FAFC", dark: "FFFFFF")
        static let secondary = ThemeColor(light: "F1F5F9", dark: "1F2A3D")
        static let secondaryForeground = ThemeColor(light: "123369", dark: "F8FAFC")
        static let muted = ThemeColor(light: "F3F5F7", dark: "1F2A3D")
        static let mutedForeground = ThemeColor(light: "65758B", dark: "94A3B8")
        static let accent = ThemeColor(light: "3C83F6", dark: "123369")
        static let accentForeground = ThemeColor(light: "FFFFFF", dark: "F8FAFC")
        static let border = ThemeColor(light: "CDD7E5", dark: "1F2A3D")
        static let destructive = ThemeColor(light: "EF4444", dark: "D03232")
        static let destructiveForeground = ThemeColor(light: "F8FAFC", dark: "F8FAFC")
        static let success = ThemeColor(light: "16A249", dark: "16A249")
        static let successForeground = ThemeColor(light: "FFFFFF", dark: "F8FAFC")
        static let warning = ThemeColor(light: "F59F0A", dark: "F59F0A")
        static let warningForeground = ThemeColor(light: "14181F", dark: "14181F")
        static let info = ThemeColor(light: "3C83F6", dark: "3C83F6")
        static let infoForeground = ThemeColor(light: "FFFFFF", dark: "F8FAFC")
        static let kakao = ThemeColor(light: "FFE500", dark: "FFE500")
        static let kakaoForeground = ThemeColor(light: "000000", dark: "000000")
    }

    struct Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
        static let xxxl: CGFloat = 48
    }

    struct Radius {
        static let sm: CGFloat = 4
        static let md: CGFloat = 6
        static let lg: CGFloat = 8
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 28
        static let xxxl: CGFloat = 32
        static let pill: CGFloat = 50
        static let full: CGFloat = 999
    }

    struct Typography {
        static let heading1: CGFloat = 30
        static let heading2: CGFloat = 24
        static let heading3: CGFloat = 20
        static let heading4: CGFloat = 18
        static let heading5: CGFloat = 16
        static let heading6: CGFloat = 14
        static let body: CGFloat = 16
        static let bodySmall: CGFloat = 14
        static let caption: CGFloat = 12
        static let label: CGFloat = 14
    }
}

struct ThemeColor {
    let light: String
    let dark: String
}

extension Color {
    static let appBackground = Color.dynamic(light: AppTheme.Colors.background.light, dark: AppTheme.Colors.background.dark)
    static let appForeground = Color.dynamic(light: AppTheme.Colors.foreground.light, dark: AppTheme.Colors.foreground.dark)
    static let appCard = Color.dynamic(light: AppTheme.Colors.card.light, dark: AppTheme.Colors.card.dark)
    static let appCardForeground = Color.dynamic(light: AppTheme.Colors.cardForeground.light, dark: AppTheme.Colors.cardForeground.dark)
    static let appPrimary = Color.dynamic(light: AppTheme.Colors.primary.light, dark: AppTheme.Colors.primary.dark)
    static let appPrimaryForeground = Color.dynamic(light: AppTheme.Colors.primaryForeground.light, dark: AppTheme.Colors.primaryForeground.dark)
    static let appSecondary = Color.dynamic(light: AppTheme.Colors.secondary.light, dark: AppTheme.Colors.secondary.dark)
    static let appSecondaryForeground = Color.dynamic(light: AppTheme.Colors.secondaryForeground.light, dark: AppTheme.Colors.secondaryForeground.dark)
    static let appMuted = Color.dynamic(light: AppTheme.Colors.muted.light, dark: AppTheme.Colors.muted.dark)
    static let appMutedForeground = Color.dynamic(light: AppTheme.Colors.mutedForeground.light, dark: AppTheme.Colors.mutedForeground.dark)
    static let appAccent = Color.dynamic(light: AppTheme.Colors.accent.light, dark: AppTheme.Colors.accent.dark)
    static let appAccentForeground = Color.dynamic(light: AppTheme.Colors.accentForeground.light, dark: AppTheme.Colors.accentForeground.dark)
    static let appBorder = Color.dynamic(light: AppTheme.Colors.border.light, dark: AppTheme.Colors.border.dark)
    static let appDestructive = Color.dynamic(light: AppTheme.Colors.destructive.light, dark: AppTheme.Colors.destructive.dark)
    static let appDestructiveForeground = Color.dynamic(light: AppTheme.Colors.destructiveForeground.light, dark: AppTheme.Colors.destructiveForeground.dark)
    static let appSuccess = Color.dynamic(light: AppTheme.Colors.success.light, dark: AppTheme.Colors.success.dark)
    static let appSuccessForeground = Color.dynamic(light: AppTheme.Colors.successForeground.light, dark: AppTheme.Colors.successForeground.dark)
    static let appWarning = Color.dynamic(light: AppTheme.Colors.warning.light, dark: AppTheme.Colors.warning.dark)
    static let appWarningForeground = Color.dynamic(light: AppTheme.Colors.warningForeground.light, dark: AppTheme.Colors.warningForeground.dark)
    static let appInfo = Color.dynamic(light: AppTheme.Colors.info.light, dark: AppTheme.Colors.info.dark)
    static let appInfoForeground = Color.dynamic(light: AppTheme.Colors.infoForeground.light, dark: AppTheme.Colors.infoForeground.dark)
    static let appKakao = Color.dynamic(light: AppTheme.Colors.kakao.light, dark: AppTheme.Colors.kakao.dark)
    static let appKakaoForeground = Color.dynamic(light: AppTheme.Colors.kakaoForeground.light, dark: AppTheme.Colors.kakaoForeground.dark)

    private static func dynamic(light: String, dark: String) -> Color {
#if canImport(UIKit)
        Color(
            UIColor { traitCollection in
                if traitCollection.userInterfaceStyle == .dark {
                    return UIColor(hex: dark)
                }
                return UIColor(hex: light)
            }
        )
#else
        Color(hex: light)
#endif
    }

    init(hex: String) {
        let hexValue = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hexValue).scanHexInt64(&int)

        let a: UInt64
        let r: UInt64
        let g: UInt64
        let b: UInt64

        switch hexValue.count {
        case 3:
            a = 255
            r = ((int >> 8) & 0xF) * 17
            g = ((int >> 4) & 0xF) * 17
            b = (int & 0xF) * 17
        case 6:
            a = 255
            r = (int >> 16) & 0xFF
            g = (int >> 8) & 0xFF
            b = int & 0xFF
        case 8:
            a = (int >> 24) & 0xFF
            r = (int >> 16) & 0xFF
            g = (int >> 8) & 0xFF
            b = int & 0xFF
        default:
            a = 255
            r = 0
            g = 0
            b = 0
        }

        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

#if canImport(UIKit)
private extension UIColor {
    convenience init(hex: String) {
        let hexValue = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hexValue).scanHexInt64(&int)

        let a: UInt64
        let r: UInt64
        let g: UInt64
        let b: UInt64

        switch hexValue.count {
        case 3:
            a = 255
            r = ((int >> 8) & 0xF) * 17
            g = ((int >> 4) & 0xF) * 17
            b = (int & 0xF) * 17
        case 6:
            a = 255
            r = (int >> 16) & 0xFF
            g = (int >> 8) & 0xFF
            b = int & 0xFF
        case 8:
            a = (int >> 24) & 0xFF
            r = (int >> 16) & 0xFF
            g = (int >> 8) & 0xFF
            b = int & 0xFF
        default:
            a = 255
            r = 0
            g = 0
            b = 0
        }

        self.init(
            red: CGFloat(r) / 255,
            green: CGFloat(g) / 255,
            blue: CGFloat(b) / 255,
            alpha: CGFloat(a) / 255
        )
    }
}
#endif

extension Font {
    static let appHeading1: Font = .system(size: AppTheme.Typography.heading1, weight: .bold)
    static let appHeading2: Font = .system(size: AppTheme.Typography.heading2, weight: .bold)
    static let appHeading3: Font = .system(size: AppTheme.Typography.heading3, weight: .semibold)
    static let appHeading4: Font = .system(size: AppTheme.Typography.heading4, weight: .semibold)
    static let appHeading5: Font = .system(size: AppTheme.Typography.heading5, weight: .medium)
    static let appHeading6: Font = .system(size: AppTheme.Typography.heading6, weight: .medium)
    static let appBody: Font = .system(size: AppTheme.Typography.body)
    static let appBodySmall: Font = .system(size: AppTheme.Typography.bodySmall)
    static let appCaption: Font = .system(size: AppTheme.Typography.caption)
    static let appLabel: Font = .system(size: AppTheme.Typography.label, weight: .medium)
}
