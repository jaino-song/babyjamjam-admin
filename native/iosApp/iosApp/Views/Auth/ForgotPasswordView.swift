import SwiftUI

struct ForgotPasswordView: View {
    @StateObject private var viewModel = AuthViewModelWrapper()
    @State private var email = ""
    @State private var emailError: String?
    @State private var emailSent = false

    var onNavigateBack: () -> Void = {}

    var body: some View {
        VStack(spacing: 16) {
            // Back button
            HStack {
                Button(action: onNavigateBack) {
                    Image(systemName: "chevron.left")
                        .font(.title3)
                        .foregroundColor(.appForeground)
                }
                .accessibilityIdentifier("auth-forgot-password-back")
                Spacer()
            }

            if emailSent {
                // Success state
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 64))
                    .foregroundColor(.appPrimary)

                Text("이메일 발송 완료")
                    .font(.appHeading2)
                    .fontWeight(.bold)

                Text("비밀번호 재설정 링크가 발송되었습니다.\n이메일을 확인해 주세요.")
                    .font(.appBody)
                    .foregroundColor(.appMuted)
                    .multilineTextAlignment(.center)

                Button(action: onNavigateBack) {
                    Text("로그인으로 돌아가기")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .tint(.appPrimary)
                .cornerRadius(CGFloat(AppTheme.Radius.md))
            } else {
                Text("비밀번호 찾기")
                    .font(.appHeading2)
                    .foregroundColor(.appForeground)
                    .accessibilityIdentifier("auth-forgot-password-title")

                Text("가입한 이메일 주소를 입력하시면\n비밀번호 재설정 링크를 보내드립니다.")
                    .font(.appBody)
                    .foregroundColor(.appMuted)
                    .multilineTextAlignment(.center)

                AuthTextField(
                    label: "이메일",
                    text: $email,
                    error: $emailError,
                    icon: "envelope",
                    keyboardType: .emailAddress,
                    identifier: "auth-forgot-password-email-field"
                )

                Button(action: validateAndSubmit) {
                    HStack {
                        if viewModel.isLoading { ProgressView().tint(.white) }
                        else { Text("재설정 링크 발송").fontWeight(.semibold) }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .tint(.appPrimary)
                .cornerRadius(CGFloat(AppTheme.Radius.md))
                .disabled(viewModel.isLoading)
                .accessibilityIdentifier("auth-forgot-password-submit-button")

                Button("로그인으로 돌아가기") { onNavigateBack() }
                    .font(.appCaption.weight(.semibold))
                    .foregroundColor(.appPrimary)
                    .accessibilityIdentifier("auth-forgot-password-login-link")
            }
        }
        .padding(24)
        .background(Color.appCard)
        .cornerRadius(CGFloat(AppTheme.Radius.lg))
        .shadow(color: .black.opacity(0.05), radius: 8, y: 4)
        .padding(16)
        .frame(maxWidth: 400)
    }

    private func validateAndSubmit() {
        emailError = nil
        if email.trimmingCharacters(in: .whitespaces).isEmpty {
            emailError = "이메일을 입력해 주세요"; return
        }
        if !email.contains("@") {
            emailError = "유효한 이메일 형식이 아닙니다"; return
        }
        viewModel.forgotPassword(email: email)
        emailSent = true
    }
}
