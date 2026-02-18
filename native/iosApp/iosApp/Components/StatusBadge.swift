import SwiftUI

struct StatusBadge: View {
    let status: String
    let label: String

    private var bgColor: Color {
        switch status {
        case "active", "signed": return Color.appSuccess.opacity(0.15)
        case "pending", "draft": return Color(hex: "F59E0B").opacity(0.15)
        case "inactive", "rejected", "revoked": return Color.appDestructive.opacity(0.15)
        default: return Color.appMuted.opacity(0.15)
        }
    }

    private var textColor: Color {
        switch status {
        case "active", "signed": return .appSuccess
        case "pending", "draft": return Color(hex: "F59E0B")
        case "inactive", "rejected", "revoked": return .appDestructive
        default: return .appMuted
        }
    }

    var body: some View {
        Text(label)
            .font(.appCaption)
            .fontWeight(.medium)
            .foregroundColor(textColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(bgColor)
            .cornerRadius(CGFloat(AppTheme.Radius.sm))
            .accessibilityIdentifier("status-badge-\(status)")
    }
}
