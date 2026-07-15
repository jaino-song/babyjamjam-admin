import SwiftUI

struct VerifyEmailView: View {
    @State private var email = ""
    @State private var resendSent = false
    @State private var isLoading = false

    var onNavigateToLogin: () -> Void = {}
    var onResendVerification: (String) -> Void = { _ in }

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "envelope.badge.fill")
                .font(.system(size: 64))
                .foregroundColor(.appPrimary)

            Text("이메일 인증")
                .font(.appHeading2)
                .fontWeight(.bold)
                .accessibilityIdentifier("auth-verify-email-title")

            Text("가입 시 입력한 이메일로 인증 링크가 발송되었습니다.\n이메일을 확인하여 계정을 활성화해 주세요.")
                .font(.appBody)
                .foregroundColor(.appMuted)
                .multilineTextAlignment(.center)

            Divider()

            Text("인증 이메일을 받지 못하셨나요?")
                .font(.appCaption)
                .foregroundColor(.appMuted)

            AuthTextField(
                label: "이메일 주소",
                text: $email,
                error: .constant(nil),
                icon: "envelope",
                keyboardType: .emailAddress,
                identifier: "auth-verify-email-field"
            )

            if resendSent {
                HStack {
                    Image(systemName: "checkmark.circle.fill").foregroundColor(.appPrimary)
                    Text("인증 이메일이 재발송되었습니다.")
                        .font(.appCaption)
                        .foregroundColor(.appPrimary)
                }
                .padding(12)
                .frame(maxWidth: .infinity)
                .background(Color.appPrimary.opacity(0.1))
                .cornerRadius(CGFloat(AppTheme.Radius.md))
            }

            Button(action: {
                guard !email.isEmpty else { return }
                isLoading = true
                onResendVerification(email)
                resendSent = true
                isLoading = false
            }) {
                Text("인증 이메일 재발송")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.bordered)
            .tint(.appPrimary)
            .cornerRadius(CGFloat(AppTheme.Radius.md))
            .disabled(isLoading || email.isEmpty)
            .accessibilityIdentifier("auth-verify-email-resend-button")

            Button(action: onNavigateToLogin) {
                Text("로그인 페이지로 이동")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .tint(.appPrimary)
            .cornerRadius(CGFloat(AppTheme.Radius.md))
            .accessibilityIdentifier("auth-verify-email-login-button")
        }
        .padding(24)
        .background(Color.appCard)
        .cornerRadius(CGFloat(AppTheme.Radius.lg))
        .shadow(color: .black.opacity(0.05), radius: 8, y: 4)
        .padding(16)
        .frame(maxWidth: 400)
    }
}
