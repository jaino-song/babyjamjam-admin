import SwiftUI

struct AppTheme {
    struct Colors {
        static let background = ThemeColor(light: "F8FAFC", dark: "0F172A")
        static let foreground = ThemeColor(light: "0F172A", dark: "F8FAFC")
        static let card = ThemeColor(light: "FFFFFF", dark: "1E293B")
        static let primary = ThemeColor(light: "1E40AF", dark: "1E40AF")
        static let secondary = ThemeColor(light: "64748B", dark: "64748B")
        static let muted = ThemeColor(light: "64748B", dark: "A1A1AA")
        static let border = ThemeColor(light: "E2E8F0", dark: "334155")
        static let destructive = ThemeColor(light: "EF4444", dark: "EF4444")
        static let success = ThemeColor(light: "22C55E", dark: "22C55E")
    }
    struct Radius { static let sm: CGFloat = 4; static let md: CGFloat = 6; static let lg: CGFloat = 8; static let xl: CGFloat = 24; static let pill: CGFloat = 50 }
    struct Typography { static let heading1: CGFloat = 30; static let heading2: CGFloat = 24; static let heading3: CGFloat = 20; static let heading4: CGFloat = 18; static let body: CGFloat = 16; static let bodySmall: CGFloat = 14; static let caption: CGFloat = 12; static let label: CGFloat = 14 }
}

struct ThemeColor { let light: String; let dark: String }

extension Color {
    static var appBackground: Color { Color(hex: AppTheme.Colors.background.light) }
    static var appForeground: Color { Color(hex: AppTheme.Colors.foreground.light) }
    static var appCard: Color { Color(hex: AppTheme.Colors.card.light) }
    static var appPrimary: Color { Color(hex: AppTheme.Colors.primary.light) }
    static var appSecondary: Color { Color(hex: AppTheme.Colors.secondary.light) }
    static var appMuted: Color { Color(hex: AppTheme.Colors.muted.light) }
    static var appBorder: Color { Color(hex: AppTheme.Colors.border.light) }
    static var appDestructive: Color { Color(hex: AppTheme.Colors.destructive.light) }
    static var appSuccess: Color { Color(hex: AppTheme.Colors.success.light) }
}

extension Font {
    static var appHeading1: Font { .system(size: AppTheme.Typography.heading1, weight: .bold) }
    static var appHeading2: Font { .system(size: AppTheme.Typography.heading2, weight: .bold) }
    static var appHeading3: Font { .system(size: AppTheme.Typography.heading3, weight: .semibold) }
    static var appHeading4: Font { .system(size: AppTheme.Typography.heading4, weight: .semibold) }
    static var appBody: Font { .system(size: AppTheme.Typography.body) }
    static var appBodySmall: Font { .system(size: AppTheme.Typography.bodySmall) }
    static var appCaption: Font { .system(size: AppTheme.Typography.caption) }
    static var appLabel: Font { .system(size: AppTheme.Typography.label, weight: .medium) }
}
