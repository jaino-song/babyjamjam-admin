import SwiftUI

struct SettingsView: View {
    var onNavigateToVoucherPrices: () -> Void = {}
    var onLogout: () -> Void = {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("설정")
                    .font(.appHeading2)
                    .fontWeight(.bold)
                    .accessibilityIdentifier("settings-title")

                SettingsRow(
                    icon: "wonsign.circle.fill",
                    title: "바우처 가격 관리",
                    subtitle: "바우처 가격 정보를 관리합니다",
                    action: onNavigateToVoucherPrices
                )
                .accessibilityIdentifier("settings-voucher-prices")

                SettingsRow(
                    icon: "bell.fill",
                    title: "알림 설정",
                    subtitle: "푸시 알림을 관리합니다",
                    action: {}
                )
                .accessibilityIdentifier("settings-notifications")

                SettingsRow(
                    icon: "lock.shield.fill",
                    title: "보안",
                    subtitle: "비밀번호 및 보안 설정",
                    action: {}
                )
                .accessibilityIdentifier("settings-security")

                SettingsRow(
                    icon: "info.circle.fill",
                    title: "앱 정보",
                    subtitle: "버전 및 라이선스 정보",
                    action: {}
                )
                .accessibilityIdentifier("settings-about")

                Spacer().frame(height: 24)

                Button(action: onLogout) {
                    HStack {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                        Text("로그아웃")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .foregroundColor(.appDestructive)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.appDestructive, lineWidth: 1)
                    )
                }
                .accessibilityIdentifier("settings-logout")
            }
            .padding(16)
        }
        .accessibilityIdentifier("settings-screen")
    }
}

private struct SettingsRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .foregroundColor(.appPrimary)
                    .font(.title3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.appBodyLarge)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)
                    Text(subtitle)
                        .font(.appCaption)
                        .foregroundColor(.appMuted)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundColor(.appMuted)
                    .font(.caption)
            }
            .padding(16)
            .background(Color(.systemBackground))
            .cornerRadius(12)
            .shadow(color: .black.opacity(0.05), radius: 2, y: 1)
        }
    }
}
